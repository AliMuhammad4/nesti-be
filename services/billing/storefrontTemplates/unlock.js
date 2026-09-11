import PublicProfile from '../../../models/PublicProfile.js';
import {
  getStorefrontTemplateTier,
  isStorefrontTemplateFree,
} from './tiers.js';
import {
  uniqueTemplateIds,
  userHasStorefrontTemplateAccess,
} from './access.js';

function normalizeStripeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.id || '').trim();
}

function buildTemplatePurchaseRecord(template, purchase = {}) {
  return {
    template_id: template.template_id,
    tier: template.tier,
    amount: Number(purchase.amount ?? template.amount),
    currency: String(purchase.currency || template.currency).toLowerCase(),
    billing_interval: String(purchase.billing_interval || template.interval || 'month'),
    stripe_checkout_session_id: String(purchase.stripe_checkout_session_id || '').trim(),
    stripe_payment_intent_id: String(purchase.stripe_payment_intent_id || '').trim(),
    stripe_invoice_id: String(purchase.stripe_invoice_id || '').trim(),
    stripe_subscription_id: String(purchase.stripe_subscription_id || '').trim(),
    subscription_status: String(purchase.subscription_status || '').trim().toLowerCase(),
    cancel_at_period_end: purchase.cancel_at_period_end === true,
    current_period_end: purchase.current_period_end || null,
    purchased_at: purchase.purchased_at || new Date(),
  };
}

async function reconcileUnlockedTemplateIds(profileFilter, templateId) {
  const profile = await PublicProfile.findOne(profileFilter);
  if (!profile) return null;
  const hasAccess = userHasStorefrontTemplateAccess(profile, templateId);
  const unlocked = uniqueTemplateIds(profile.storefront?.unlocked_template_ids);
  if (hasAccess && !unlocked.includes(templateId)) {
    await PublicProfile.updateOne(profileFilter, {
      $addToSet: { 'storefront.unlocked_template_ids': templateId },
    });
  } else if (!hasAccess && unlocked.includes(templateId) && !isStorefrontTemplateFree(templateId)) {
    await PublicProfile.updateOne(profileFilter, {
      $pull: { 'storefront.unlocked_template_ids': templateId },
    });
  }
  if (!hasAccess && !isStorefrontTemplateFree(templateId)) {
    const { unpublishStorefrontIfTemplateAccessLost } = await import('./manage.js');
    await unpublishStorefrontIfTemplateAccessLost(profileFilter.user_id, templateId);
  }
  return PublicProfile.findOne(profileFilter);
}

export async function unlockStorefrontTemplateForUser(userId, templateId, purchase = {}) {
  const template = getStorefrontTemplateTier(templateId);
  if (!template) return null;
  const profileFilter = {
    user_id: userId,
    professional_type: template.professional_type,
  };

  const checkoutSessionId = String(purchase.stripe_checkout_session_id || '').trim();
  const subscriptionId = String(purchase.stripe_subscription_id || '').trim();
  if (template.amount > 0 && !checkoutSessionId && !subscriptionId) return null;

  const purchaseRecord = buildTemplatePurchaseRecord(template, {
    ...purchase,
    subscription_status: purchase.subscription_status
      || (subscriptionId ? 'active' : ''),
  });

  if (subscriptionId) {
    const setFields = {
      'storefront.template_purchases.$.template_id': purchaseRecord.template_id,
      'storefront.template_purchases.$.tier': purchaseRecord.tier,
      'storefront.template_purchases.$.amount': purchaseRecord.amount,
      'storefront.template_purchases.$.currency': purchaseRecord.currency,
      'storefront.template_purchases.$.billing_interval': purchaseRecord.billing_interval,
      'storefront.template_purchases.$.stripe_payment_intent_id': purchaseRecord.stripe_payment_intent_id,
      'storefront.template_purchases.$.stripe_invoice_id': purchaseRecord.stripe_invoice_id,
      'storefront.template_purchases.$.subscription_status': purchaseRecord.subscription_status,
      'storefront.template_purchases.$.cancel_at_period_end': purchaseRecord.cancel_at_period_end,
      'storefront.template_purchases.$.current_period_end': purchaseRecord.current_period_end,
    };
    if (purchaseRecord.stripe_checkout_session_id) {
      setFields['storefront.template_purchases.$.stripe_checkout_session_id'] = (
        purchaseRecord.stripe_checkout_session_id
      );
    }
    const updated = await PublicProfile.updateOne(
      {
        ...profileFilter,
        'storefront.template_purchases.stripe_subscription_id': subscriptionId,
      },
      { $set: setFields },
    );
    if (!updated.matchedCount) {
      await PublicProfile.updateOne(profileFilter, {
        $push: { 'storefront.template_purchases': purchaseRecord },
      });
    }
  } else if (checkoutSessionId) {
    await PublicProfile.updateOne(
      {
        ...profileFilter,
        'storefront.template_purchases.stripe_checkout_session_id': { $ne: checkoutSessionId },
      },
      {
        $push: { 'storefront.template_purchases': purchaseRecord },
      },
    );
  }

  return reconcileUnlockedTemplateIds(profileFilter, template.template_id);
}

export async function syncStorefrontTemplateSubscription(stripeSubscription) {
  const metadata = stripeSubscription?.metadata || {};
  if (String(metadata.purchase_type || '').trim() !== 'storefront_template') return null;

  const userId = String(metadata.user_id || '').trim();
  const template = getStorefrontTemplateTier(metadata.template_id);
  if (!userId || !template) return null;

  const subscriptionId = normalizeStripeId(stripeSubscription);
  const status = String(stripeSubscription.status || '').trim().toLowerCase();
  const periodEnd = stripeSubscription.current_period_end
    ? new Date(Number(stripeSubscription.current_period_end) * 1000)
    : null;

  return unlockStorefrontTemplateForUser(userId, template.template_id, {
    amount: template.amount,
    currency: template.currency,
    billing_interval: template.interval || 'month',
    stripe_subscription_id: subscriptionId,
    subscription_status: status,
    cancel_at_period_end: stripeSubscription.cancel_at_period_end === true,
    current_period_end: periodEnd,
    purchased_at: stripeSubscription.created
      ? new Date(Number(stripeSubscription.created) * 1000)
      : new Date(),
  });
}

export { normalizeStripeId };
