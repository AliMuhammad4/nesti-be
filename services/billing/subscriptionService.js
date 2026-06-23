import Subscription from '../../models/Subscription.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { getPlan, getPlanByPriceId, getPlanTier, getStripePriceId } from './plans.js';
import { getStripeClient } from './stripeClient.js';
import { getPlanLimitsForSubscription } from './entitlements.js';
import { getPlanUsageForUser } from './planQuota.js';

const FREE_TRIAL_DAYS = 2;

const ACTIVE_ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);
const STRIPE_BLOCKING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

function userHasActiveSubscriptionAccess(subscription) {
  return accountStatusFromSubscription(subscription) === 'subscribed';
}

async function findBlockingStripeSubscription(customerId) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId) return null;

  const stripe = getStripeClient();
  const result = await stripe.subscriptions.list({
    customer: normalizedCustomerId,
    status: 'all',
    limit: 20,
  });

  return result.data.find((sub) => STRIPE_BLOCKING_STATUSES.has(String(sub.status || ''))) || null;
}

async function refreshSubscriptionFromStripeForUser(user) {
  const subscription = await Subscription.findOne({ user_id: user._id });
  const customerId = String(subscription?.stripe_customer_id || '').trim();
  if (!customerId) return subscription;

  const activeStripeSubscription = await findBlockingStripeSubscription(customerId);
  if (!activeStripeSubscription) return subscription;

  const stripe = getStripeClient();
  const detailedStripeSubscription = await stripe.subscriptions.retrieve(activeStripeSubscription.id, {
    expand: ['latest_invoice'],
  });
  const repairResult = await repairUnpaidUpgradeIfNeeded(stripe, user, subscription, detailedStripeSubscription);
  if (repairResult.repaired) {
    return repairResult.subscription;
  }

  const paidPlanRepairResult = await repairPaidPlanMismatchIfNeeded(
    stripe,
    user,
    subscription,
    detailedStripeSubscription,
  );
  if (paidPlanRepairResult.repaired) {
    return paidPlanRepairResult.subscription;
  }

  const localSubscriptionId = String(subscription?.stripe_subscription_id || '').trim();
  const localStatus = String(subscription?.status || '').trim();
  const localPriceId = String(subscription?.stripe_price_id || '').trim();
  const stripePriceId = firstSubscriptionPriceId(detailedStripeSubscription);
  const hasPeriodEnd = Boolean(subscription?.current_period_end);
  if (
    localSubscriptionId === String(detailedStripeSubscription.id || '').trim() &&
    ACTIVE_ACCESS_STATUSES.has(localStatus) &&
    hasPeriodEnd &&
    localPriceId === stripePriceId
  ) {
    return subscription;
  }

  return syncStripeSubscription(detailedStripeSubscription, { user_id: String(user._id) });
}

async function assertUserCanPurchasePlan(user, subscription) {
  const current = await expireTrialIfNeeded(subscription);

  if (userHasActiveSubscriptionAccess(current)) {
    return {
      ok: false,
      code: 409,
      message: 'An active subscription already exists. You can purchase a new plan after it expires.',
    };
  }

  const customerId = String(current?.stripe_customer_id || '').trim();
  if (!customerId) {
    return { ok: true };
  }

  const activeStripeSubscription = await findBlockingStripeSubscription(customerId);
  if (!activeStripeSubscription) {
    return { ok: true };
  }

  await syncStripeSubscription(activeStripeSubscription, { user_id: String(user._id) });

  return {
    ok: false,
    code: 409,
    message: 'An active subscription already exists. You can purchase a new plan after it expires.',
  };
}

function toDateFromUnix(value) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getStripeSubscriptionPeriodEnd(stripeSubscription = {}) {
  const items = stripeSubscription?.items?.data || [];
  let latestEnd = null;

  for (const item of items) {
    const end = toDateFromUnix(item?.current_period_end);
    if (end && (!latestEnd || end > latestEnd)) latestEnd = end;
  }

  if (latestEnd) return latestEnd;

  return (
    toDateFromUnix(stripeSubscription.current_period_end)
    || toDateFromUnix(stripeSubscription.cancel_at)
    || toDateFromUnix(stripeSubscription.ended_at)
    || null
  );
}

function getStripeSubscriptionPeriodStart(stripeSubscription = {}) {
  const items = stripeSubscription?.items?.data || [];
  let earliestStart = null;

  for (const item of items) {
    const start = toDateFromUnix(item?.current_period_start);
    if (start && (!earliestStart || start < earliestStart)) earliestStart = start;
  }

  if (earliestStart) return earliestStart;

  return toDateFromUnix(stripeSubscription.current_period_start) || null;
}

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeStripeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.id || '');
}

function firstSubscriptionPriceId(stripeSubscription = {}) {
  return String(stripeSubscription?.items?.data?.[0]?.price?.id || '').trim();
}

