import {
  canonicalClientTier,
  getClientPlan,
  publicClientPlan,
} from './plans.js';
import { chargeForPlan, normalizeBillingPeriod } from '../billing/planPrices.js';
import { checkoutAlreadyOpenMessage, incomingStripeSnapshotIsStale } from '../billing/subscriptionShared.js';

const ACTIVE_ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);
export const CLIENT_PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const CLIENT_PERIOD_END_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const CLIENT_STRIPE_REFRESH_STALE_MS = 15 * 60 * 1000;
const CLIENT_TIER_ORDER = {
  basic: 1,
  essential: 1,
  standard: 2,
  plus: 2,
  pro: 3,
  premium: 3,
};

export const BLOCKING_CLIENT_CHECKOUT_STATUSES = new Set([
  'incomplete',
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
]);

export const CLEANABLE_CLIENT_STRIPE_STATUSES = new Set(['incomplete']);

export const TERMINAL_CLIENT_STRIPE_STATUSES = new Set([
  'canceled',
  'cancelled',
  'incomplete_expired',
]);

export const LIVE_CLIENT_STRIPE_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
]);

export function toSafeDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
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

export function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toDateFromUnix(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function stripeTimestampFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

export function unixSecondsFromDate(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.floor(date.getTime() / 1000);
}

export function normalizeStripeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.id || '');
}

export function clientHttpError(message, statusCode = 400, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export function isStripeSubscriptionMissing(error) {
  const message = String(error?.raw?.message || error?.message || '').toLowerCase();
  return (
    error?.code === 'resource_missing' ||
    error?.raw?.code === 'resource_missing' ||
    message.includes('no such subscription') ||
    message.includes('canceled') ||
    message.includes('cancelled')
  );
}

export function isClientStripeSubscription(sub) {
  return String(sub?.metadata?.subscription_type || '').trim().toLowerCase() === 'client';
}

export function getClientTierRank(tier) {
  const canonical = canonicalClientTier(tier) || String(tier || '').trim().toLowerCase();
  return CLIENT_TIER_ORDER[canonical] || 0;
}

export function appendPlanChange(metadata, entry) {
  const current = Array.isArray(metadata?.plan_changes) ? metadata.plan_changes.slice(-49) : [];
  current.push(entry);
  return { ...(metadata || {}), plan_changes: current };
}

export function isClientPeriodEnded(subscription, graceMs = 0) {
  if (!subscription?.current_period_end) return false;
  const periodEnd = new Date(subscription.current_period_end);
  return !Number.isNaN(periodEnd.getTime()) && periodEnd.getTime() + graceMs <= Date.now();
}

export function getClientPastDueGraceEndsAt() {
  return null;
}

export function isClientPastDueWithinGrace() {
  return false;
}

export function isClientSubscriptionActive(subscription) {
  if (!subscription) return false;
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'past_due' || status === 'unpaid') return false;
  if (!ACTIVE_ACCESS_STATUSES.has(status)) return false;
  if (isClientPeriodEnded(subscription)) return false;
  return true;
}

export function getClientAccessState(subscription) {
  if (!subscription) return 'none';
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'past_due' || status === 'unpaid') return 'past_due_locked';
  if (isClientSubscriptionActive(subscription)) return 'active';
  return 'expired';
}

export function getClientPaymentMessage(subscription) {
  const state = getClientAccessState(subscription);
  if (state === 'past_due_locked') {
    return 'Your payment is past due. Update your payment method to restore access.';
  }
  if (state === 'expired') {
    return 'Your subscription has ended. Subscribe again to restore access.';
  }
  return '';
}

export function shouldRefreshClientSubscriptionFromStripe(subscription) {
  if (!subscription?.stripe_subscription_id) return false;
  const lastSynced = toSafeDate(subscription.last_synced_at);
  if (lastSynced && Date.now() - lastSynced.getTime() < CLIENT_STRIPE_REFRESH_STALE_MS) {
    return false;
  }
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'past_due' || status === 'unpaid') return true;
  return isClientPeriodEnded(subscription);
}

export function hasOpenClientCheckoutConflict(subscription) {
  const status = String(subscription?.status || '').trim().toLowerCase();
  return isClientSubscriptionActive(subscription) || BLOCKING_CLIENT_CHECKOUT_STATUSES.has(status);
}

export function isClientSubscriptionAlreadyEnded(subscription) {
  return (
    !subscription?.stripe_subscription_id ||
    !isClientSubscriptionActive(subscription) ||
    isClientPeriodEnded(subscription) ||
    TERMINAL_CLIENT_STRIPE_STATUSES.has(String(subscription.status || '').trim().toLowerCase())
  );
}

