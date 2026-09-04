import Subscription from '../../models/Subscription.js';
import { getPlan, getPlanByPriceId, getPlanTier, getStripePriceId } from './plans.js';
import { getStripeClient } from './stripeClient.js';
import {
  expireCanceledSubscriptionIfNeeded,
  markSubscriptionStripeStateExpired,
} from './subscriptionLocalService.js';
import {
  clearPendingScheduleIfAny,
  voidOrDeleteUnpaidInvoice,
} from './subscriptionScheduleService.js';
import {
  ACTIVE_ACCESS_STATUSES,
  STRIPE_BLOCKING_STATUSES,
  firstSubscriptionPriceId,
  getStripeSubscriptionPeriodEnd,
  getStripeSubscriptionPeriodStart,
  invoiceLinePriceId,
  invoiceRequiresPayment,
  isStripeResourceMissing,
  normalizeStripeId,
  toDateFromUnix,
} from './subscriptionShared.js';

export async function findBlockingStripeSubscription(customerId) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId) return null;
  const result = await getStripeClient().subscriptions.list({
    customer: normalizedCustomerId,
    status: 'all',
    limit: 20,
  });
  return result.data.find((sub) => STRIPE_BLOCKING_STATUSES.has(String(sub.status || ''))) || null;
}

function planFromInvoice(invoice = {}) {
  for (const line of invoice.lines?.data || []) {
    const plan = getPlanByPriceId(invoiceLinePriceId(line));
    if (plan) return plan;
  }
  return null;
}

function invoiceHasPrice(invoice = {}, priceId = '') {
  const normalizedPriceId = String(priceId || '').trim();
  if (!normalizedPriceId) return false;
  return (invoice.lines?.data || []).some(
    (line) => invoiceLinePriceId(line) === normalizedPriceId,
  );
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

async function repairUnpaidUpgradeIfNeeded(stripe, user, localSubscription, stripeSubscription) {
  const latestInvoice = stripeSubscription.latest_invoice
    && typeof stripeSubscription.latest_invoice === 'object'
    ? stripeSubscription.latest_invoice
    : null;
  if (
    !invoiceRequiresPayment(latestInvoice)
    || String(latestInvoice.billing_reason || '') !== 'subscription_update'
  ) {
    return { repaired: false, stripeSubscription };
  }

  const subscriptionId = normalizeStripeId(stripeSubscription);
  const customerId = normalizeStripeId(stripeSubscription.customer)
    || String(localSubscription?.stripe_customer_id || '').trim();
  const currentPriceId = firstSubscriptionPriceId(stripeSubscription);
  const lastPaid = await findLatestPaidPlanForSubscription(stripe, customerId, subscriptionId);
  if (!lastPaid?.priceId || lastPaid.priceId === currentPriceId) {
    return { repaired: false, stripeSubscription };
  }
  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) return { repaired: false, stripeSubscription };

  await clearPendingScheduleIfAny(
    stripe,
    localSubscription,
    normalizeStripeId(stripeSubscription.schedule),
  );
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
  const customerId = normalizeStripeId(stripeSubscription.customer)
    || String(localSubscription?.stripe_customer_id || '').trim();
  const currentPriceId = firstSubscriptionPriceId(stripeSubscription);
  const lastPaid = await findLatestPaidPlanForSubscription(stripe, customerId, subscriptionId);
  if (!lastPaid?.priceId || lastPaid.priceId === currentPriceId) {
    return { repaired: false, stripeSubscription };
  }
  if (invoiceHasPrice(lastPaid.invoice, currentPriceId)) {
    return { repaired: false, stripeSubscription };
  }

  const currentPlan = getPlanByPriceId(currentPriceId);
  const currentTier = getPlanTier(currentPlan?.plan_key);
  const lastPaidTier = getPlanTier(lastPaid.plan?.plan_key);
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
      if (new Set(['not_started', 'active']).has(String(schedule.status || ''))) {
        return { repaired: false, stripeSubscription };
      }
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error;
    }
  }
  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) return { repaired: false, stripeSubscription };

  await clearPendingScheduleIfAny(stripe, localSubscription, attachedScheduleId);
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