function invoiceLinePriceId(line = {}) {
  return (
    normalizeStripeId(line.price)
    || normalizeStripeId(line.plan)
    || String(line.pricing?.price_details?.price || '').trim()
  );
}

function planFromInvoice(invoice = {}) {
  const lines = invoice.lines?.data || [];
  for (const line of lines) {
    const plan = getPlanByPriceId(invoiceLinePriceId(line));
    if (plan) return plan;
  }
  return null;
}

function invoiceHasPrice(invoice = {}, priceId = '') {
  const normalizedPriceId = String(priceId || '').trim();
  if (!normalizedPriceId) return false;
  return (invoice.lines?.data || []).some((line) => invoiceLinePriceId(line) === normalizedPriceId);
}

async function findLatestPaidPlanForSubscription(stripe, customerId, subscriptionId) {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    status: 'paid',
    limit: 20,
    expand: ['data.lines'],
  });

  for (const invoice of invoices.data || []) {
    const invoiceSubscriptionId = normalizeStripeId(invoice.subscription);
    if (invoiceSubscriptionId && subscriptionId && invoiceSubscriptionId !== subscriptionId) {
      continue;
    }

    const plan = planFromInvoice(invoice);
    if (plan) {
      return {
        plan,
        priceId: getStripePriceId(plan.plan_key),
        invoice,
      };
    }
  }

  return null;
}

function stripeTimestampFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

function buildScheduleItemsFromSubscription(stripeSubscription = {}) {
  return (stripeSubscription.items?.data || [])
    .map((item) => ({
      price: normalizeStripeId(item.price),
      quantity: item.quantity || 1,
    }))
    .filter((item) => item.price);
}

function buildSinglePriceScheduleItem(priceId) {
  return [{ price: priceId, quantity: 1 }];
}

function invoiceRequiresPayment(invoice) {
  if (!invoice || typeof invoice !== 'object') return false;
  const status = String(invoice.status || '').toLowerCase();
  const amountRemaining = Number(invoice.amount_remaining ?? invoice.amount_due ?? 0);
  return ['draft', 'open', 'uncollectible'].includes(status) && amountRemaining > 0;
}

async function voidOrDeleteUnpaidInvoice(stripe, invoice) {
  if (!invoiceRequiresPayment(invoice)) return;

  const status = String(invoice.status || '').toLowerCase();
  if (status === 'draft') {
    await stripe.invoices.del(invoice.id);
    return;
  }

  await stripe.invoices.voidInvoice(invoice.id);
}

async function repairUnpaidUpgradeIfNeeded(stripe, user, localSubscription, stripeSubscription) {
  const latestInvoice = stripeSubscription.latest_invoice && typeof stripeSubscription.latest_invoice === 'object'
    ? stripeSubscription.latest_invoice
    : null;

  if (
    !invoiceRequiresPayment(latestInvoice) ||
    String(latestInvoice.billing_reason || '') !== 'subscription_update'
  ) {
    return { repaired: false, stripeSubscription };
  }

  const subscriptionId = normalizeStripeId(stripeSubscription);
  const customerId = normalizeStripeId(stripeSubscription.customer) || String(localSubscription?.stripe_customer_id || '').trim();
  const currentPriceId = firstSubscriptionPriceId(stripeSubscription);
  const lastPaid = await findLatestPaidPlanForSubscription(stripe, customerId, subscriptionId);

  if (!lastPaid?.priceId || lastPaid.priceId === currentPriceId) {
    return { repaired: false, stripeSubscription };
  }

  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) {
    return { repaired: false, stripeSubscription };
  }

  await clearPendingScheduleIfAny(stripe, localSubscription, normalizeStripeId(stripeSubscription.schedule));
  await voidOrDeleteUnpaidInvoice(stripe, latestInvoice);

  const restored = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
    items: [{ id: subscriptionItemId, price: lastPaid.priceId }],
    proration_behavior: 'none',
    payment_behavior: 'allow_incomplete',
    expand: ['latest_invoice'],
    metadata: {
      user_id: String(user._id),
      plan_key: lastPaid.plan.plan_key,
    },
  });

  const subscription = await syncStripeSubscription(restored, {
    user_id: String(user._id),
    plan_key: lastPaid.plan.plan_key,
    clearPendingPlan: true,
  });

  return { repaired: true, stripeSubscription: restored, subscription };
}

