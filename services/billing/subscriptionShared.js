import { getPlanByPriceId, getPlanTier } from './plans.js';

export const ACTIVE_ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);
export const STRIPE_BLOCKING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

export function isStripeResourceMissing(error) {
  return error?.code === 'resource_missing' || error?.raw?.code === 'resource_missing';
}

export function toDateFromUnix(value) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getStripeSubscriptionPeriodEnd(stripeSubscription = {}) {
  const items = stripeSubscription?.items?.data || [];
  let latestEnd = null;
  for (const item of items) {
    const end = toDateFromUnix(item?.current_period_end);
    if (end && (!latestEnd || end > latestEnd)) latestEnd = end;
  }
  return latestEnd
    || toDateFromUnix(stripeSubscription.current_period_end)
    || toDateFromUnix(stripeSubscription.cancel_at)
    || toDateFromUnix(stripeSubscription.ended_at)
    || null;
}

export function getStripeSubscriptionPeriodStart(stripeSubscription = {}) {
  const items = stripeSubscription?.items?.data || [];
  let earliestStart = null;
  for (const item of items) {
    const start = toDateFromUnix(item?.current_period_start);
    if (start && (!earliestStart || start < earliestStart)) earliestStart = start;
  }
  return earliestStart || toDateFromUnix(stripeSubscription.current_period_start) || null;
}

export function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeStripeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.id || '');
}

export function firstSubscriptionPriceId(stripeSubscription = {}) {
  return String(stripeSubscription?.items?.data?.[0]?.price?.id || '').trim();
}

export function invoiceLinePriceId(line = {}) {
  return (
    normalizeStripeId(line.price)
    || normalizeStripeId(line.plan)
    || String(line.pricing?.price_details?.price || '').trim()
  );
}

export function stripeTimestampFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

export function buildScheduleItemsFromSubscription(stripeSubscription = {}) {
  return (stripeSubscription.items?.data || [])
    .map((item) => ({
      price: normalizeStripeId(item.price),
      quantity: item.quantity || 1,
    }))
    .filter((item) => item.price);
}

export function buildSinglePriceScheduleItem(priceId) {
  return [{ price: priceId, quantity: 1 }];
}

export function invoiceRequiresPayment(invoice) {
  if (!invoice || typeof invoice !== 'object') return false;
  const status = String(invoice.status || '').toLowerCase();
  const amountRemaining = Number(invoice.amount_remaining ?? invoice.amount_due ?? 0);
  return ['draft', 'open', 'uncollectible'].includes(status) && amountRemaining > 0;
}

export function isSubscriptionPeriodEnded(subscription) {
  if (!subscription?.current_period_end) return false;
  const periodEnd = new Date(subscription.current_period_end);
  return !Number.isNaN(periodEnd.getTime()) && periodEnd.getTime() <= Date.now();
}

export function subscriptionNeedsStripeRefresh(subscription) {
  if (!subscription?.stripe_customer_id && !subscription?.stripe_subscription_id) return false;
  if (isSubscriptionPeriodEnded(subscription)) return true;
  if (!subscription.pending_plan_effective_at) return false;
  const pendingEffectiveAt = new Date(subscription.pending_plan_effective_at);
  return !Number.isNaN(pendingEffectiveAt.getTime()) && pendingEffectiveAt.getTime() <= Date.now();
}

export function accountStatusFromSubscription(subscription) {
  if (!subscription) return 'expired';
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'free_trial') {
    if (subscription.trial_end && new Date(subscription.trial_end) <= new Date()) return 'expired';
    return 'free_trial';
  }
  if (['canceled', 'cancelled', 'incomplete_expired', 'expired'].includes(status)) {
    return 'expired';
  }
  if (Boolean(subscription.cancel_at_period_end) && isSubscriptionPeriodEnded(subscription)) {
    return 'expired';
  }
  if (ACTIVE_ACCESS_STATUSES.has(status)) return 'subscribed';
  return 'expired';
}

export function userHasActiveSubscriptionAccess(subscription) {
  return accountStatusFromSubscription(subscription) === 'subscribed';
}

export function formatInvoiceAmount(amount, currency = 'usd') {
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

export function describeInvoice(invoice = {}) {
  const lines = invoice.lines?.data || [];
  const firstDescription = lines[0]?.description || 'Subscription';
  if (String(invoice.billing_reason || '') !== 'subscription_update') return firstDescription;

  const planLines = lines
    .map((line) => ({
      amount: Number(line.amount || 0),
      plan: getPlanByPriceId(invoiceLinePriceId(line)),
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
  if (toPlan) return `Prorated subscription charge: ${toPlan.name}`;
  if (/unused time|remaining time/i.test(firstDescription)) {
    return 'Prorated subscription adjustment';
  }
  return firstDescription;
}

export function buildProrationNote(invoice = {}) {
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
