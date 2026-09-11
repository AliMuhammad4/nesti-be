import Subscription from '../../models/Subscription.js';
import { getPlan, getStripePriceId } from './plans.js';
import { getStripeClient } from './stripeClient.js';
import { ensureStripeCustomerForUser } from './subscriptionCustomerService.js';
import { expireTrialIfNeeded } from './subscriptionLocalService.js';
import { getFreshSubscriptionForUser } from './subscriptionReadService.js';
import {
  findBlockingStripeSubscription,
  syncStripeSubscription,
} from './subscriptionStripeSyncService.js';
import { userHasActiveSubscriptionAccess } from './subscriptionShared.js';

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
  if (!customerId) return { ok: true };
  const activeStripeSubscription = await findBlockingStripeSubscription(customerId);
  if (!activeStripeSubscription) return { ok: true };
  await syncStripeSubscription(activeStripeSubscription, { user_id: String(user._id) });
  return {
    ok: false,
    code: 409,
    message: 'An active subscription already exists. You can purchase a new plan after it expires.',
  };
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

  const subscription = await getFreshSubscriptionForUser(user);
  await ensureStripeCustomerForUser(user, subscription, { planKey: plan.plan_key });
  const freshSubscription = await Subscription.findOne({ user_id: user._id });
  const purchaseEligibility = await assertUserCanPurchasePlan(user, freshSubscription);
  if (!purchaseEligibility.ok) return purchaseEligibility;

  const customerId = freshSubscription?.stripe_customer_id
    || await ensureStripeCustomerForUser(user, freshSubscription, { planKey: plan.plan_key });
  const frontendUrl = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || '')
    .replace(/\/+$/, '');
  if (!frontendUrl) {
    return { ok: false, code: 503, message: 'FRONTEND_URL is not configured.' };
  }
  const session = await getStripeClient().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${frontendUrl}/settings?billing=success`,
    cancel_url: `${frontendUrl}/settings?billing=cancelled`,
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