async function repairPaidPlanMismatchIfNeeded(stripe, user, localSubscription, stripeSubscription) {
  const subscriptionId = normalizeStripeId(stripeSubscription);
  const customerId = normalizeStripeId(stripeSubscription.customer) || String(localSubscription?.stripe_customer_id || '').trim();
  const currentPriceId = firstSubscriptionPriceId(stripeSubscription);
  const lastPaid = await findLatestPaidPlanForSubscription(stripe, customerId, subscriptionId);

  if (!lastPaid?.priceId || lastPaid.priceId === currentPriceId) {
    return { repaired: false, stripeSubscription };
  }

  // If the latest paid invoice contains the current price (for example, a paid upgrade
  // proration invoice), Stripe's current price is legitimate. Only repair when the
  // current price is absent from the paid invoice history we use as the source of truth.
  if (invoiceHasPrice(lastPaid.invoice, currentPriceId)) {
    return { repaired: false, stripeSubscription };
  }

  const currentPlan = getPlanByPriceId(currentPriceId);
  const currentTier = getPlanTier(currentPlan?.plan_key);
  const lastPaidTier = getPlanTier(lastPaid.plan?.plan_key);

  // Completed or in-progress downgrades legitimately have a lower Stripe price than the
  // last paid upgrade invoice — never revert those back to the higher plan.
  if (currentTier > 0 && lastPaidTier > 0 && currentTier < lastPaidTier) {
    return { repaired: false, stripeSubscription };
  }

  const pendingPlanKey = String(localSubscription?.pending_plan_key || '').trim().toLowerCase();
  if (pendingPlanKey) {
    const pendingTier = getPlanTier(pendingPlanKey);
    if (pendingTier > 0 && currentTier > 0 && pendingTier < currentTier) {
      return { repaired: false, stripeSubscription };
    }
  }

  const attachedScheduleId = normalizeStripeId(stripeSubscription.schedule);
  if (attachedScheduleId) {
    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(attachedScheduleId);
      const activeScheduleStatuses = new Set(['not_started', 'active']);
      if (activeScheduleStatuses.has(String(schedule.status || ''))) {
        return { repaired: false, stripeSubscription };
      }
    } catch (err) {
      if (err?.code !== 'resource_missing') throw err;
    }
  }

  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) {
    return { repaired: false, stripeSubscription };
  }

  await clearPendingScheduleIfAny(stripe, localSubscription, normalizeStripeId(stripeSubscription.schedule));

  const restored = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
    items: [{ id: subscriptionItemId, price: lastPaid.priceId }],
    proration_behavior: 'none',
    payment_behavior: 'allow_incomplete',
    expand: ['latest_invoice'],
    metadata: {
      user_id: String(user._id),
      plan_key: lastPaid.plan.plan_key,
    },
  });

  const subscription = await syncStripeSubscription(restored, {
    user_id: String(user._id),
    plan_key: lastPaid.plan.plan_key,
    clearPendingPlan: true,
  });

  return { repaired: true, stripeSubscription: restored, subscription };
}

async function clearPendingScheduleIfAny(stripe, subscription, attachedScheduleId = '') {
  const scheduleId = String(subscription?.stripe_subscription_schedule_id || attachedScheduleId || '').trim();
  if (!scheduleId) return;

  try {
    await stripe.subscriptionSchedules.release(scheduleId);
  } catch (err) {
    if (err?.code !== 'resource_missing') throw err;
  }

  await Subscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        pending_plan_key: '',
        pending_plan_effective_at: null,
        stripe_subscription_schedule_id: '',
      },
    },
  );
}

async function getOrCreateSubscriptionSchedule(stripe, stripeSubscription, localScheduleId = '') {
  const attachedScheduleId = normalizeStripeId(stripeSubscription.schedule);
  const preferredScheduleId = String(localScheduleId || attachedScheduleId || '').trim();

  const retrieveUsableSchedule = async (scheduleId) => {
    if (!scheduleId) return null;
    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      if (['completed', 'released', 'canceled'].includes(String(schedule.status || ''))) {
        return null;
      }
      return schedule;
    } catch (err) {
      if (err?.code === 'resource_missing') return null;
      throw err;
    }
  };

  const existingSchedule = await retrieveUsableSchedule(preferredScheduleId);
  if (existingSchedule) return existingSchedule;

  if (attachedScheduleId && attachedScheduleId !== preferredScheduleId) {
    const attachedSchedule = await retrieveUsableSchedule(attachedScheduleId);
    if (attachedSchedule) return attachedSchedule;
  }

  try {
    return await stripe.subscriptionSchedules.create({
      from_subscription: normalizeStripeId(stripeSubscription),
    });
  } catch (err) {
    const message = String(err?.message || '');
    if (!message.includes('already attached to a schedule')) throw err;

    const refreshedSubscription = await stripe.subscriptions.retrieve(normalizeStripeId(stripeSubscription));
    const refreshedScheduleId = normalizeStripeId(refreshedSubscription.schedule);
    const refreshedSchedule = await retrieveUsableSchedule(refreshedScheduleId);
    if (refreshedSchedule) return refreshedSchedule;

    throw err;
  }
}

function accountStatusFromSubscription(subscription) {
  if (!subscription) return 'expired';

  if (subscription.status === 'free_trial') {
    if (subscription.trial_end && new Date(subscription.trial_end) <= new Date()) {
      return 'expired';
    }
    return 'free_trial';
  }

  if (ACTIVE_ACCESS_STATUSES.has(subscription.status)) return 'subscribed';
  return 'expired';
}

