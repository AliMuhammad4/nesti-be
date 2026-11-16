import Subscription from '../../models/Subscription.js';
import PublicProfile from '../../models/PublicProfile.js';
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
import { serializePaidTemplateSubscriptions } from './storefrontTemplates/access.js';
import { refreshStorefrontTemplateSubscriptionsForUser } from './storefrontTemplates/refresh.js';
import { paymentActionForOpenInvoice } from './subscriptionInvoiceService.js';

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
  const templateSubscriptions = await loadTemplateSubscriptionsForUser(user, {
    refresh: refreshFromStripe,
  });
  if (!subscription) {
    return {
      ...serialized,
      templateSubscriptions,
      planLimits: getPlanLimitsForSubscription(null),
      usage: {},
      isExpired: true,
      raw: null,
    };
  }
  const usage = await getPlanUsageForUser(user._id);
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'past_due' || status === 'unpaid') {
    const paymentAction = await paymentActionForOpenInvoice({
      customerId: subscription.stripe_customer_id,
      subscriptionId: subscription.stripe_subscription_id,
      latestInvoiceId: subscription.latest_invoice_id,
    });
    if (paymentAction) {
      serialized.paymentActionUrl = paymentAction.paymentActionUrl;
      serialized.paymentActionLabel = paymentAction.paymentActionLabel;
      serialized.openInvoice = paymentAction.openInvoice;
    }
  }
  return {
    ...serialized,
    templateSubscriptions,
    planLimits: getPlanLimitsForSubscription(subscription),
    usage,
    isExpired: serialized.accountStatus === 'expired',
    raw: subscription,
  };
}

const TEMPLATE_PROFILE_SELECT = 'professional_type storefront.template_purchases storefront.unlocked_template_ids';

async function loadTemplateSubscriptionsForUser(user, { refresh = false } = {}) {
  // Clients never own storefront templates, so skip the lookup entirely.
  if (String(user?.role || '') === USER_ROLE.CLIENT) return [];

  const profile = refresh
    ? await refreshStorefrontTemplateSubscriptionsForUser(user._id).catch(() => null)
    : await PublicProfile.findOne({ user_id: user._id }).select(TEMPLATE_PROFILE_SELECT).lean();
  if (!profile) return [];
  const rows = serializePaidTemplateSubscriptions(profile);
  const platform = await Subscription.findOne({ user_id: user._id })
    .select('stripe_customer_id')
    .lean();
  const customerId = String(platform?.stripe_customer_id || '').trim();
  if (!customerId) return rows;
  return Promise.all(rows.map(async (row) => {
    const status = String(row.status || '').trim().toLowerCase();
    if (status !== 'past_due' && status !== 'unpaid') return row;
    const paymentAction = await paymentActionForOpenInvoice({
      customerId,
      subscriptionId: row.stripe_subscription_id,
      latestInvoiceId: row.stripe_invoice_id,
    });
    if (!paymentAction) return row;
    return {
      ...row,
      paymentActionUrl: paymentAction.paymentActionUrl,
      paymentActionLabel: paymentAction.paymentActionLabel,
    };
  }));
}
