import Subscription from '../../models/Subscription.js';
import { getStripeClient } from './stripeClient.js';
import { markSubscriptionStripeStateExpired } from './subscriptionLocalService.js';
import {
  buildProrationNote,
  describeInvoice,
  formatInvoiceAmount,
  getInvoiceSubscriptionId,
  isStripeResourceMissing,
} from './subscriptionShared.js';
import { getStorefrontTemplateTier } from './storefrontTemplates/tiers.js';
import { isStorefrontTemplateStripeMetadata } from './storefrontTemplates/unlock.js';

function invoiceTemplateId(invoice = {}, templateBySubId = new Map()) {
  const sources = [
    invoice.metadata,
    invoice.subscription_details?.metadata,
    invoice.parent?.subscription_details?.metadata,
    ...(invoice.lines?.data || []).map((line) => line.metadata),
  ].filter(Boolean);
  const fromMeta = sources.find((meta) => (
    isStorefrontTemplateStripeMetadata(meta) && String(meta.template_id || '').trim()
  ));
  if (fromMeta?.template_id) return String(fromMeta.template_id).trim();
  const subId = getInvoiceSubscriptionId(invoice);
  return subId ? (templateBySubId.get(subId) || '') : '';
}

const INVOICE_CACHE_TTL_MS = 120_000;
const invoiceCache = new Map();

function invoiceCacheKey(userId, limit) {
  return `${String(userId || '')}:${Number(limit) || 24}`;
}

export async function listPaidInvoicesForUser(user, limit = 24, options = {}) {
  const userId = user?._id || user?.id || user;
  const cacheKey = invoiceCacheKey(userId, limit);
  if (!options.skipCache) {
    const cached = invoiceCache.get(cacheKey);
    if (cached && Date.now() - cached.at < INVOICE_CACHE_TTL_MS) return cached.data;
  }
  const subscription = options.subscription
    || await Subscription.findOne({ user_id: userId }).lean();
  const customerId = String(subscription?.stripe_customer_id || options.customerId || '').trim();
  if (!customerId) {
    invoiceCache.set(cacheKey, { at: Date.now(), data: [] });
    return [];
  }

  const templatePurchases = Array.isArray(options.templatePurchases)
    ? options.templatePurchases
    : [];
  const templateBySubId = new Map(
    templatePurchases
      .map((purchase) => [
        String(purchase.stripe_subscription_id || '').trim(),
        String(purchase.template_id || '').trim(),
      ])
      .filter(([subId, templateId]) => subId && templateId),
  );
  const platformSubId = String(
    options.platformSubscriptionId || subscription?.stripe_subscription_id || '',
  ).trim();

  let result;
  try {
    result = await getStripeClient().invoices.list({
      customer: customerId,
      status: 'paid',
      limit: Math.min(Math.max(Number(limit) || 24, 1), 100),
    });
  } catch (error) {
    if (!isStripeResourceMissing(error)) throw error;
    await markSubscriptionStripeStateExpired(userId);
    return [];
  }
  const invoices = result.data.map((invoice) => {
    const templateId = invoiceTemplateId(invoice, templateBySubId);
    const catalog = templateId ? getStorefrontTemplateTier(templateId) : null;
    const kind = templateId ? 'template' : 'platform';
    const product = catalog?.name
      || (kind === 'platform' ? 'Platform plan' : templateId)
      || describeInvoice(invoice);
    return {
      id: invoice.id,
      number: invoice.number || invoice.id,
      amountPaid: invoice.amount_paid,
      amount_paid: invoice.amount_paid,
      currency: invoice.currency || 'usd',
      displayAmount: formatInvoiceAmount(invoice.amount_paid, invoice.currency),
      status: invoice.status,
      kind,
      product,
      template_id: templateId || null,
      createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
      hostedInvoiceUrl: invoice.hosted_invoice_url || '',
      invoicePdf: invoice.invoice_pdf || '',
      description: catalog?.name || describeInvoice(invoice),
      prorationNote: buildProrationNote(invoice),
      billingReason: invoice.billing_reason || '',
      subscription_id: getInvoiceSubscriptionId(invoice) || platformSubId || '',
    };
  });
  invoiceCache.set(cacheKey, { at: Date.now(), data: invoices });
  return invoices;
}