export function serializeSubscription(subscription) {
  if (!subscription) {
    return {
      accountStatus: 'expired',
      subscriptionPlan: '',
      subscriptionStatus: 'expired',
      trialEndsAt: null,
      subscriptionEndsAt: null,
      cancelAtPeriodEnd: false,
      pendingPlanKey: '',
      pendingPlanEffectiveAt: null,
    };
  }

  return {
    id: String(subscription._id),
    accountStatus: accountStatusFromSubscription(subscription),
    subscriptionPlan: subscription.plan_key || '',
    subscriptionStatus: subscription.status || '',
    trialEndsAt: toIsoDate(subscription.trial_end),
    subscriptionEndsAt: toIsoDate(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    pendingPlanKey: subscription.pending_plan_key || '',
    pendingPlanEffectiveAt: toIsoDate(subscription.pending_plan_effective_at),
    stripeSubscriptionScheduleId: subscription.stripe_subscription_schedule_id || '',
    stripeCustomerId: subscription.stripe_customer_id || '',
    stripeSubscriptionId: subscription.stripe_subscription_id || '',
    stripePriceId: subscription.stripe_price_id || '',
  };
}

export async function expireTrialIfNeeded(subscription) {
  if (
    subscription?.status === 'free_trial' &&
    subscription.trial_end &&
    new Date(subscription.trial_end) <= new Date()
  ) {
    subscription.status = 'expired';
    await subscription.save();
  }
  return subscription;
}

export async function createFreeTrialSubscription(userId, trialEndsAt) {
  const now = new Date();
  const trialEnd = trialEndsAt || new Date(now.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);

  return Subscription.findOneAndUpdate(
    { user_id: userId },
    {
      $setOnInsert: {
        user_id: userId,
        plan_key: 'basic',
        status: 'free_trial',
        trial_start: now,
        trial_end: trialEnd,
      },
    },
    { returnDocument: 'after', upsert: true },
  );
}

export async function getOrCreateSubscriptionForUser(user) {
  let subscription = await Subscription.findOne({ user_id: user._id });
  if (!subscription) {
    const createdAt = user.createdAt ? new Date(user.createdAt) : new Date();
    const trialEnd = new Date(createdAt.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    subscription = await createFreeTrialSubscription(user._id, trialEnd);
  }
  return expireTrialIfNeeded(subscription);
}

export async function getFreshSubscriptionForUser(user) {
  await getOrCreateSubscriptionForUser(user);
  await refreshSubscriptionFromStripeForUser(user);
  const subscription = await Subscription.findOne({ user_id: user._id });
  return expireTrialIfNeeded(subscription);
}

export async function getSubscriptionForRead(user, { refresh = false } = {}) {
  if (refresh) {
    return getFreshSubscriptionForUser(user);
  }
  const subscription = await getOrCreateSubscriptionForUser(user);
  return expireTrialIfNeeded(subscription);
}

export async function getSubscriptionPresentationForUser(user, { refreshFromStripe = true } = {}) {
  const subscription = refreshFromStripe
    ? await getFreshSubscriptionForUser(user)
    : await getOrCreateSubscriptionForUser(user);
  const serialized = serializeSubscription(subscription);
  const [usage] = await Promise.all([getPlanUsageForUser(user._id)]);
  return {
    ...serialized,
    planLimits: getPlanLimitsForSubscription(subscription),
    usage,
    isExpired: serialized.accountStatus === 'expired',
    raw: subscription,
  };
}

function buildStripeCustomerDetails(user, profile, planKey) {
  const fullName =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    || String(profile?.full_name || '').trim()
    || undefined;

  const company = String(profile?.company_name || '').trim();
  const role = String(profile?.professional_type || user.role || '').trim();
  const planName = planKey ? getPlan(planKey)?.name : '';

  const descriptionParts = ['Nesti'];
  if (planName) descriptionParts.push(planName);
  if (company) descriptionParts.push(company);
  else if (role) descriptionParts.push(role);

  return {
    email: user.email,
    name: fullName,
    description: descriptionParts.join(' · '),
    metadata: {
      user_id: String(user._id),
      ...(company ? { company_name: company } : {}),
      ...(role ? { professional_type: role } : {}),
      ...(planKey ? { plan_key: String(planKey) } : {}),
    },
  };
}

async function loadProfessionalProfileForUser(userId) {
  return ProfessionalProfile.findOne({ user_id: userId })
    .select('company_name professional_type full_name')
    .lean();
}

export async function ensureStripeCustomerForUser(user, subscription, options = {}) {
  const profile = await loadProfessionalProfileForUser(user._id);
  const customerDetails = buildStripeCustomerDetails(user, profile, options.planKey);
  const stripe = getStripeClient();

  if (subscription?.stripe_customer_id) {
    await stripe.customers.update(subscription.stripe_customer_id, customerDetails);
    return subscription.stripe_customer_id;
  }

  const customer = await stripe.customers.create(customerDetails);

  await Subscription.updateOne(
    { user_id: user._id },
    { $set: { stripe_customer_id: customer.id, last_synced_at: new Date() } },
    { upsert: true },
  );

  return customer.id;
}

export async function createCheckoutSessionForUser(user, planKey) {
  const plan = getPlan(planKey);
  if (!plan) {
    return { ok: false, code: 400, message: 'Invalid subscription plan.' };
  }

  const priceId = getStripePriceId(plan.plan_key);
  if (!priceId) {
    return { ok: false, code: 503, message: `${plan.name} Stripe price is not configured.` };
  }

  const subscription = await getOrCreateSubscriptionForUser(user);
  await ensureStripeCustomerForUser(user, subscription, { planKey: plan.plan_key });
  const freshSubscription = await Subscription.findOne({ user_id: user._id });
  const purchaseEligibility = await assertUserCanPurchasePlan(user, freshSubscription);
  if (!purchaseEligibility.ok) {
    return purchaseEligibility;
  }

  const stripe = getStripeClient();
  const customerId = freshSubscription?.stripe_customer_id
    || await ensureStripeCustomerForUser(user, freshSubscription, { planKey: plan.plan_key });
  const frontendUrl = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || '').replace(/\/+$/, '');
  if (!frontendUrl) {
    return { ok: false, code: 503, message: 'FRONTEND_URL is not configured.' };
  }
  const successUrl = frontendUrl
    ? `${frontendUrl}/settings?billing=success`
    : undefined;
  const cancelUrl = frontendUrl
    ? `${frontendUrl}/settings?billing=cancelled`
    : undefined;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      user_id: String(user._id),
      plan_key: plan.plan_key,
    },
    subscription_data: {
      metadata: {
        user_id: String(user._id),
        plan_key: plan.plan_key,
      },
    },
  });

  return { ok: true, session };
}

