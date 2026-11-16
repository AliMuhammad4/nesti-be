import Subscription from '../../models/Subscription.js';
import { getPlan } from './plans.js';
import { chargeForPlan, recurringPriceData, trialEndUnix } from './planPrices.js';
import { getStripeClient } from './stripeClient.js';
import { ensureStripeCustomerForUser } from './subscriptionCustomerService.js';
import { expireTrialIfNeeded } from './subscriptionLocalService.js';
import { getFreshSubscriptionForUser } from './subscriptionReadService.js';
import {
  findBlockingStripeSubscription,
  syncStripeSubscription,
} from './subscriptionStripeSyncService.js';
import {
  buildCheckoutIdempotencyKey,
  cancelIncompleteStripeSubscriptions,
  checkoutAlreadyOpenMessage,
  deduplicateNewCheckoutSession,
  expireLeftoverOpenCheckoutSessions,
  getBillingFrontendOrigin,
  isProfessionalPlatformStripeSubscription,
  STRIPE_BLOCKING_STATUSES,
  userHasActiveSubscriptionAccess,
} from './subscriptionShared.js';

async function listBlockingProfessionalStripeSubscriptions(stripe, customerId) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId) return [];
  const result = await stripe.subscriptions.list({
    customer: normalizedCustomerId,
    status: 'all',
    limit: 20,
  });
  return (result.data || []).filter((sub) => (
    isProfessionalPlatformStripeSubscription(sub)
    && STRIPE_BLOCKING_STATUSES.has(String(sub.status || '').trim().toLowerCase())
  ));
}

function professionalCheckoutBlocked(user, stripeSubscription) {
  return {
    ok: false,
    code: 409,
    message: checkoutAlreadyOpenMessage(stripeSubscription?.status),
  };
}

async function assertUserCanPurchasePlan(user, subscription) {
  const current = await expireTrialIfNeeded(subscription);
  if (userHasActiveSubscriptionAccess(current)) {
    return professionalCheckoutBlocked(user, current);
  }
  const customerId = String(current?.stripe_customer_id || '').trim();
  if (!customerId) return { ok: true, cancelledSubscriptionIds: [] };
  const stripe = getStripeClient();
  const cancelledSubscriptionIds = await cancelIncompleteStripeSubscriptions(
    stripe,
    customerId,
    isProfessionalPlatformStripeSubscription,
  );
  const blocking = await listBlockingProfessionalStripeSubscriptions(stripe, customerId);
  if (!blocking.length) {
    const fallback = await findBlockingStripeSubscription(customerId);
    if (!fallback || !isProfessionalPlatformStripeSubscription(fallback)) {
      return { ok: true, cancelledSubscriptionIds };
    }
    await syncStripeSubscription(fallback, { user_id: String(user._id) });
    return professionalCheckoutBlocked(user, fallback);
  }
  await syncStripeSubscription(blocking[0], { user_id: String(user._id) });
  return professionalCheckoutBlocked(user, blocking[0]);
}

export async function createCheckoutSessionForUser(user, planKey, billingPeriod) {
  const plan = getPlan(planKey);
  if (!plan) {
    return { ok: false, code: 400, message: 'Invalid subscription plan.' };
  }
  const charge = chargeForPlan(plan, billingPeriod);

  const subscription = await getFreshSubscriptionForUser(user);
  await ensureStripeCustomerForUser(user, subscription, { planKey: plan.plan_key });
  const freshSubscription = await Subscription.findOne({ user_id: user._id });
  const customerId = freshSubscription?.stripe_customer_id
    || await ensureStripeCustomerForUser(user, freshSubscription, { planKey: plan.plan_key });
  const frontendUrl = getBillingFrontendOrigin();
  if (!frontendUrl) {
    return { ok: false, code: 503, message: 'FRONTEND_URL is not configured.' };
  }
  const metadata = {
    user_id: String(user._id),
    plan_key: plan.plan_key,
    billing_period: charge.billingPeriod,
    amount: String(charge.amount),
    subscription_type: 'professional',
  };
  const trialEnd = trialEndUnix(freshSubscription?.trial_end);
  const stripe = getStripeClient();
  const reusableSession = await expireLeftoverOpenCheckoutSessions(stripe, customerId, {
    userId: String(user._id),
    subscriptionType: 'professional',
    planKey: plan.plan_key,
    billingPeriod: charge.billingPeriod,
  });
  if (reusableSession?.url) {
    return { ok: true, session: reusableSession };
  }

  const purchaseEligibility = await assertUserCanPurchasePlan(user, freshSubscription);
  if (!purchaseEligibility.ok) return purchaseEligibility;

  const checkoutOptions = {
    userId: String(user._id),
    subscriptionType: 'professional',
    planKey: plan.plan_key,
    billingPeriod: charge.billingPeriod,
  };
  const openedWhileCancelling = await expireLeftoverOpenCheckoutSessions(stripe, customerId, checkoutOptions);
  if (openedWhileCancelling?.url) {
    return { ok: true, session: openedWhileCancelling };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{
      price_data: recurringPriceData({
        name: `Nesti ${plan.name}`,
        amount: charge.amount,
        currency: charge.currency,
        interval: charge.interval,
        description: charge.billingPeriod === 'year' ? 'Billed once a year' : 'Billed monthly',
      }),
      quantity: 1,
    }],
    success_url: `${frontendUrl}/settings?billing=success`,
    cancel_url: `${frontendUrl}/settings?billing=cancelled`,
    metadata,
    subscription_data: {
      metadata,
      ...(trialEnd ? { trial_end: trialEnd } : {}),
    },
  }, {
    idempotencyKey: buildCheckoutIdempotencyKey({
      kind: 'professional-checkout',
      userId: user._id,
      planKey: plan.plan_key,
      billingPeriod: charge.billingPeriod,
      leftoverSubscriptionIds: purchaseEligibility.cancelledSubscriptionIds,
    }),
  });
  const deduped = await deduplicateNewCheckoutSession(stripe, customerId, session, checkoutOptions);
  return { ok: true, session: deduped };
}
