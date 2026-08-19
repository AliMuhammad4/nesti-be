import Subscription from '../../models/Subscription.js';
import { USER_ROLE } from '../../constants/roles.js';
import { getPlanLimitsForSubscription } from './entitlements.js';
import { getPlanUsageForUser } from './planQuota.js';
import {
  expireCanceledSubscriptionIfNeeded,
  expireTrialIfNeeded,
  getOrCreateSubscriptionForUser,
  serializeSubscription,
} from './subscriptionLocalService.js';
import { refreshSubscriptionFromStripeForUser } from './subscriptionStripeSyncService.js';
import { subscriptionNeedsStripeRefresh } from './subscriptionShared.js';

export async function getFreshSubscriptionForUser(user) {
  await getOrCreateSubscriptionForUser(user);
  if (String(user?.role || '') === USER_ROLE.CLIENT) {
    return Subscription.findOne({ user_id: user._id }).then((subscription) =>
      expireCanceledSubscriptionIfNeeded(subscription),
    );
  }
  await refreshSubscriptionFromStripeForUser(user);
  const subscription = await Subscription.findOne({ user_id: user._id });
  return expireTrialIfNeeded(subscription);
}

export async function getSubscriptionForRead(user, { refresh = false } = {}) {
  if (refresh) return getFreshSubscriptionForUser(user);
  const subscription = await getOrCreateSubscriptionForUser(user);
  if (subscriptionNeedsStripeRefresh(subscription)) {
    return getFreshSubscriptionForUser(user);
  }
  return expireTrialIfNeeded(subscription);
}

export async function getSubscriptionPresentationForUser(
  user,
  { refreshFromStripe = true } = {},
) {
  let subscription = refreshFromStripe
    ? await getFreshSubscriptionForUser(user)
    : await getOrCreateSubscriptionForUser(user);
  if (!refreshFromStripe && subscriptionNeedsStripeRefresh(subscription)) {
    subscription = await getFreshSubscriptionForUser(user);
  }
  const serialized = serializeSubscription(subscription);
  if (!subscription) {
    return {
      ...serialized,
      planLimits: getPlanLimitsForSubscription(null),
      usage: {},
      isExpired: true,
      raw: null,
    };
  }
  const usage = await getPlanUsageForUser(user._id);
  return {
    ...serialized,
    planLimits: getPlanLimitsForSubscription(subscription),
    usage,
    isExpired: serialized.accountStatus === 'expired',
    raw: subscription,
  };
}
