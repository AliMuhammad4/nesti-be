import { getPlan, getPlanByPriceId, getPlanTier } from './plans.js';

export const ACTIVE_ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);
export const STRIPE_BLOCKING_STATUSES = new Set([
  'incomplete',
  'unpaid',
  'past_due',
  'trialing',
  'active',
  'paused',
]);

export function checkoutAlreadyOpenMessage(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'incomplete') {
    return 'You already have a pending payment. Finish or wait for that payment before starting a new checkout.';
  }
  if (normalized === 'past_due' || normalized === 'unpaid') {
    return 'You already have a payment due. Finish payment from billing before starting a new checkout.';
  }
  return 'You already have an open subscription. You can change plans from billing, or try again after it ends.';
}

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

/**
 * Stripe API 2025-03-31.basil+ moved invoice.subscription →
 * invoice.parent.subscription_details.subscription.
 */
export function getInvoiceSubscriptionId(invoice = {}) {
  const fromParent = normalizeStripeId(invoice?.parent?.subscription_details?.subscription);
  if (fromParent) return fromParent;

  const fromLegacy = normalizeStripeId(invoice?.subscription);
  if (fromLegacy) return fromLegacy;

  for (const line of invoice?.lines?.data || []) {
    const fromLine = normalizeStripeId(
      line?.parent?.subscription_item_details?.subscription
      || line?.subscription,
    );
    if (fromLine) return fromLine;
  }
  return '';
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

const INVOICE_PLAN_NAME_KEYS = ['enterprise', 'standard', 'basic'];

function planFromInvoiceLine(line = {}) {
  const byPrice = getPlanByPriceId(invoiceLinePriceId(line));
  if (byPrice) return byPrice;
  const description = String(line?.description || '').toLowerCase();
  const matchedKey = INVOICE_PLAN_NAME_KEYS.find((key) => description.includes(key));
  return matchedKey ? getPlan(matchedKey) : null;
}

function renewalPriceSentence(plan) {
  if (plan?.display_amount) return `Your next renewal is ${plan.display_amount}/month.`;
  if (plan?.name) return `Your next renewal is the full ${plan.name} monthly price.`;
  return 'Your next renewal is the full monthly price of your new plan.';
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

export function isSubscriptionPeriodEnded(subscription, graceMs = 0) {
  if (!subscription?.current_period_end) return false;
  const periodEnd = new Date(subscription.current_period_end);
  return !Number.isNaN(periodEnd.getTime()) && periodEnd.getTime() + graceMs <= Date.now();
}

const PROFESSIONAL_STRIPE_REFRESH_STALE_MS = 15 * 60 * 1000;

export const TERMINAL_PROFESSIONAL_STRIPE_STATUSES = new Set([
  'canceled',
  'cancelled',
  'incomplete_expired',
]);

export const LIVE_PROFESSIONAL_STRIPE_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
]);

export function toSafeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
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

export function unixSecondsFromDate(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.floor(date.getTime() / 1000);
}

export function getProfessionalPastDueGraceEndsAt() {
  return null;
}

export function isProfessionalSubscriptionActive(subscription) {
  if (!subscription) return false;
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'past_due' || status === 'unpaid') return false;
  if (!ACTIVE_ACCESS_STATUSES.has(status)) return false;
  if (isSubscriptionPeriodEnded(subscription)) return false;
  return true;
}

export function getProfessionalAccessState(subscription) {
  if (!subscription) return 'none';
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'past_due' || status === 'unpaid') return 'past_due_locked';
  if (isProfessionalSubscriptionActive(subscription)) return 'active';
  return 'expired';
}

export function getProfessionalPaymentMessage(subscription) {
  const state = getProfessionalAccessState(subscription);
  if (state === 'past_due_locked') {
    return 'Your payment is past due. Update your payment method to restore access.';
  }
  if (state === 'expired') {
    return 'Your subscription has ended. Subscribe again to restore access.';
  }
  return '';
}

export function lastProfessionalStripeRefreshAt(subscription) {
  return toSafeDate(subscription?.metadata?.stripe_refresh_attempted_at)
    || toSafeDate(subscription?.last_synced_at);
}