export function presentClientSubscription(subscription) {
  if (!subscription) return null;
  const raw = subscription.toObject ? subscription.toObject() : { ...subscription };
  const tier = canonicalClientTier(raw.tier) || String(raw.tier || '').trim().toLowerCase();
  const pendingTier = canonicalClientTier(raw.pending_tier) || '';
  const plan = publicClientPlan(tier);
  const status = String(raw.status || '').trim().toLowerCase();
  const view = { ...raw, tier, status };
  const active = isClientSubscriptionActive(view);
  const graceEndsAt = getClientPastDueGraceEndsAt(view);
  const lastPurchase = raw.last_purchase && typeof raw.last_purchase === 'object'
    ? {
        plan_key: canonicalClientTier(raw.last_purchase.plan_key) || String(raw.last_purchase.plan_key || '').trim().toLowerCase(),
        billing_period: String(raw.last_purchase.billing_period || '').trim().toLowerCase(),
        amount: Number(raw.last_purchase.amount || 0),
        currency: String(raw.last_purchase.currency || 'usd').trim().toLowerCase() || 'usd',
        confirmed_at: toIsoDate(raw.last_purchase.confirmed_at),
      }
    : null;
  return {
    tier,
    pending_tier: pendingTier,
    pending_tier_effective_at: toIsoDate(raw.pending_tier_effective_at),
    billing_period: String(raw.billing_period || '').trim().toLowerCase(),
    status,
    is_active: active,
    access_state: getClientAccessState(view),
    cancel_at_period_end: Boolean(raw.cancel_at_period_end),
    current_period_start: toIsoDate(raw.current_period_start),
    current_period_end: toIsoDate(raw.current_period_end),
    plan,
    entitlements: active && plan ? plan.feature_keys : [],
    last_purchase: lastPurchase,
    grace_ends_at: toIsoDate(graceEndsAt),
    payment_message: getClientPaymentMessage(view),
    payment_action_url: '',
    payment_action_label: '',
  };
}

