import PublicProfile from '../../../models/PublicProfile.js';
import Subscription from '../../../models/Subscription.js';
import { getStripeClient } from '../stripeClient.js';
import { getStripeSubscriptionPeriodEnd, isStripeResourceMissing } from '../subscriptionShared.js';
import logger from '../../../utils/logger.js';
import {
  FREE_TEMPLATE_IDS,
  getStorefrontTemplateTier,
  isStorefrontTemplateFree,
  normalizeTemplateId,
  storefrontTemplateSupportsProfile,
} from './tiers.js';
import {
  templatePurchaseGrantsAccess,
  uniqueTemplateIds,
} from './access.js';
import { normalizeStripeId } from './unlock.js';

const PROFILE_SELECT = 'storefront.template_purchases storefront.unlocked_template_ids storefront.published storefront.active_template_id professional_type slug enabled headline cover_photo_url profile_photo_url';

/** Repeat reads within this window reuse the last Stripe reconcile. */
const REFRESH_TTL_MS = 60_000;
/** Healthy rows re-sync on this cadence even when the period is still open. */
const SYNCED_ROW_TTL_MS = 6 * 60 * 60 * 1000;

const lastRefreshAt = new Map();
const inFlightRefreshes = new Map();

function isTemplateSubscriptionMetadata(metadata = {}) {
  return (
    String(metadata.purchase_type || '').trim() === 'storefront_template'
    || String(metadata.subscription_type || '').trim().toLowerCase() === 'storefront_template'
  );
}

function isPaidTemplatePurchase(purchase) {
  const template = getStorefrontTemplateTier(purchase?.template_id);
  return Boolean(template) && Number(template.amount || 0) > 0;
}

function purchaseNeedsStripe(purchase, now = Date.now()) {
  if (!isPaidTemplatePurchase(purchase)) return false;
  if (!String(purchase.stripe_subscription_id || '').trim()) return true;
  const periodEnd = purchase.current_period_end ? new Date(purchase.current_period_end).getTime() : NaN;
  if (!Number.isFinite(periodEnd) || periodEnd <= now) return true;
  const syncedAt = purchase.last_synced_at ? new Date(purchase.last_synced_at).getTime() : NaN;
  return !Number.isFinite(syncedAt) || now - syncedAt > SYNCED_ROW_TTL_MS;
}

function applyStripeSubscriptionToPurchase(purchase, stripeSubscription) {
  purchase.stripe_subscription_id = normalizeStripeId(stripeSubscription);
  purchase.subscription_status = String(stripeSubscription.status || 'active').trim().toLowerCase();
  purchase.cancel_at_period_end = stripeSubscription.cancel_at_period_end === true;
  const periodEnd = getStripeSubscriptionPeriodEnd(stripeSubscription);
  if (periodEnd) purchase.current_period_end = periodEnd;
  purchase.last_synced_at = new Date();
}

async function loadStripeCustomerId(userId, purchases, stripe) {
  const subscription = await Subscription.findOne({ user_id: userId })
    .select('stripe_customer_id')
    .lean();
  const fromPlatform = String(subscription?.stripe_customer_id || '').trim();
  if (fromPlatform) return fromPlatform;

  const sessionId = purchases
    .map((purchase) => String(purchase.stripe_checkout_session_id || '').trim())
    .find(Boolean);
  if (!sessionId) return '';
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return normalizeStripeId(session.customer);
  } catch (error) {
    if (!isStripeResourceMissing(error)) throw error;
    return '';
  }
}

/**
 * One `subscriptions.list` per customer replaces a retrieve per purchase, so a
 * profile with five templates costs one Stripe round trip instead of five.
 */
async function loadCustomerTemplateSubscriptions(stripe, customerId) {
  const byId = new Map();
  const byTemplateId = new Map();
  if (!customerId) return { byId, byTemplateId };

  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  });
  (listed.data || []).forEach((subscription) => {
    const id = normalizeStripeId(subscription);
    if (id) byId.set(id, subscription);
    const metadata = subscription?.metadata || {};
    if (!isTemplateSubscriptionMetadata(metadata)) return;
    const templateId = normalizeTemplateId(metadata.template_id);
    if (!templateId) return;
    const existing = byTemplateId.get(templateId);
    const existingCreated = Number(existing?.created || 0);
    if (!existing || Number(subscription.created || 0) >= existingCreated) {
      byTemplateId.set(templateId, subscription);
    }
  });
  return { byId, byTemplateId };
}

