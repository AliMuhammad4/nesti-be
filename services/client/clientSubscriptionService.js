import ClientSubscription from '../../models/ClientSubscription.js';
import User from '../../models/User.js';
import { getClientPlan } from './plans.js';
import { getStripeClient } from '../billing/stripeClient.js';

// Cache for dynamically created prices
const priceCache = new Map();
const ACTIVE_ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);
const CLIENT_TIER_ORDER = {
  basic: 1,
  standard: 2,
  pro: 3,
};

function toSafeDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Stripe timestamps are usually unix seconds; support ms as fallback.
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDateFromUnix(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stripeTimestampFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

function normalizeStripeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.id || '');
}

function getClientTierRank(tier) {
  return CLIENT_TIER_ORDER[String(tier || '').trim().toLowerCase()] || 0;
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

function formatChangeInvoiceAmount(amount, currency = 'usd') {
  const value = Number(amount || 0);
  const normalizedCurrency = String(currency || 'usd').trim().toUpperCase() || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: value % 100 === 0 ? 0 : 2,
    }).format(value / 100);
  } catch {
    return `${normalizedCurrency} ${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}`;
  }
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

async function clearClientPendingScheduleIfAny(stripe, subscription, attachedScheduleId = '') {
  const scheduleId = String(subscription?.stripe_subscription_schedule_id || attachedScheduleId || '').trim();
  if (!scheduleId) return;

  try {
    await stripe.subscriptionSchedules.release(scheduleId);
  } catch (err) {
    if (err?.code !== 'resource_missing') throw err;
  }

  await ClientSubscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        pending_tier: '',
        pending_tier_effective_at: null,
        stripe_subscription_schedule_id: '',
      },
    },
  );
}

async function getOrCreateClientSubscriptionSchedule(stripe, stripeSubscription, existingScheduleId = '') {
  const scheduleId = String(existingScheduleId || normalizeStripeId(stripeSubscription.schedule)).trim();
  if (scheduleId) {
    try {
      return await stripe.subscriptionSchedules.retrieve(scheduleId);
    } catch (err) {
      if (err?.code !== 'resource_missing') throw err;
    }
  }

  return stripe.subscriptionSchedules.create({
    from_subscription: stripeSubscription.id,
  });
}

async function getOrCreateStripePrice(stripe, plan) {
  const cacheKey = `client_${plan.tier}`;
  
  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey);
  }

  try {
    const productName = `Nesti Client ${plan.name}`;
    
    const products = await stripe.products.search({
      query: `name:'${productName}'`,
      limit: 1,
    });

    let product;
    if (products.data.length > 0) {
      product = products.data[0];
    } else {
      product = await stripe.products.create({
        name: productName,
        description: `${plan.name} tier client subscription`,
        metadata: {
          subscription_type: 'client',
          tier: plan.tier,
        },
      });
    }

    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 1,
    });

    let price;
    if (prices.data.length > 0) {
      price = prices.data[0];
    } else {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.amount,
        currency: plan.currency,
        recurring: {
          interval: plan.interval,
        },
        metadata: {
          subscription_type: 'client',
          tier: plan.tier,
        },
      });
    }

    priceCache.set(cacheKey, price.id);
    return price.id;
  } catch (error) {
    console.error('Error creating/fetching Stripe price:', error);
    throw new Error('Failed to prepare subscription price');
  }
}