export async function syncStripeSubscription(stripeSubscription, extra = {}) {
  const subscriptionId = normalizeStripeId(stripeSubscription?.id);
  if (!subscriptionId) return null;

  const priceId = firstSubscriptionPriceId(stripeSubscription);
  const plan = getPlanByPriceId(priceId);
  const customerId = normalizeStripeId(stripeSubscription.customer);
  const userId = String(stripeSubscription?.metadata?.user_id || extra.user_id || '').trim();
  const planKey = String(plan?.plan_key || stripeSubscription?.metadata?.plan_key || extra.plan_key || '').trim();

  const filter = userId
    ? { user_id: userId }
    : { stripe_subscription_id: subscriptionId };

  const update = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_price_id: priceId,
    status: String(stripeSubscription.status || 'incomplete'),
    current_period_start: getStripeSubscriptionPeriodStart(stripeSubscription),
    current_period_end: getStripeSubscriptionPeriodEnd(stripeSubscription),
    cancel_at_period_end: Boolean(stripeSubscription.cancel_at_period_end),
    trial_start: toDateFromUnix(stripeSubscription.trial_start),
    trial_end: toDateFromUnix(stripeSubscription.trial_end),
    latest_invoice_id: normalizeStripeId(stripeSubscription.latest_invoice),
    last_synced_at: new Date(),
    metadata: {
      ...(stripeSubscription.metadata || {}),
    },
  };

  if (planKey && getPlan(planKey)) update.plan_key = planKey;
  if (extra.last_stripe_event_id) update.last_stripe_event_id = extra.last_stripe_event_id;

  const existing = await Subscription.findOne(filter).select('pending_plan_key').lean();
  const shouldClearPendingPlan = Boolean(
    extra.clearPendingPlan ||
    (existing?.pending_plan_key && planKey && existing.pending_plan_key === planKey),
  );

  const synced = await Subscription.findOneAndUpdate(
    filter,
    {
      $set: update,
      ...(shouldClearPendingPlan
        ? {
            $unset: {
              pending_plan_key: '',
              pending_plan_effective_at: '',
              stripe_subscription_schedule_id: '',
            },
          }
        : {}),
    },
    { returnDocument: 'after', upsert: Boolean(userId) },
  );

  const activeStatuses = new Set(['active']);
  if (synced?.user_id && activeStatuses.has(String(stripeSubscription.status || ''))) {
    try {
      const { processPaidSubscriptionReferralCredit } = await import('../referral/networkCircle.js');
      await processPaidSubscriptionReferralCredit(synced.user_id, {
        stripeEventId: extra.last_stripe_event_id || '',
      });
    } catch (err) {
      console.warn('[networkCircle] referral credit on subscription sync failed', err?.message || err);
    }
  }

  return synced;
}

export async function syncCheckoutSession(session, eventId = '') {
  const stripe = getStripeClient();
  const subscriptionId = normalizeStripeId(session.subscription);
  if (!subscriptionId) return null;
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  return syncStripeSubscription(stripeSubscription, {
    user_id: session?.metadata?.user_id,
    plan_key: session?.metadata?.plan_key,
    last_stripe_event_id: eventId,
  });
}

