import Subscription from '../../models/Subscription.js';
import { USER_ROLE } from '../../constants/roles.js';
import {
  ACTIVE_ACCESS_STATUSES,
  accountStatusFromSubscription,
  isSubscriptionPeriodEnded,
  toIsoDate,
} from './subscriptionShared.js';

export const FREE_TRIAL_DAYS = 3;

export async function markSubscriptionStripeStateExpired(userId) {
  return Subscription.findOneAndUpdate(
    { user_id: userId },
    {
      $set: {
        stripe_customer_id: '',
        stripe_subscription_id: '',
        stripe_price_id: '',
        stripe_subscription_schedule_id: '',
        pending_plan_key: '',
        pending_plan_effective_at: null,
        status: 'expired',
        cancel_at_period_end: false,
        current_period_start: null,
        current_period_end: null,
        latest_invoice_id: '',
        last_payment_status: '',
        last_synced_at: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
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

async function normalizeFreeTrialDuration(subscription) {
  if (!subscription?.trial_start || !['free_trial', 'expired'].includes(subscription.status)) {
    return subscription;
  }
  const trialStart = new Date(subscription.trial_start);
  if (Number.isNaN(trialStart.getTime())) return subscription;
  const expectedTrialEnd = new Date(trialStart.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const currentTrialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null;
  const shouldExtend =
    !currentTrialEnd
    || Number.isNaN(currentTrialEnd.getTime())
    || currentTrialEnd.getTime() < expectedTrialEnd.getTime();
  if (!shouldExtend) return subscription;

  subscription.trial_end = expectedTrialEnd;
  if (subscription.status === 'expired' && expectedTrialEnd > new Date()) {
    subscription.status = 'free_trial';
  }
  await subscription.save();
  return subscription;
}

export async function expireTrialIfNeeded(subscription) {
  subscription = await normalizeFreeTrialDuration(subscription);
  if (
    subscription?.status === 'free_trial'
    && subscription.trial_end
    && new Date(subscription.trial_end) <= new Date()
  ) {
    subscription.status = 'expired';
    await subscription.save();
  }
  return expireCanceledSubscriptionIfNeeded(subscription);
}

export async function expireCanceledSubscriptionIfNeeded(subscription) {
  if (!subscription) return subscription;
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'free_trial') return subscription;
  const periodEnded = isSubscriptionPeriodEnded(subscription);
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const terminalStatus = ['canceled', 'cancelled', 'incomplete_expired'].includes(status);
  const shouldExpire =
    terminalStatus
    || (cancelAtPeriodEnd && periodEnded && ACTIVE_ACCESS_STATUSES.has(status));
  if (!shouldExpire) return subscription;

  if (status === 'expired' || status === 'canceled') {
    if (subscription.cancel_at_period_end) {
      subscription.cancel_at_period_end = false;
      await subscription.save();
    }
    return subscription;
  }
  subscription.status = 'expired';
  subscription.cancel_at_period_end = false;
  await subscription.save();
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
  if (String(user?.role || '') === USER_ROLE.CLIENT) {
    const existing = await Subscription.findOne({ user_id: user._id });
    if (!existing) return null;
    const status = String(existing.status || '').trim().toLowerCase();
    if (status === 'free_trial' || ACTIVE_ACCESS_STATUSES.has(status)) {
      existing.status = 'expired';
      existing.cancel_at_period_end = false;
      await existing.save();
    }
    return expireCanceledSubscriptionIfNeeded(existing);
  }

  let subscription = await Subscription.findOne({ user_id: user._id });
  if (!subscription) {
    const createdAt = user.createdAt ? new Date(user.createdAt) : new Date();
    const trialEnd = new Date(createdAt.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    subscription = await createFreeTrialSubscription(user._id, trialEnd);
  }
  return expireTrialIfNeeded(subscription);
}