export function subscriptionNeedsStripeRefresh(subscription) {
  if (!subscription?.stripe_customer_id && !subscription?.stripe_subscription_id) return false;
  const lastSynced = lastProfessionalStripeRefreshAt(subscription);
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'past_due' || status === 'unpaid') {
    return !lastSynced || Date.now() - lastSynced.getTime() >= PROFESSIONAL_STRIPE_REFRESH_STALE_MS;
  }
  if (isSubscriptionPeriodEnded(subscription)) {
    const periodEnd = toSafeDate(subscription.current_period_end);
    if (!lastSynced || !periodEnd || lastSynced.getTime() <= periodEnd.getTime()) return true;
    return Date.now() - lastSynced.getTime() >= PROFESSIONAL_STRIPE_REFRESH_STALE_MS;
  }
  // Near period end, pull Stripe so next-cycle fields stay accurate after renewals.
  if (subscription?.current_period_end) {
    const periodEnd = new Date(subscription.current_period_end);
    if (!Number.isNaN(periodEnd.getTime())) {
      const msUntilEnd = periodEnd.getTime() - Date.now();
      if (msUntilEnd >= 0 && msUntilEnd <= 2 * 60 * 60 * 1000) {
        return !lastSynced || Date.now() - lastSynced.getTime() >= PROFESSIONAL_STRIPE_REFRESH_STALE_MS;
      }
    }
  }
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
  if (isProfessionalSubscriptionActive(subscription)) return 'subscribed';
  return 'expired';
}

export function userHasActiveSubscriptionAccess(subscription) {
  return accountStatusFromSubscription(subscription) === 'subscribed';
}

export function isProfessionalPlatformStripeSubscription(sub) {
  const type = String(sub?.metadata?.subscription_type || '').trim().toLowerCase();
  return type === 'professional';
}

export function incomingStripeSnapshotIsStale(existing, incoming = {}, extra = {}) {
  const incomingEventCreated = Number(
    extra?.eventCreated
    || extra?.event_created
    || incoming?.last_stripe_event_created
    || 0,
  );
  const existingEventCreated = Number(existing?.metadata?.stripe_last_event_created || 0);
  if (incomingEventCreated > 0 && existingEventCreated > 0 && incomingEventCreated < existingEventCreated) {
    return true;
  }
  const incomingStatus = String(incoming?.status || '').trim().toLowerCase();
  if (TERMINAL_PROFESSIONAL_STRIPE_STATUSES.has(incomingStatus)) return false;
  const incomingPeriodEnd =
    getStripeSubscriptionPeriodEnd(incoming)
    || toSafeDate(incoming?.current_period_end);
  const existingPeriodEnd = toSafeDate(existing?.current_period_end);
  return Boolean(
    incomingPeriodEnd
    && existingPeriodEnd
    && incomingPeriodEnd.getTime() < existingPeriodEnd.getTime(),
  );
}

export function shouldApplyIncomingProfessionalStripeSubscription(existing, incoming = {}, extra = {}) {
  const incomingId = String(incoming?.id || '').trim();
  if (!incomingId) return false;
  if (!existing?.stripe_subscription_id) return true;
  if (String(existing.stripe_subscription_id) === incomingId) {
    return !incomingStripeSnapshotIsStale(existing, incoming, extra);
  }

  const existingStatus = String(existing.status || '').trim().toLowerCase();
  const incomingStatus = String(incoming.status || '').trim().toLowerCase();
  const existingLive =
    LIVE_PROFESSIONAL_STRIPE_STATUSES.has(existingStatus)
    && !isSubscriptionPeriodEnded(existing);
  const incomingTerminal = TERMINAL_PROFESSIONAL_STRIPE_STATUSES.has(incomingStatus);
  const incomingLive = LIVE_PROFESSIONAL_STRIPE_STATUSES.has(incomingStatus);

  if (incomingTerminal) return false;
  if (!existingLive) return Boolean(incomingLive);

  const incomingCreated = Number(incoming.created || 0);
  const existingCreated =
    Number(existing.metadata?.stripe_subscription_created || 0)
    || unixSecondsFromDate(existing.current_period_start);
  return incomingLive && incomingCreated > 0 && incomingCreated > existingCreated;
}

export function getBillingFrontendOrigin() {
  const raw = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw;
}

export function professionalHasUsedTrial(subscription) {
  if (!subscription) return false;
  if (subscription.trial_used === true) return true;
  if (subscription.metadata?.trial_used === true) return true;
  return Boolean(subscription.trial_start);
}

export function hasPaidProfessionalAccess(subscription) {
  const status = String(subscription?.status || '').trim().toLowerCase();
  if (!['active', 'past_due'].includes(status)) return false;
  return isProfessionalSubscriptionActive(subscription);
}