export async function refreshSubscriptionFromStripeForUser(user) {
  const subscription = await Subscription.findOne({ user_id: user._id });
  const customerId = String(subscription?.stripe_customer_id || '').trim();
  if (!customerId) return expireCanceledSubscriptionIfNeeded(subscription);

  let activeStripeSubscription;
  try {
    activeStripeSubscription = await findBlockingStripeSubscription(customerId);
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return markSubscriptionStripeStateExpired(user._id);
    }
    throw error;
  }
  const stripe = getStripeClient();
  if (!activeStripeSubscription) {
    const localSubscriptionId = String(subscription?.stripe_subscription_id || '').trim();
    if (localSubscriptionId) {
      try {
        const endedStripeSubscription = await stripe.subscriptions.retrieve(localSubscriptionId);
        const synced = await syncStripeSubscription(endedStripeSubscription, {
          user_id: String(user._id),
        });
        return expireCanceledSubscriptionIfNeeded(synced);
      } catch (error) {
        if (isStripeResourceMissing(error)) {
          return markSubscriptionStripeStateExpired(user._id);
        }
        throw error;
      }
    }
    return expireCanceledSubscriptionIfNeeded(subscription);
  }

  let detailedStripeSubscription;
  try {
    detailedStripeSubscription = await stripe.subscriptions.retrieve(activeStripeSubscription.id, {
      expand: ['latest_invoice'],
    });
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return markSubscriptionStripeStateExpired(user._id);
    }
    throw error;
  }
  const repairResult = await repairUnpaidUpgradeIfNeeded(
    stripe,
    user,
    subscription,
    detailedStripeSubscription,
  );
  if (repairResult.repaired) return repairResult.subscription;
  const paidPlanRepairResult = await repairPaidPlanMismatchIfNeeded(
    stripe,
    user,
    subscription,
    detailedStripeSubscription,
  );
  if (paidPlanRepairResult.repaired) return paidPlanRepairResult.subscription;

  const localSubscriptionId = String(subscription?.stripe_subscription_id || '').trim();
  const localStatus = String(subscription?.status || '').trim();
  const localPriceId = String(subscription?.stripe_price_id || '').trim();
  const stripePriceId = firstSubscriptionPriceId(detailedStripeSubscription);
  const stripePeriodEnd = getStripeSubscriptionPeriodEnd(detailedStripeSubscription);
  const localPeriodEndMs = subscription?.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : null;
  const stripePeriodEndMs = stripePeriodEnd ? stripePeriodEnd.getTime() : null;
  const periodEndMatches =
    localPeriodEndMs != null
    && stripePeriodEndMs != null
    && localPeriodEndMs === stripePeriodEndMs;
  const cancelFlagMatches =
    Boolean(subscription?.cancel_at_period_end)
    === Boolean(detailedStripeSubscription.cancel_at_period_end);
  if (
    localSubscriptionId === String(detailedStripeSubscription.id || '').trim()
    && ACTIVE_ACCESS_STATUSES.has(localStatus)
    && Boolean(subscription?.current_period_end)
    && localPriceId === stripePriceId
    && periodEndMatches
    && cancelFlagMatches
  ) {
    return expireCanceledSubscriptionIfNeeded(subscription);
  }
  return syncStripeSubscription(detailedStripeSubscription, { user_id: String(user._id) });
}

export async function syncStripeSubscription(stripeSubscription, extra = {}) {
  const subscriptionId = normalizeStripeId(stripeSubscription?.id);
  if (!subscriptionId) return null;
  const priceId = firstSubscriptionPriceId(stripeSubscription);
  const plan = getPlanByPriceId(priceId);
  const customerId = normalizeStripeId(stripeSubscription.customer);
  const userId = String(
    stripeSubscription?.metadata?.user_id || extra.user_id || '',
  ).trim();
  const planKey = String(
    plan?.plan_key || stripeSubscription?.metadata?.plan_key || extra.plan_key || '',
  ).trim();
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
    metadata: { ...(stripeSubscription.metadata || {}) },
  };
  if (planKey && getPlan(planKey)) update.plan_key = planKey;
  if (extra.last_stripe_event_id) update.last_stripe_event_id = extra.last_stripe_event_id;

  const existing = await Subscription.findOne(filter).select('pending_plan_key').lean();
  const shouldClearPendingPlan = Boolean(
    extra.clearPendingPlan
    || (existing?.pending_plan_key && planKey && existing.pending_plan_key === planKey),
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
  if (synced?.user_id && String(stripeSubscription.status || '') === 'active') {
    try {
      const { processPaidSubscriptionReferralCredit } = await import('../referral/networkCircle.js');
      await processPaidSubscriptionReferralCredit(synced.user_id, {
        stripeEventId: extra.last_stripe_event_id || '',
      });
    } catch (error) {
      console.warn('[networkCircle] referral credit on subscription sync failed', error?.message || error);
    }
  }
  return synced;
}