export async function createClientCheckoutSession(userId, tier) {
  const plan = getClientPlan(tier);
  if (!plan) {
    throw new Error(`Invalid client tier: ${tier}`);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const existingSubscription = await ClientSubscription.findOne({ user_id: userId });
  if (existingSubscription && existingSubscription.status === 'active') {
    throw new Error('User already has an active client subscription');
  }

  const stripe = getStripeClient();
  
  const priceId = await getOrCreateStripePrice(stripe, plan);
  
  let customerId = existingSubscription?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: {
        user_id: String(userId),
        subscription_type: 'client',
      },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${process.env.FRONTEND_URL}/client-dashboard/subscription?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/client-dashboard/subscription?billing=cancelled`,
    metadata: {
      user_id: String(userId),
      subscription_type: 'client',
      tier,
    },
    subscription_data: {
      metadata: {
        user_id: String(userId),
        subscription_type: 'client',
        tier,
      },
    },
  });

  return {
    sessionId: session.id,
    sessionUrl: session.url,
  };
}

export async function getClientSubscriptionForUser(userId) {
  return ClientSubscription.findOne({ user_id: userId }).lean();
}

export async function getClientSubscriptionPresentationForUser(userId, { refreshFromStripe = false } = {}) {
  const subscription = await ClientSubscription.findOne({ user_id: userId });
  if (!subscription) return null;

  if (refreshFromStripe && subscription.stripe_subscription_id) {
    try {
      const stripe = getStripeClient();
      const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
      await syncClientStripeSubscription(stripeSubscription);
      return ClientSubscription.findOne({ user_id: userId }).lean();
    } catch (error) {
      console.warn('Client subscription refresh from Stripe failed:', error?.message || error);
      return subscription.toObject();
    }
  }

  return subscription.toObject();
}

function formatInvoiceAmount(amount, currency = 'usd') {
  const value = Number(amount || 0);
  const normalizedCurrency = String(currency || 'usd').trim().toUpperCase() || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: value % 100 === 0 ? 0 : 2,
    }).format(value / 100);
  } catch {
    return `${normalizedCurrency} ${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}`;
  }
}

function buildClientInvoiceDescription(invoice = {}, subscription = null) {
  const lineDescriptions = Array.isArray(invoice?.lines?.data)
    ? invoice.lines.data
        .map((line) => String(line?.description || '').trim())
        .filter(Boolean)
    : [];
  if (lineDescriptions.length > 0) return lineDescriptions.join(' + ');

  const directDescription = String(invoice?.description || '').trim();
  if (directDescription) return directDescription;

  const tier = String(subscription?.tier || '').trim().toLowerCase();
  const plan = tier ? getClientPlan(tier) : null;
  if (plan?.name && plan?.amount) {
    return `1 × ${plan.name.toLowerCase()} (${formatInvoiceAmount(plan.amount, plan.currency)} / month)`;
  }
  if (plan?.name) return `1 × ${plan.name.toLowerCase()} plan`;
  return 'Subscription payment';
}

export async function listClientPaidInvoicesForUser(userId, limit = 24) {
  const subscription = await ClientSubscription.findOne({ user_id: userId }).lean();
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
    description: buildClientInvoiceDescription(invoice, subscription),
    billingReason: invoice.billing_reason || '',
  }));
}

export async function changeClientSubscriptionPlan(userId, tier) {
  const plan = getClientPlan(tier);
  if (!plan) {
    return { ok: false, code: 400, message: 'Invalid client subscription tier.' };
  }

  const subscription = await ClientSubscription.findOne({ user_id: userId });
  if (!subscription || !ACTIVE_ACCESS_STATUSES.has(String(subscription.status || '').toLowerCase())) {
    return {
      ok: false,
      code: 409,
      message: 'No active client subscription to change. Subscribe to a plan first.',
    };
  }

  if (!subscription.stripe_subscription_id) {
    return { ok: false, code: 404, message: 'No Stripe subscription found for this client account.' };
  }

  const currentTier = String(subscription.tier || '').trim().toLowerCase();
  const targetTier = String(plan.tier || '').trim().toLowerCase();
  if (currentTier === targetTier) {
    return { ok: false, code: 400, message: 'You are already on this plan.' };
  }

  const currentTierRank = getClientTierRank(currentTier);
  const targetTierRank = getClientTierRank(targetTier);
  if (!currentTierRank || !targetTierRank) {
    return { ok: false, code: 400, message: 'Unable to compare client subscription plans.' };
  }

  const stripe = getStripeClient();
  const priceId = await getOrCreateStripePrice(stripe, plan);
  const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id, {
    expand: ['latest_invoice'],
  });
  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) {
    return { ok: false, code: 500, message: 'Unable to read subscription items from Stripe.' };
  }

  if (targetTierRank > currentTierRank) {
    await clearClientPendingScheduleIfAny(stripe, subscription, normalizeStripeId(stripeSubscription.schedule));

    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{ id: subscriptionItemId, price: priceId }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
      expand: ['latest_invoice'],
      metadata: {
        user_id: String(userId),
        subscription_type: 'client',
        tier: targetTier,
      },
    });

    const invoice = updated.latest_invoice && typeof updated.latest_invoice === 'object'
      ? updated.latest_invoice
      : null;

    const synced = await syncClientStripeSubscription(updated);
    await ClientSubscription.updateOne(
      { _id: synced._id },
      {
        $set: {
          pending_tier: '',
          pending_tier_effective_at: null,
          stripe_subscription_schedule_id: '',
        },
      },
    );

    return {
      ok: true,
      changeType: 'upgrade',
      subscription: await ClientSubscription.findById(synced._id).lean(),
      planName: plan.name,
      invoice: invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            hostedInvoiceUrl: invoice.hosted_invoice_url || '',
            invoicePdf: invoice.invoice_pdf || '',
            amountDue: invoice.amount_due,
            amountPaid: invoice.amount_paid,
            displayAmountDue: formatChangeInvoiceAmount(invoice.amount_due, invoice.currency),
          }
        : null,
    };
  }

  const latestInvoice = stripeSubscription.latest_invoice && typeof stripeSubscription.latest_invoice === 'object'
    ? stripeSubscription.latest_invoice
    : null;
  if (invoiceRequiresPayment(latestInvoice) && String(latestInvoice.billing_reason || '') === 'subscription_update') {
    await clearClientPendingScheduleIfAny(stripe, subscription, normalizeStripeId(stripeSubscription.schedule));
    await voidOrDeleteUnpaidInvoice(stripe, latestInvoice);

    const restored = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: false,
      items: [{ id: subscriptionItemId, price: priceId }],
      proration_behavior: 'none',
      payment_behavior: 'allow_incomplete',
      expand: ['latest_invoice'],
      metadata: {
        user_id: String(userId),
        subscription_type: 'client',
        tier: targetTier,
      },
    });

    const synced = await syncClientStripeSubscription(restored);
    await ClientSubscription.updateOne(
      { _id: synced._id },
      {
        $set: {
          pending_tier: '',
          pending_tier_effective_at: null,
          stripe_subscription_schedule_id: '',
        },
      },
    );

    return {
      ok: true,
      changeType: 'revert_unpaid_upgrade',
      subscription: await ClientSubscription.findById(synced._id).lean(),
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

  const schedule = await getOrCreateClientSubscriptionSchedule(
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
      user_id: String(userId),
      subscription_type: 'client',
      pending_tier: targetTier,
    },
    phases: [
      {
        items: currentItems,
        start_date: activePhase?.start_date || currentPeriodStartTs || 'now',
        end_date: currentPeriodEndTs,
        proration_behavior: 'none',
        metadata: {
          user_id: String(userId),
          subscription_type: 'client',
          tier: currentTier,
        },
      },
      {
        items: buildSinglePriceScheduleItem(priceId),
        proration_behavior: 'none',
        metadata: {
          user_id: String(userId),
          subscription_type: 'client',
          tier: targetTier,
        },
      },
    ],
  });

  const synced = await ClientSubscription.findOneAndUpdate(
    { _id: subscription._id },
    {
      $set: {
        pending_tier: targetTier,
        pending_tier_effective_at: currentPeriodEnd,
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

export async function syncClientStripeSubscription(stripeSubscription) {
  const userId = stripeSubscription.metadata?.user_id;
  if (!userId) {
    console.error('No user_id in stripe subscription metadata');
    return null;
  }

  const tier = stripeSubscription.metadata?.tier;
  if (!tier) {
    console.error('No tier in stripe subscription metadata');
    return null;
  }

  const priceId = stripeSubscription.items?.data?.[0]?.price?.id || '';
  const scheduleId = normalizeStripeId(stripeSubscription.schedule);
  const periodStart =
    stripeSubscription.current_period_start
    ?? stripeSubscription.current_period?.start
    ?? stripeSubscription.items?.data?.[0]?.current_period_start
    ?? null;
  const periodEnd =
    stripeSubscription.current_period_end
    ?? stripeSubscription.current_period?.end
    ?? stripeSubscription.items?.data?.[0]?.current_period_end
    ?? null;

  const updateData = {
    user_id: userId,
    tier,
    stripe_subscription_id: stripeSubscription.id,
    stripe_customer_id:
      typeof stripeSubscription.customer === 'string'
        ? stripeSubscription.customer
        : stripeSubscription.customer?.id || '',
    stripe_price_id: priceId,
    status: stripeSubscription.status,
    current_period_start: toSafeDate(periodStart),
    current_period_end: toSafeDate(periodEnd),
    cancel_at_period_end: stripeSubscription.cancel_at_period_end || false,
    ...(scheduleId
      ? { stripe_subscription_schedule_id: scheduleId }
      : {
          pending_tier: '',
          pending_tier_effective_at: null,
          stripe_subscription_schedule_id: '',
        }),
    last_synced_at: new Date(),
    last_stripe_event_id:
      typeof stripeSubscription.latest_invoice === 'string'
        ? stripeSubscription.latest_invoice
        : stripeSubscription.latest_invoice?.id || '',
  };

  const clientSubscription = await ClientSubscription.findOneAndUpdate(
    { user_id: userId },
    updateData,
    { upsert: true, new: true }
  );

  return clientSubscription;
}

export async function cancelClientSubscription(userId, cancellationReason = '') {
  const clientSubscription = await ClientSubscription.findOne({ user_id: userId });
  if (!clientSubscription) {
    throw new Error('No client subscription found');
  }

  if (!clientSubscription.stripe_subscription_id) {
    throw new Error('No Stripe subscription ID found');
  }

  const safeReason = String(cancellationReason || '').trim();
  if (!safeReason) {
    throw new Error('Cancellation reason is required');
  }

  const stripe = getStripeClient();
  await stripe.subscriptions.update(clientSubscription.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  clientSubscription.cancel_at_period_end = true;
  clientSubscription.metadata = {
    ...(clientSubscription.metadata || {}),
    cancellation_reason: safeReason,
    cancellation_reason_recorded_at: new Date().toISOString(),
  };
  await clientSubscription.save();

  return clientSubscription;
}

export async function resumeClientSubscription(userId) {
  const clientSubscription = await ClientSubscription.findOne({ user_id: userId });
  if (!clientSubscription) {
    throw new Error('No client subscription found');
  }

  if (!clientSubscription.stripe_subscription_id) {
    throw new Error('No Stripe subscription ID found');
  }

  if (!clientSubscription.cancel_at_period_end) {
    throw new Error('Subscription is not scheduled to cancel');
  }

  const stripe = getStripeClient();
  const updated = await stripe.subscriptions.update(clientSubscription.stripe_subscription_id, {
    cancel_at_period_end: false,
  });

  clientSubscription.metadata = {
    ...(clientSubscription.metadata || {}),
    cancellation_reason: '',
    cancellation_reason_recorded_at: null,
  };
  await clientSubscription.save();

  return syncClientStripeSubscription(updated);
}
