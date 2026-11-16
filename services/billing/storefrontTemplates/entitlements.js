import PublicProfile from '../../../models/PublicProfile.js';
import Subscription from '../../../models/Subscription.js';
import { paymentActionForOpenInvoice } from '../subscriptionInvoiceService.js';
import { normalizeTemplateId } from './tiers.js';
import {
  ensureFreeStorefrontTemplateUnlock,
  serializeStorefrontTemplateEntitlements,
} from './access.js';
import { refreshStorefrontTemplateSubscriptionsForUser } from './refresh.js';

async function attachOverduePaymentActions(profile, entitlements) {
  const purchases = profile.storefront?.template_purchases || [];
  const overdue = (entitlements.templates || []).some((template) => {
    const status = String(template.subscription?.status || '').trim().toLowerCase();
    return status === 'past_due' || status === 'unpaid';
  });
  if (!overdue) return entitlements;
  const platform = await Subscription.findOne({ user_id: profile.user_id })
    .select('stripe_customer_id')
    .lean();
  const customerId = String(platform?.stripe_customer_id || '').trim();
  if (!customerId) return entitlements;
  const templates = await Promise.all((entitlements.templates || []).map(async (template) => {
    const status = String(template.subscription?.status || '').trim().toLowerCase();
    if (status !== 'past_due' && status !== 'unpaid') return template;
    const purchase = purchases
      .filter((row) => (
        normalizeTemplateId(row.template_id) === template.template_id
        && String(row.stripe_subscription_id || '').trim()
      ))
      .sort((left, right) => new Date(right.purchased_at || 0) - new Date(left.purchased_at || 0))[0];
    if (!purchase) return template;
    const paymentAction = await paymentActionForOpenInvoice({
      customerId,
      subscriptionId: purchase.stripe_subscription_id,
      latestInvoiceId: purchase.stripe_invoice_id,
    });
    if (!paymentAction) return template;
    return {
      ...template,
      subscription: {
        ...template.subscription,
        paymentActionUrl: paymentAction.paymentActionUrl,
        paymentActionLabel: paymentAction.paymentActionLabel,
      },
    };
  }));
  return { ...entitlements, templates };
}

export async function getStorefrontTemplateEntitlementsForUser(userId) {
  await refreshStorefrontTemplateSubscriptionsForUser(userId).catch(() => null);
  const profile = await PublicProfile.findOne({ user_id: userId });
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  await ensureFreeStorefrontTemplateUnlock(profile);
  if (profile.isModified('storefront')) await profile.save();
  const entitlements = await attachOverduePaymentActions(
    profile,
    serializeStorefrontTemplateEntitlements(profile),
  );
  return { ok: true, entitlements };
}