function reconcileUnlockedTemplates(profile) {
  const purchases = profile.storefront?.template_purchases || [];
  const compatibleFreeIds = [...FREE_TEMPLATE_IDS].filter((templateId) => (
    storefrontTemplateSupportsProfile(getStorefrontTemplateTier(templateId), profile)
  ));
  const unlockedFromPurchases = purchases
    .filter((purchase) => templatePurchaseGrantsAccess(purchase))
    .map((purchase) => purchase.template_id);
  const nextUnlocked = uniqueTemplateIds([...compatibleFreeIds, ...unlockedFromPurchases]);
  const currentUnlocked = uniqueTemplateIds(profile.storefront?.unlocked_template_ids);
  if (
    nextUnlocked.length !== currentUnlocked.length
    || nextUnlocked.some((templateId) => !currentUnlocked.includes(templateId))
  ) {
    profile.storefront.unlocked_template_ids = nextUnlocked;
  }

  const publishedTemplateId = normalizeTemplateId(profile.storefront?.published?.template?.id);
  if (
    profile.storefront?.published
    && publishedTemplateId
    && !isStorefrontTemplateFree(publishedTemplateId)
    && !nextUnlocked.includes(publishedTemplateId)
  ) {
    profile.storefront.published = null;
  }
}

async function runRefresh(userId) {
  const profile = await PublicProfile.findOne({ user_id: userId });
  if (!profile) return null;

  const purchases = profile.storefront?.template_purchases || [];
  const stalePurchases = purchases.filter((purchase) => purchaseNeedsStripe(purchase));
  if (!stalePurchases.length) {
    return PublicProfile.findOne({ user_id: userId }).select(PROFILE_SELECT).lean();
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch {
    return PublicProfile.findOne({ user_id: userId }).select(PROFILE_SELECT).lean();
  }

  const customerId = await loadStripeCustomerId(userId, purchases, stripe);
  const { byId, byTemplateId } = await loadCustomerTemplateSubscriptions(stripe, customerId);

  for (const purchase of stalePurchases) {
    const subscriptionId = String(purchase.stripe_subscription_id || '').trim();
    let stripeSubscription = subscriptionId
      ? byId.get(subscriptionId)
      : byTemplateId.get(normalizeTemplateId(purchase.template_id));

    if (!stripeSubscription && subscriptionId) {
      try {
        stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (error) {
        if (!isStripeResourceMissing(error)) throw error;
      }
    }

    if (stripeSubscription) {
      applyStripeSubscriptionToPurchase(purchase, stripeSubscription);
    } else if (!subscriptionId) {
      // Checkout completed without a linked subscription yet; keep the monthly
      // window open from the purchase date so access is not dropped early.
      purchase.last_synced_at = new Date();
    }
  }

  reconcileUnlockedTemplates(profile);
  if (profile.isModified()) await profile.save();

  return PublicProfile.findOne({ user_id: userId }).select(PROFILE_SELECT).lean();
}

export async function refreshStorefrontTemplateSubscriptionsForUser(userId) {
  const key = String(userId || '');
  if (!key) return null;

  const inFlight = inFlightRefreshes.get(key);
  if (inFlight) return inFlight;

  const lastRun = lastRefreshAt.get(key) || 0;
  if (Date.now() - lastRun < REFRESH_TTL_MS) {
    return PublicProfile.findOne({ user_id: userId }).select(PROFILE_SELECT).lean();
  }

  const pending = runRefresh(userId)
    .catch((error) => {
      logger.warn('Storefront template refresh failed', { user_id: key, message: error?.message });
      return PublicProfile.findOne({ user_id: userId }).select(PROFILE_SELECT).lean();
    })
    .finally(() => {
      lastRefreshAt.set(key, Date.now());
      inFlightRefreshes.delete(key);
    });

  inFlightRefreshes.set(key, pending);
  return pending;
}