export function formatInvoiceAmount(amount, currency = 'usd') {
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

export function buildClientInvoiceDescription(invoice = {}, subscription = null) {
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

export function presentChangeInvoice(invoice) {
  if (!invoice) return null;
  return {
    id: invoice.id,
    status: invoice.status,
    hostedInvoiceUrl: invoice.hosted_invoice_url || '',
    invoicePdf: invoice.invoice_pdf || '',
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    displayAmountDue: formatInvoiceAmount(invoice.amount_due, invoice.currency),
  };
}

export function presentPaidClientInvoice(invoice, subscription) {
  return {
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
  };
}

export function getStripeSubscriptionPeriodStart(stripeSubscription = {}) {
  const items = stripeSubscription?.items?.data || [];
  let earliestStart = null;

  for (const item of items) {
    const start = toDateFromUnix(item?.current_period_start);
    if (start && (!earliestStart || start < earliestStart)) earliestStart = start;
  }

  if (earliestStart) return earliestStart;
  return toDateFromUnix(stripeSubscription.current_period_start) || null;
}

export function getStripeSubscriptionPeriodEnd(stripeSubscription = {}) {
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

export function shouldApplyIncomingClientStripeSubscription(existing, incoming = {}, extra = {}) {
  const incomingId = String(incoming?.id || '').trim();
  if (!incomingId) return false;
  if (!existing?.stripe_subscription_id) return true;
  if (String(existing.stripe_subscription_id) === incomingId) {
    return !incomingStripeSnapshotIsStale(existing, incoming, extra);
  }

  const existingStatus = String(existing.status || '').trim().toLowerCase();
  const incomingStatus = String(incoming.status || '').trim().toLowerCase();
  const existingLive =
    LIVE_CLIENT_STRIPE_STATUSES.has(existingStatus) &&
    !isClientPeriodEnded(existing);
  const incomingTerminal = TERMINAL_CLIENT_STRIPE_STATUSES.has(incomingStatus);
  const incomingLive = LIVE_CLIENT_STRIPE_STATUSES.has(incomingStatus);

  if (incomingTerminal) return false;
  if (!existingLive) return Boolean(incomingLive);

  const incomingCreated = Number(incoming.created || 0);
  const existingCreated =
    Number(existing.metadata?.stripe_subscription_created || 0) ||
    unixSecondsFromDate(existing.current_period_start);
  return incomingLive && incomingCreated > 0 && incomingCreated > existingCreated;
}

export function getClientFrontendOrigin() {
  const raw = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) {
    throw clientHttpError(
      'Billing is temporarily unavailable. Please try again later.',
      500,
      'FRONTEND_URL_MISSING',
    );
  }
  return raw;
}

export function buildClientCheckoutMetadata(userId, plan, charge) {
  return {
    user_id: String(userId),
    subscription_type: 'client',
    tier: plan.tier,
    plan_key: plan.tier,
    billing_period: charge.billingPeriod,
    amount: String(charge.amount),
  };
}

export function resolveClientSyncTier(stripeSubscription, existingByStripeId, existingByUser) {
  return (
    canonicalClientTier(stripeSubscription.metadata?.tier)
    || canonicalClientTier(existingByStripeId?.tier) || canonicalClientTier(existingByUser?.tier)
    || stripeSubscription.metadata?.tier
    || existingByStripeId?.tier
    || ''
  );
}

export function resolveClientSyncBillingPeriod(stripeSubscription, existingByStripeId, existingByUser) {
  return normalizeBillingPeriod(
    stripeSubscription.metadata?.billing_period || existingByStripeId?.billing_period || existingByUser?.billing_period,
  );
}

export function stripeCustomerIdFromSubscription(stripeSubscription, existingByStripeId, existingByUser) {
  return typeof stripeSubscription.customer === 'string'
    ? stripeSubscription.customer
    : stripeSubscription.customer?.id || existingByStripeId?.stripe_customer_id || existingByUser?.stripe_customer_id || '';
}

export function stripeInvoiceIdFromSubscription(stripeSubscription, fallback = '') {
  return typeof stripeSubscription.latest_invoice === 'string'
    ? stripeSubscription.latest_invoice
    : stripeSubscription.latest_invoice?.id || fallback || '';
}

export function buildClientLastPurchase({ stripeSubscription, existingPurchase = {}, tier, billingPeriod }) {
  const plan = getClientPlan(tier);
  const charge = plan ? chargeForPlan(plan, billingPeriod) : null;
  const invoiceId = stripeInvoiceIdFromSubscription(stripeSubscription, existingPurchase.stripe_invoice_id || '');
  const invoiceChanged = Boolean(invoiceId && invoiceId !== String(existingPurchase.stripe_invoice_id || ''));
  return {
    plan_key: tier,
    billing_period: billingPeriod,
    amount: Number(stripeSubscription.metadata?.amount || charge?.amount || existingPurchase.amount || 0),
    currency: String(charge?.currency || existingPurchase.currency || 'usd').trim().toLowerCase() || 'usd',
    stripe_invoice_id: invoiceId,
    confirmed_at:
      invoiceChanged || !existingPurchase.confirmed_at
        ? new Date()
        : existingPurchase.confirmed_at,
  };
}

export function buildClientStripeSyncUpdate({ stripeSubscription, existingByStripeId, existingByUser, userId, eventCreated = 0 }) {
  const existing = existingByUser || existingByStripeId;
  const tier = resolveClientSyncTier(stripeSubscription, existingByStripeId, existingByUser);
  const billingPeriod = resolveClientSyncBillingPeriod(stripeSubscription, existingByStripeId, existingByUser);
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
  const stripeStatus = String(stripeSubscription.status || '').trim().toLowerCase();
  const scheduleId = normalizeStripeId(stripeSubscription.schedule);
  const updateData = {
    user_id: userId,
    tier,
    billing_period: billingPeriod,
    stripe_subscription_id: stripeSubscription.id,
    stripe_customer_id: stripeCustomerIdFromSubscription(stripeSubscription, existingByStripeId, existingByUser),
    stripe_price_id:
      stripeSubscription.items?.data?.[0]?.price?.id ||
      existingByStripeId?.stripe_price_id ||
      '',
    status: stripeStatus || 'canceled',
    current_period_start: toSafeDate(periodStart) || existingByStripeId?.current_period_start || existingByUser?.current_period_start || null,
    current_period_end: toSafeDate(periodEnd) || existingByStripeId?.current_period_end || existingByUser?.current_period_end || null,
    cancel_at_period_end:
      stripeStatus === 'canceled' || stripeStatus === 'cancelled'
        ? false
        : Boolean(stripeSubscription.cancel_at_period_end),
    ...(scheduleId
      ? { stripe_subscription_schedule_id: scheduleId }
      : {
          pending_tier: '',
          pending_tier_effective_at: null,
          stripe_subscription_schedule_id: '',
        }),
    last_synced_at: new Date(),
    last_stripe_event_id: stripeInvoiceIdFromSubscription(stripeSubscription),
    metadata: {
      ...(existing?.metadata || {}),
      stripe_subscription_created:
        Number(stripeSubscription.created || 0) ||
        Number(existing?.metadata?.stripe_subscription_created || 0) ||
        unixSecondsFromDate(toSafeDate(periodStart)),
      stripe_last_event_created:
        Number(eventCreated || 0) ||
        Number(existing?.metadata?.stripe_last_event_created || 0) ||
        undefined,
      past_due_since:
        stripeStatus === 'past_due'
          ? (
              existing?.metadata?.past_due_since
              || new Date().toISOString()
            )
          : null,
    },
  };

  if (stripeStatus === 'active' || stripeStatus === 'trialing') {
    updateData.last_purchase = buildClientLastPurchase({
      stripeSubscription,
      existingPurchase: existing?.last_purchase || {},
      tier,
      billingPeriod,
    });
  }

  return { updateData, tier, billingPeriod, stripeStatus };
}

export function openClientSubscriptionConflictError(status = '') {
  return clientHttpError(
    checkoutAlreadyOpenMessage(status),
    409,
    'CLIENT_SUBSCRIPTION_OPEN',
  );
}

export function clientSubscriptionEndedError() {
  return clientHttpError(
    'Your subscription has already ended. You can subscribe again from billing.',
    409,
    'CLIENT_SUBSCRIPTION_ENDED',
  );
}