export function canReuseLocalProfessionalStripeSnapshot(subscription, stripeSubscription) {
  const localSubscriptionId = String(subscription?.stripe_subscription_id || '').trim();
  const stripeSubscriptionId = String(stripeSubscription?.id || '').trim();
  const localStatus = String(subscription?.status || '').trim().toLowerCase();
  const stripeStatus = String(stripeSubscription?.status || '').trim().toLowerCase();
  if (!localSubscriptionId || localSubscriptionId !== stripeSubscriptionId) return false;
  // A past_due local row must still sync when Stripe has already collected payment.
  if (!ACTIVE_ACCESS_STATUSES.has(localStatus) || localStatus !== stripeStatus) return false;
  if (!subscription?.current_period_end) return false;
  const localPriceId = String(subscription?.stripe_price_id || '').trim();
  const stripePriceId = firstSubscriptionPriceId(stripeSubscription);
  if (localPriceId !== stripePriceId) return false;
  const stripePeriodEnd = getStripeSubscriptionPeriodEnd(stripeSubscription);
  const localPeriodEndMs = new Date(subscription.current_period_end).getTime();
  const stripePeriodEndMs = stripePeriodEnd ? stripePeriodEnd.getTime() : null;
  if (Number.isNaN(localPeriodEndMs) || stripePeriodEndMs == null || localPeriodEndMs !== stripePeriodEndMs) {
    return false;
  }
  return Boolean(subscription?.cancel_at_period_end) === Boolean(stripeSubscription?.cancel_at_period_end);
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
      plan: planFromInvoiceLine(line),
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

export function buildProrationBreakdown(invoice = {}) {
  if (String(invoice.billing_reason || '') !== 'subscription_update') return null;
  const lines = invoice.lines?.data || [];
  let creditTotal = 0;
  let chargeTotal = 0;
  let fromPlan = null;
  let toPlan = null;
  for (const line of lines) {
    const amount = Number(line.amount || 0);
    const plan = planFromInvoiceLine(line);
    if (amount < 0) {
      creditTotal += Math.abs(amount);
      if (!fromPlan && plan) fromPlan = plan;
    }
    if (amount > 0) {
      chargeTotal += amount;
      if (!toPlan && plan) toPlan = plan;
    }
  }
  if (!creditTotal && !chargeTotal) return null;

  const direction = fromPlan && toPlan && fromPlan.plan_key !== toPlan.plan_key
    ? (getPlanTier(toPlan.plan_key) > getPlanTier(fromPlan.plan_key) ? 'Upgrade' : 'Plan change')
    : 'Prorated';
  const renewal = toPlan?.display_amount
    ? `${toPlan.display_amount}/month`
    : '';

  const net = Math.max(0, chargeTotal - creditTotal);
  return {
    direction,
    fromPlan: fromPlan?.name || '',
    toPlan: toPlan?.name || '',
    chargeLabel: toPlan?.name ? `Remaining days on ${toPlan.name}` : 'Remaining days',
    chargeAmount: chargeTotal > 0 ? formatInvoiceAmount(chargeTotal, invoice.currency) : '',
    creditLabel: fromPlan?.name ? `Unused ${fromPlan.name} time` : 'Unused time credit',
    creditAmount: creditTotal > 0 ? formatInvoiceAmount(creditTotal, invoice.currency) : '',
    netAmount: formatInvoiceAmount(net, invoice.currency),
    renewal,
  };
}

export function buildProrationNote(invoice = {}) {
  const breakdown = buildProrationBreakdown(invoice);
  if (!breakdown) return '';
  const parts = [];
  if (breakdown.chargeAmount) {
    parts.push(`${breakdown.chargeAmount} for ${breakdown.chargeLabel.charAt(0).toLowerCase()}${breakdown.chargeLabel.slice(1)}`);
  }
  if (breakdown.creditAmount) {
    parts.push(`${breakdown.creditAmount} credit for ${breakdown.creditLabel.charAt(0).toLowerCase()}${breakdown.creditLabel.slice(1)}`);
  }
  const renewal = breakdown.renewal
    ? `Your next renewal is ${breakdown.renewal}.`
    : renewalPriceSentence(null);
  return `Prorated today only: ${parts.join(' minus ')} = ${breakdown.netAmount}. ${renewal}`;
}

export const CHECKOUT_IDEMPOTENCY_WINDOW_MS = 15 * 60 * 1000;

export function buildCheckoutIdempotencyKey({
  kind,
  userId,
  planKey,
  billingPeriod,
  now = Date.now(),
  leftoverSubscriptionIds = [],
} = {}) {
  const bucket = Math.floor(Number(now) / CHECKOUT_IDEMPOTENCY_WINDOW_MS);
  const parts = [
    String(kind || 'checkout'),
    'v1',
    String(userId || ''),
    String(planKey || ''),
    String(billingPeriod || 'month'),
    String(bucket),
  ];
  const leftoverIds = (Array.isArray(leftoverSubscriptionIds) ? leftoverSubscriptionIds : [leftoverSubscriptionIds])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (leftoverIds.length) {
    parts.push([...new Set(leftoverIds)].sort().join(','));
  }
  return parts.join(':').slice(0, 255);
}

export function isReusableOpenCheckoutSession(session, {
  userId,
  subscriptionType,
  planKey,
  billingPeriod,
} = {}) {
  if (!session || String(session.status || '').trim().toLowerCase() !== 'open' || !session.url) {
    return false;
  }
  const meta = session.metadata || {};
  const sessionPlan = String(meta.plan_key || meta.tier || '').trim().toLowerCase();
  return String(meta.subscription_type || '').trim().toLowerCase() === String(subscriptionType || '').trim().toLowerCase()
    && String(meta.user_id || '') === String(userId || '')
    && sessionPlan === String(planKey || '').trim().toLowerCase()
    && String(meta.billing_period || '').trim().toLowerCase() === String(billingPeriod || '').trim().toLowerCase();
}

export function partitionOpenCheckoutSessions(sessions, options = {}) {
  const leftover = [];
  let reusable = null;
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const type = String(session?.metadata?.subscription_type || '').trim().toLowerCase();
    if (type !== String(options.subscriptionType || '').trim().toLowerCase()) continue;
    if (options.userId && String(session?.metadata?.user_id || '') !== String(options.userId)) continue;
    if (!reusable && isReusableOpenCheckoutSession(session, options)) {
      reusable = session;
      continue;
    }
    leftover.push(session);
  }
  return { reusable, leftover };
}