export async function updateInvoicePaymentState(invoice, paymentStatus, eventId = '') {
  const subscriptionId = normalizeStripeId(invoice?.subscription);
  if (!subscriptionId) return null;

  const update = {
    latest_invoice_id: normalizeStripeId(invoice.id),
    last_payment_status: paymentStatus,
    last_stripe_event_id: eventId,
    last_synced_at: new Date(),
  };
  if (paymentStatus === 'failed') update.status = 'past_due';

  const synced = await Subscription.findOneAndUpdate(
    { stripe_subscription_id: subscriptionId },
    { $set: update },
    { returnDocument: 'after' },
  );

  if (paymentStatus === 'paid' && synced?.user_id) {
    try {
      const { processPaidSubscriptionReferralCredit } = await import('../referral/networkCircle.js');
      const amountPaid = Number(invoice?.amount_paid ?? invoice?.total ?? 0);
      await processPaidSubscriptionReferralCredit(synced.user_id, {
        stripeEventId: eventId,
        invoiceAmountPaid: amountPaid,
      });
    } catch (err) {
      console.warn('[networkCircle] referral credit on invoice.paid failed', err?.message || err);
    }
  }

  return synced;
}

export async function syncSubscriptionSchedule(schedule, eventId = '') {
  const scheduleId = normalizeStripeId(schedule?.id);
  if (!scheduleId) return null;

  const subscriptionId =
    normalizeStripeId(schedule.subscription) || normalizeStripeId(schedule.released_subscription);
  const terminalStatuses = new Set(['completed', 'released', 'canceled']);
  const isTerminalSchedule = terminalStatuses.has(String(schedule.status || ''));
  const pendingPlanKey = String(
    schedule?.metadata?.pending_plan_key
    || schedule?.phases?.[1]?.metadata?.plan_key
    || '',
  ).trim();
  const pendingEffectiveAt = toDateFromUnix(schedule?.phases?.[0]?.end_date);
  const update = {
    last_stripe_event_id: eventId,
    last_synced_at: new Date(),
  };

  if (isTerminalSchedule) {
    update.pending_plan_key = '';
    update.pending_plan_effective_at = null;
    update.stripe_subscription_schedule_id = '';
  } else {
    update.stripe_subscription_schedule_id = scheduleId;
    if (pendingPlanKey && getPlan(pendingPlanKey)) {
      update.pending_plan_key = pendingPlanKey;
      update.pending_plan_effective_at = pendingEffectiveAt;
    }
  }

  let synced = await Subscription.findOneAndUpdate(
    { stripe_subscription_schedule_id: scheduleId },
    { $set: update },
    { returnDocument: 'after' },
  );

  if (!synced && subscriptionId) {
    synced = await Subscription.findOneAndUpdate(
      { stripe_subscription_id: subscriptionId },
      { $set: update },
      { returnDocument: 'after' },
    );
  }

  if (subscriptionId && isTerminalSchedule) {
    const stripe = getStripeClient();
    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      return syncStripeSubscription(stripeSubscription, {
        last_stripe_event_id: eventId,
        clearPendingPlan: true,
      });
    } catch (_err) {
      // Released/canceled schedules can arrive after Stripe has detached or removed
      // the subscription reference. The local pending schedule cleanup above is the
      // important idempotent work; do not fail the webhook for a missing remote read.
      return synced;
    }
  }

  return synced;
}

export async function cancelSubscriptionForUser(user) {
  const subscription = await Subscription.findOne({ user_id: user._id });
  if (!subscription?.stripe_subscription_id) {
    return { ok: false, code: 404, message: 'No active Stripe subscription found.' };
  }

  const stripe = getStripeClient();
  const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
  const attachedScheduleId = normalizeStripeId(stripeSubscription.schedule);

  if (subscription.stripe_subscription_schedule_id || attachedScheduleId) {
    await clearPendingScheduleIfAny(stripe, subscription, attachedScheduleId);
  }

  const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    cancel_at_period_end: true,
  });
  const synced = await syncStripeSubscription(updated, { clearPendingPlan: true });
  return { ok: true, subscription: synced };
}

export async function resumeSubscriptionForUser(user) {
  const subscription = await Subscription.findOne({ user_id: user._id });
  if (!subscription?.stripe_subscription_id) {
    return { ok: false, code: 404, message: 'No Stripe subscription found.' };
  }

  if (!subscription.cancel_at_period_end) {
    return { ok: false, code: 400, message: 'Subscription is not scheduled to cancel.' };
  }

  const stripe = getStripeClient();
  const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    cancel_at_period_end: false,
  });
  const synced = await syncStripeSubscription(updated);
  return { ok: true, subscription: synced };
}