export async function syncCheckoutSession(session, eventId = '') {
  const stripe = getStripeClient();
  const subscriptionId = normalizeStripeId(session.subscription);
  if (!subscriptionId) return null;
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const subscriptionType = String(
    session?.metadata?.subscription_type || stripeSubscription?.metadata?.subscription_type || '',
  ).trim().toLowerCase();
  if (subscriptionType === 'client') {
    const { syncClientStripeSubscription } = await import('../client/clientSubscriptionService.js');
    return syncClientStripeSubscription(stripeSubscription);
  }
  return syncStripeSubscription(stripeSubscription, {
    user_id: session?.metadata?.user_id,
    plan_key: session?.metadata?.plan_key,
    last_stripe_event_id: eventId,
  });
}

export async function updateInvoicePaymentState(invoice, paymentStatus, eventId = '') {
  const subscriptionId = normalizeStripeId(invoice?.subscription);
  if (!subscriptionId) return null;
  let synced = null;
  try {
    const stripeSubscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
    const subscriptionType = String(
      stripeSubscription?.metadata?.subscription_type || '',
    ).trim().toLowerCase();
    if (subscriptionType === 'client') {
      const { syncClientStripeSubscription } = await import('../client/clientSubscriptionService.js');
      synced = await syncClientStripeSubscription(stripeSubscription);
    } else {
      const ClientSubscription = (await import('../../models/ClientSubscription.js')).default;
      const existingClient = await ClientSubscription.findOne({
        stripe_subscription_id: subscriptionId,
      }).select('_id').lean();
      if (existingClient) {
        const { syncClientStripeSubscription } = await import('../client/clientSubscriptionService.js');
        synced = await syncClientStripeSubscription(stripeSubscription);
      } else {
        synced = await syncStripeSubscription(stripeSubscription, {
          last_stripe_event_id: eventId,
        });
      }
    }
  } catch (error) {
    console.warn('invoice payment sync from Stripe subscription failed:', error?.message || error);
  }

  const update = {
    latest_invoice_id: normalizeStripeId(invoice.id),
    last_payment_status: paymentStatus,
    last_stripe_event_id: eventId,
    last_synced_at: new Date(),
  };
  if (paymentStatus === 'failed') update.status = 'past_due';
  const paymentSynced = await Subscription.findOneAndUpdate(
    { stripe_subscription_id: subscriptionId },
    { $set: update },
    { returnDocument: 'after' },
  );
  if (paymentSynced) synced = paymentSynced;

  if (paymentStatus === 'paid' && synced?.user_id) {
    try {
      const {
        processPaidSubscriptionReferralCredit,
        syncPendingCreditFromStripeBalance,
      } = await import('../referral/networkCircle.js');
      await processPaidSubscriptionReferralCredit(synced.user_id, {
        stripeEventId: eventId,
        invoiceAmountPaid: Number(invoice?.amount_paid ?? invoice?.total ?? 0),
      });
      await syncPendingCreditFromStripeBalance(synced.user_id, {
        stripeCustomerId: synced.stripe_customer_id,
      });
    } catch (error) {
      console.warn('[networkCircle] referral credit on invoice.paid failed', error?.message || error);
    }
  }
  return synced;
}

export async function syncSubscriptionSchedule(schedule, eventId = '') {
  const scheduleId = normalizeStripeId(schedule?.id);
  if (!scheduleId) return null;
  const subscriptionId =
    normalizeStripeId(schedule.subscription) || normalizeStripeId(schedule.released_subscription);
  const isTerminalSchedule = new Set(['completed', 'released', 'canceled'])
    .has(String(schedule.status || ''));
  const pendingPlanKey = String(
    schedule?.metadata?.pending_plan_key
    || schedule?.phases?.[1]?.metadata?.plan_key
    || '',
  ).trim();
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
      update.pending_plan_effective_at = toDateFromUnix(schedule?.phases?.[0]?.end_date);
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
    try {
      const stripeSubscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
      return syncStripeSubscription(stripeSubscription, {
        last_stripe_event_id: eventId,
        clearPendingPlan: true,
      });
    } catch {
      return synced;
    }
  }
  return synced;
}