export async function expireLeftoverOpenCheckoutSessions(stripe, customerId, options = {}) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!stripe || !normalizedCustomerId) return null;
  let sessions = [];
  try {
    const result = await stripe.checkout.sessions.list({
      customer: normalizedCustomerId,
      status: 'open',
      limit: 20,
    });
    sessions = result?.data || [];
  } catch (error) {
    const missing = isStripeResourceMissing(error);
    if (!missing) {
      console.warn('Listing open checkout sessions failed:', error?.message || error);
    }
    return null;
  }
  const { reusable, leftover } = partitionOpenCheckoutSessions(sessions, options);
  for (const session of leftover) {
    const sessionId = String(session?.id || '').trim();
    if (!sessionId) continue;
    try {
      await stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      if (!isStripeResourceMissing(error)) {
        console.warn('Expiring leftover checkout session failed:', sessionId, error?.message || error);
      }
    }
  }
  return reusable;
}

export async function deduplicateNewCheckoutSession(stripe, customerId, createdSession, options = {}) {
  if (!stripe || !createdSession?.id) return createdSession;
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId) return createdSession;
  let sessions;
  try {
    const result = await stripe.checkout.sessions.list({
      customer: normalizedCustomerId,
      status: 'open',
      limit: 20,
    });
    sessions = result?.data || [];
  } catch {
    return createdSession;
  }
  const matching = sessions.filter((session) => isReusableOpenCheckoutSession(session, options));
  if (matching.length <= 1) return createdSession;
  matching.sort((sessionA, sessionB) => Number(sessionA.created || 0) - Number(sessionB.created || 0));
  const keep = matching[0];
  for (const session of matching.slice(1)) {
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      if (!isStripeResourceMissing(error)) {
        console.warn('Expiring duplicate checkout session failed:', session.id, error?.message || error);
      }
    }
  }
  return keep;
}

export async function cancelIncompleteStripeSubscriptions(stripe, customerId, isInScope) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!stripe || !normalizedCustomerId) return [];

  let subscriptions = [];
  try {
    const result = await stripe.subscriptions.list({
      customer: normalizedCustomerId,
      status: 'incomplete',
      limit: 20,
    });
    subscriptions = result?.data || [];
  } catch (error) {
    if (isStripeResourceMissing(error)) return [];
    throw error;
  }

  const cancelledIds = [];
  for (const sub of subscriptions) {
    if (typeof isInScope === 'function' && !isInScope(sub)) continue;
    if (String(sub?.status || '').trim().toLowerCase() !== 'incomplete') continue;
    const subscriptionId = String(sub?.id || '').trim();
    if (!subscriptionId) continue;
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      if (!isStripeResourceMissing(error)) throw error;
    }
    // Keep the listed id even when the other request already cancelled it,
    // so both requests build the same checkout idempotency key.
    cancelledIds.push(subscriptionId);
  }
  return cancelledIds;
}
