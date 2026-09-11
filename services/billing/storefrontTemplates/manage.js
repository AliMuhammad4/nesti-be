import PublicProfile from '../../../models/PublicProfile.js';
import { getStripeClient } from '../stripeClient.js';
import {
  getStorefrontTemplateTier,
  normalizeTemplateId,
  storefrontTemplateSupportsProfile,
} from './tiers.js';
import {
  serializeStorefrontTemplateEntitlements,
  userHasStorefrontTemplateAccess,
} from './access.js';
import { normalizeStripeId, syncStorefrontTemplateSubscription } from './unlock.js';

function findManageableTemplatePurchase(profile, templateId) {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const purchases = Array.isArray(profile?.storefront?.template_purchases)
    ? profile.storefront.template_purchases
    : [];
  return [...purchases]
    .reverse()
    .find((purchase) => (
      normalizeTemplateId(purchase.template_id) === normalizedTemplateId
      && String(purchase.stripe_subscription_id || '').trim()
    )) || null;
}

export async function cancelStorefrontTemplateSubscriptionForUser(user, templateId, reason = '') {
  const template = getStorefrontTemplateTier(templateId);
  if (!template || template.amount <= 0) {
    return { ok: false, code: 400, message: 'This template does not have a cancelable subscription.' };
  }

  const profile = await PublicProfile.findOne({ user_id: user._id });
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  if (!storefrontTemplateSupportsProfile(template, profile)) {
    return { ok: false, code: 400, message: 'This template is not available for your professional type.' };
  }

  const purchase = findManageableTemplatePurchase(profile, template.template_id);
  const subscriptionId = String(purchase?.stripe_subscription_id || '').trim();
  if (!subscriptionId) {
    return { ok: false, code: 404, message: 'No active template subscription found to cancel.' };
  }

  const stripe = getStripeClient();
  let stripeSubscription;
  try {
    stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    return { ok: false, code: 409, message: 'Stripe could not find this template subscription. Refresh and try again.' };
  }

  const status = String(stripeSubscription.status || '').toLowerCase();
  if (['canceled', 'incomplete_expired', 'unpaid'].includes(status)) {
    await syncStorefrontTemplateSubscription(stripeSubscription);
    const refreshed = await PublicProfile.findOne({ user_id: user._id }).lean();
    return {
      ok: true,
      alreadyCanceled: true,
      template,
      entitlements: serializeStorefrontTemplateEntitlements(refreshed),
    };
  }

  if (stripeSubscription.cancel_at_period_end) {
    const refreshed = await PublicProfile.findOne({ user_id: user._id }).lean();
    return {
      ok: true,
      alreadyScheduled: true,
      template,
      entitlements: serializeStorefrontTemplateEntitlements(refreshed),
    };
  }

  const updated = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
    metadata: {
      ...(stripeSubscription.metadata || {}),
      purchase_type: 'storefront_template',
      subscription_type: 'storefront_template',
      user_id: String(user._id),
      template_id: template.template_id,
      tier: template.tier,
      cancellation_reason: String(reason || '').trim().slice(0, 500),
      cancellation_requested_at: new Date().toISOString(),
    },
  });
  await syncStorefrontTemplateSubscription(updated);
  const refreshed = await PublicProfile.findOne({ user_id: user._id }).lean();
  return {
    ok: true,
    template,
    entitlements: serializeStorefrontTemplateEntitlements(refreshed),
  };
}

export async function resumeStorefrontTemplateSubscriptionForUser(user, templateId) {
  const template = getStorefrontTemplateTier(templateId);
  if (!template || template.amount <= 0) {
    return { ok: false, code: 400, message: 'This template does not have a resumable subscription.' };
  }

  const profile = await PublicProfile.findOne({ user_id: user._id });
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  if (!storefrontTemplateSupportsProfile(template, profile)) {
    return { ok: false, code: 400, message: 'This template is not available for your professional type.' };
  }

  const purchase = findManageableTemplatePurchase(profile, template.template_id);
  const subscriptionId = String(purchase?.stripe_subscription_id || '').trim();
  if (!subscriptionId) {
    return { ok: false, code: 404, message: 'No template subscription found to resume.' };
  }

  const stripe = getStripeClient();
  let stripeSubscription;
  try {
    stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    return { ok: false, code: 409, message: 'Stripe could not find this template subscription. Subscribe again to restore access.' };
  }

  const status = String(stripeSubscription.status || '').toLowerCase();
  if (['canceled', 'incomplete_expired'].includes(status)) {
    return {
      ok: false,
      code: 409,
      message: 'This template subscription already ended. Subscribe again to restore access.',
    };
  }
  if (!stripeSubscription.cancel_at_period_end) {
    const refreshed = await PublicProfile.findOne({ user_id: user._id }).lean();
    return {
      ok: true,
      alreadyActive: true,
      template,
      entitlements: serializeStorefrontTemplateEntitlements(refreshed),
    };
  }

  const updated = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
    metadata: {
      ...(stripeSubscription.metadata || {}),
      purchase_type: 'storefront_template',
      subscription_type: 'storefront_template',
      user_id: String(user._id),
      template_id: template.template_id,
      tier: template.tier,
      cancellation_reason: '',
    },
  });
  await syncStorefrontTemplateSubscription(updated);
  const refreshed = await PublicProfile.findOne({ user_id: user._id }).lean();
  return {
    ok: true,
    template,
    entitlements: serializeStorefrontTemplateEntitlements(refreshed),
  };
}

export function publishedTemplateIdFromProfile(profile) {
  return normalizeTemplateId(
    profile?.storefront?.published?.template?.id
    || profile?.storefront?.published?.data?.template?.id
    || '',
  );
}

export async function unpublishStorefrontIfTemplateAccessLost(userId, templateId) {
  const template = getStorefrontTemplateTier(templateId);
  if (!template || isFreeOrMissing(template)) return null;

  const profile = await PublicProfile.findOne({
    user_id: userId,
    professional_type: template.professional_type,
  });
  if (!profile?.storefront?.published) return null;

  const publishedTemplateId = publishedTemplateIdFromProfile(profile);
  if (!publishedTemplateId || publishedTemplateId !== template.template_id) return null;
  if (userHasStorefrontTemplateAccess(profile, publishedTemplateId)) return null;

  profile.storefront.published = null;
  await profile.save();
  return profile;
}

function isFreeOrMissing(template) {
  return !template || Number(template.amount || 0) <= 0;
}
