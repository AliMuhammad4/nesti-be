import PublicProfile from '../../../models/PublicProfile.js';
import {
  FREE_TEMPLATE_IDS,
  displayAmountForTemplate,
  getStorefrontTemplateTier,
  isStorefrontTemplateFree,
  listStorefrontTemplateTiers,
  lockedTemplateMessage,
  normalizeTemplateId,
  storefrontTemplateSupportsProfile,
} from './tiers.js';

const ACTIVE_TEMPLATE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
]);

export function uniqueTemplateIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(normalizeTemplateId).filter(Boolean))];
}

export function isActiveTemplateSubscriptionStatus(status) {
  return ACTIVE_TEMPLATE_SUBSCRIPTION_STATUSES.has(String(status || '').trim().toLowerCase());
}

export function templatePurchaseGrantsAccess(purchase = {}) {
  const subscriptionId = String(purchase.stripe_subscription_id || '').trim();
  if (subscriptionId) {
    return isActiveTemplateSubscriptionStatus(purchase.subscription_status);
  }
  // Legacy one-time unlocks remain valid until replaced by a monthly subscription.
  return Boolean(String(purchase.stripe_checkout_session_id || '').trim());
}

export function userHasStorefrontTemplateAccess(profile, templateId) {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  if (!normalizedTemplateId) return false;
  const template = getStorefrontTemplateTier(normalizedTemplateId);
  if (!storefrontTemplateSupportsProfile(template, profile)) return false;
  if (isStorefrontTemplateFree(normalizedTemplateId)) return true;

  const purchases = Array.isArray(profile?.storefront?.template_purchases)
    ? profile.storefront.template_purchases
    : [];
  return purchases.some((purchase) => (
    normalizeTemplateId(purchase.template_id) === normalizedTemplateId
    && templatePurchaseGrantsAccess(purchase)
  ));
}

export function serializeStorefrontTemplateEntitlements(profile) {
  const compatibleFreeTemplateIds = [...FREE_TEMPLATE_IDS].filter((templateId) => (
    storefrontTemplateSupportsProfile(getStorefrontTemplateTier(templateId), profile)
  ));
  const purchases = Array.isArray(profile?.storefront?.template_purchases)
    ? profile.storefront.template_purchases
    : [];
  const unlockedFromPurchases = uniqueTemplateIds(
    purchases
      .filter((purchase) => templatePurchaseGrantsAccess(purchase))
      .map((purchase) => purchase.template_id),
  );
  const unlockedTemplateIds = uniqueTemplateIds([
    ...compatibleFreeTemplateIds,
    ...unlockedFromPurchases,
  ]);

  const latestPurchaseByTemplate = new Map();
  purchases.forEach((purchase) => {
    const templateId = normalizeTemplateId(purchase.template_id);
    if (!templateId) return;
    const existing = latestPurchaseByTemplate.get(templateId);
    const purchasedAt = new Date(purchase.purchased_at || 0).getTime();
    const existingAt = new Date(existing?.purchased_at || 0).getTime();
    if (!existing || purchasedAt >= existingAt) {
      latestPurchaseByTemplate.set(templateId, purchase);
    }
  });

  return {
    templates: listStorefrontTemplateTiers().map((template) => {
      const purchase = latestPurchaseByTemplate.get(template.template_id) || null;
      const hasSubscription = Boolean(String(purchase?.stripe_subscription_id || '').trim());
      const legacyLifetime = Boolean(
        purchase
        && !hasSubscription
        && String(purchase.stripe_checkout_session_id || '').trim(),
      );
      const unlocked = (
        storefrontTemplateSupportsProfile(template, profile)
        && unlockedTemplateIds.includes(template.template_id)
      );
      return {
        ...template,
        unlocked,
        display_amount: displayAmountForTemplate(template),
        billing_interval: template.interval || 'month',
        subscription: purchase && (hasSubscription || legacyLifetime) ? {
          status: String(purchase.subscription_status || (legacyLifetime ? 'lifetime' : '')).toLowerCase(),
          cancel_at_period_end: purchase.cancel_at_period_end === true,
          current_period_end: purchase.current_period_end || null,
          billing_interval: purchase.billing_interval || template.interval || 'month',
          legacy_lifetime: legacyLifetime,
          manageable: hasSubscription && unlocked && isActiveTemplateSubscriptionStatus(
            purchase.subscription_status || 'active',
          ),
        } : null,
      };
    }),
    unlocked_template_ids: unlockedTemplateIds,
  };
}

export async function ensureFreeStorefrontTemplateUnlock(profile) {
  profile.storefront = profile.storefront || {};
  const unlocked = uniqueTemplateIds(profile.storefront.unlocked_template_ids);
  let changed = false;
  FREE_TEMPLATE_IDS.forEach((templateId) => {
    if (!storefrontTemplateSupportsProfile(getStorefrontTemplateTier(templateId), profile)) return;
    if (!unlocked.includes(templateId)) {
      unlocked.push(templateId);
      changed = true;
    }
  });
  // Drop paid templates that no longer have an active monthly subscription (or legacy purchase).
  const nextUnlocked = unlocked.filter((templateId) => {
    if (isStorefrontTemplateFree(templateId)) return true;
    return userHasStorefrontTemplateAccess(profile, templateId);
  });
  if (nextUnlocked.length !== unlocked.length) changed = true;
  if (changed) {
    profile.storefront.unlocked_template_ids = nextUnlocked;
  }
  return changed;
}

export async function assertStorefrontTemplateAccess(userId, templateId) {
  const profile = await PublicProfile.findOne({ user_id: userId }).lean();
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  const template = getStorefrontTemplateTier(templateId);
  if (!template) return { ok: false, code: 400, message: 'Unsupported storefront template.' };
  if (!storefrontTemplateSupportsProfile(template, profile)) {
    return { ok: false, code: 400, message: 'This template is not available for your professional type.' };
  }
  if (userHasStorefrontTemplateAccess(profile, template.template_id)) return { ok: true };
  return {
    ok: false,
    code: 402,
    message: lockedTemplateMessage(template),
    template,
  };
}

export async function getStorefrontTemplateEntitlementsForUser(userId) {
  const profile = await PublicProfile.findOne({ user_id: userId });
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  await ensureFreeStorefrontTemplateUnlock(profile);
  if (profile.isModified('storefront')) await profile.save();
  return { ok: true, entitlements: serializeStorefrontTemplateEntitlements(profile) };
}