export async function changeSubscriptionPlanForUser(user, planKey) {
  const plan = getPlan(planKey);
  if (!plan) {
    return { ok: false, code: 400, message: 'Invalid subscription plan.' };
  }

  const priceId = getStripePriceId(plan.plan_key);
  if (!priceId) {
    return { ok: false, code: 503, message: `${plan.name} Stripe price is not configured.` };
  }

  const subscription = await getFreshSubscriptionForUser(user);
  if (!userHasActiveSubscriptionAccess(subscription)) {
    return {
      ok: false,
      code: 409,
      message: 'No active subscription to change. Subscribe to a plan first.',
    };
  }

  if (!subscription?.stripe_subscription_id) {
    return { ok: false, code: 404, message: 'No Stripe subscription found for this account.' };
  }

  const currentPlanKey = String(subscription.plan_key || '').trim().toLowerCase();
  if (currentPlanKey === plan.plan_key) {
    return { ok: false, code: 400, message: 'You are already on this plan.' };
  }

  const currentTier = getPlanTier(currentPlanKey);
  const targetTier = getPlanTier(plan.plan_key);
  if (!currentTier || !targetTier) {
    return { ok: false, code: 400, message: 'Unable to compare subscription plans.' };
  }

  const stripe = getStripeClient();
  const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id, {
    expand: ['latest_invoice'],
  });
  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) {
    return { ok: false, code: 500, message: 'Unable to read subscription items from Stripe.' };
  }

  await ensureStripeCustomerForUser(user, subscription, { planKey: plan.plan_key });

  if (targetTier > currentTier) {
    await clearPendingScheduleIfAny(stripe, subscription, normalizeStripeId(stripeSubscription.schedule));

    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{ id: subscriptionItemId, price: priceId }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
      expand: ['latest_invoice'],
      metadata: {
        user_id: String(user._id),
        plan_key: plan.plan_key,
      },
    });

    const invoice = updated.latest_invoice && typeof updated.latest_invoice === 'object'
      ? updated.latest_invoice
      : null;

    const synced = await syncStripeSubscription(updated, {
      user_id: String(user._id),
      plan_key: plan.plan_key,
      clearPendingPlan: true,
    });

    return {
      ok: true,
      changeType: 'upgrade',
      subscription: synced,
      planName: plan.name,
      invoice: invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            hostedInvoiceUrl: invoice.hosted_invoice_url || '',
            invoicePdf: invoice.invoice_pdf || '',
            amountDue: invoice.amount_due,
            amountPaid: invoice.amount_paid,
            displayAmountDue: formatInvoiceAmount(invoice.amount_due, invoice.currency),
          }
        : null,
    };
  }

  const latestInvoice = stripeSubscription.latest_invoice && typeof stripeSubscription.latest_invoice === 'object'
    ? stripeSubscription.latest_invoice
    : null;
  if (invoiceRequiresPayment(latestInvoice) && String(latestInvoice.billing_reason || '') === 'subscription_update') {
    await clearPendingScheduleIfAny(stripe, subscription, normalizeStripeId(stripeSubscription.schedule));
    await voidOrDeleteUnpaidInvoice(stripe, latestInvoice);

    const restored = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: false,
      items: [{ id: subscriptionItemId, price: priceId }],
      proration_behavior: 'none',
      payment_behavior: 'allow_incomplete',
      expand: ['latest_invoice'],
      metadata: {
        user_id: String(user._id),
        plan_key: plan.plan_key,
      },
    });

    const synced = await syncStripeSubscription(restored, {
      user_id: String(user._id),
      clearPendingPlan: true,
    });

    return {
      ok: true,
      changeType: 'revert_unpaid_upgrade',
      subscription: synced,
      planName: plan.name,
    };
  }

  const currentPeriodStart = getStripeSubscriptionPeriodStart(stripeSubscription);
  const currentPeriodEnd = getStripeSubscriptionPeriodEnd(stripeSubscription);
  const currentPeriodStartTs = stripeTimestampFromDate(currentPeriodStart);
  const currentPeriodEndTs = stripeTimestampFromDate(currentPeriodEnd);
  if (!currentPeriodEndTs) {
    return { ok: false, code: 500, message: 'Unable to read current billing period from Stripe.' };
  }

  const currentItems = buildScheduleItemsFromSubscription(stripeSubscription);
  if (!currentItems.length) {
    return { ok: false, code: 500, message: 'Unable to read current subscription items from Stripe.' };
  }

  const schedule = await getOrCreateSubscriptionSchedule(
    stripe,
    stripeSubscription,
    subscription.stripe_subscription_schedule_id,
  );

  const activePhase = schedule.phases?.find((phase) => {
    const startsAt = Number(phase.start_date || 0);
    const endsAt = Number(phase.end_date || 0);
    const now = Math.floor(Date.now() / 1000);
    return startsAt <= now && (!endsAt || endsAt >= now);
  }) || schedule.phases?.[0];

  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    metadata: {
      user_id: String(user._id),
      pending_plan_key: plan.plan_key,
    },
    phases: [
      {
        items: currentItems,
        start_date: activePhase?.start_date || currentPeriodStartTs || 'now',
        end_date: currentPeriodEndTs,
        proration_behavior: 'none',
        metadata: {
          user_id: String(user._id),
          plan_key: currentPlanKey,
        },
      },
      {
        items: buildSinglePriceScheduleItem(priceId),
        proration_behavior: 'none',
        metadata: {
          user_id: String(user._id),
          plan_key: plan.plan_key,
        },
      },
    ],
  });

  const synced = await Subscription.findOneAndUpdate(
    { _id: subscription._id },
    {
      $set: {
        pending_plan_key: plan.plan_key,
        pending_plan_effective_at: currentPeriodEnd,
        stripe_subscription_schedule_id: schedule.id,
        cancel_at_period_end: false,
        last_synced_at: new Date(),
      },
    },
    { returnDocument: 'after' },
  );

  return {
    ok: true,
    changeType: 'downgrade',
    subscription: synced,
    planName: plan.name,
    effectiveAt: toIsoDate(currentPeriodEnd),
  };
}

function formatInvoiceAmount(amount, currency = 'usd') {
  const value = Number(amount || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'usd').toUpperCase(),
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function describeInvoice(invoice = {}) {
  const lines = invoice.lines?.data || [];
  const firstDescription = lines[0]?.description || 'Subscription';

  if (String(invoice.billing_reason || '') !== 'subscription_update') {
    return firstDescription;
  }

  const planLines = lines
    .map((line) => ({
      amount: Number(line.amount || 0),
      plan: getPlanByPriceId(invoiceLinePriceId(line)),
      description: String(line.description || ''),
    }))
    .filter((line) => line.plan);

  const creditLine = planLines.find((line) => line.amount < 0);
  const chargeLine = planLines.find((line) => line.amount > 0);
  const fromPlan = creditLine?.plan || null;
  const toPlan = chargeLine?.plan || null;

  if (fromPlan && toPlan && fromPlan.plan_key !== toPlan.plan_key) {
    const direction = getPlanTier(toPlan.plan_key) > getPlanTier(fromPlan.plan_key)
      ? 'Upgrade'
      : 'Plan change';
    return `${direction} prorated charge: ${fromPlan.name} → ${toPlan.name}`;
  }

  if (toPlan) {
    return `Prorated subscription charge: ${toPlan.name}`;
  }

  if (/unused time|remaining time/i.test(firstDescription)) {
    return 'Prorated subscription adjustment';
  }

  return firstDescription;
}

function buildProrationNote(invoice = {}) {
  if (String(invoice.billing_reason || '') !== 'subscription_update') return '';

  const lines = invoice.lines?.data || [];
  let creditTotal = 0;
  let chargeTotal = 0;
  let fromPlan = null;
  let toPlan = null;

  for (const line of lines) {
    const amount = Number(line.amount || 0);
    const plan = getPlanByPriceId(invoiceLinePriceId(line));
    if (amount < 0) {
      creditTotal += Math.abs(amount);
      if (!fromPlan && plan) fromPlan = plan;
    }
    if (amount > 0) {
      chargeTotal += amount;
      if (!toPlan && plan) toPlan = plan;
    }
  }

  if (!creditTotal && !chargeTotal) return '';

  const net = Math.max(0, chargeTotal - creditTotal);
  const parts = [];
  if (chargeTotal > 0) {
    parts.push(
      `${formatInvoiceAmount(chargeTotal, invoice.currency)} for remaining days on ${toPlan?.name || 'the new plan'}`,
    );
  }
  if (creditTotal > 0) {
    parts.push(
      `${formatInvoiceAmount(creditTotal, invoice.currency)} credit for unused ${fromPlan?.name || 'previous plan'} time`,
    );
  }

  const renewalPlan = toPlan?.display_amount || toPlan?.name || 'the new plan';
  return `Prorated today only: ${parts.join(' minus ')} = ${formatInvoiceAmount(net, invoice.currency)}. Your next renewal is the full ${renewalPlan}/month price.`;
}

export async function listPaidInvoicesForUser(user, limit = 24) {
  const subscription = await Subscription.findOne({ user_id: user._id }).lean();
  const customerId = String(subscription?.stripe_customer_id || '').trim();
  if (!customerId) return [];

  const stripe = getStripeClient();
  const result = await stripe.invoices.list({
    customer: customerId,
    status: 'paid',
    limit: Math.min(Math.max(Number(limit) || 24, 1), 100),
  });

  return result.data.map((invoice) => ({
    id: invoice.id,
    number: invoice.number || invoice.id,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency || 'usd',
    displayAmount: formatInvoiceAmount(invoice.amount_paid, invoice.currency),
    status: invoice.status,
    createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
    periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    hostedInvoiceUrl: invoice.hosted_invoice_url || '',
    invoicePdf: invoice.invoice_pdf || '',
    description: describeInvoice(invoice),
    prorationNote: buildProrationNote(invoice),
    billingReason: invoice.billing_reason || '',
  }));
}
