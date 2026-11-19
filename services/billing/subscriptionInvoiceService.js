import Subscription from '../../models/Subscription.js';
import { getStripeClient } from './stripeClient.js';
import { markSubscriptionStripeStateExpired } from './subscriptionLocalService.js';
import {
  buildProrationBreakdown,
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
      proration: buildProrationBreakdown(invoice),
      prorationNote: buildProrationNote(invoice),
      billingReason: invoice.billing_reason || '',
      subscription_id: getInvoiceSubscriptionId(invoice) || platformSubId || '',
    };
  });
  invoiceCache.set(cacheKey, { at: Date.now(), data: invoices });
  return invoices;
}

function isOpenInvoiceWithAmountDue(invoice) {
  const status = String(invoice?.status || '').trim().toLowerCase();
  const amountDue = Number(invoice?.amount_due ?? invoice?.amount_remaining ?? 0);
  return ['open', 'uncollectible'].includes(status) && amountDue > 0;
}

function isPayableOpenInvoice(invoice) {
  return isOpenInvoiceWithAmountDue(invoice) && Boolean(invoice?.hosted_invoice_url);
}

async function invoiceWithHostedUrl(stripe, invoice) {
  if (isPayableOpenInvoice(invoice)) return invoice;
  if (!isOpenInvoiceWithAmountDue(invoice) || !invoice?.id) return null;
  const live = await stripe.invoices.retrieve(invoice.id);
  return isPayableOpenInvoice(live) ? live : null;
}

function invoiceMatchesSubscription(invoice, subscriptionId) {
  const normalizedSubscriptionId = String(subscriptionId || '').trim();
  if (!normalizedSubscriptionId) return true;
  const invoiceSubId = getInvoiceSubscriptionId(invoice);
  // Keep invoices whose subscription id is missing so a follow-up retrieve can
  // still attach the hosted invoice URL for this subscription.
  return !invoiceSubId || invoiceSubId === normalizedSubscriptionId;
}

function presentOpenInvoice(invoice) {
  return {
    id: invoice.id,
    amountDue: Number(invoice.amount_due ?? invoice.amount_remaining ?? 0),
    currency: invoice.currency || 'usd',
    displayAmountDue: formatInvoiceAmount(
      invoice.amount_due ?? invoice.amount_remaining ?? 0,
      invoice.currency,
    ),
    hostedInvoiceUrl: invoice.hosted_invoice_url || '',
    status: invoice.status || 'open',
  };
}

// Open-invoice lookups hit Stripe; the billing page reads them on every load while past due,
// so results (including "none") are reused briefly. No Customer Portal sessions are created.
const PAYMENT_ACTION_TTL_MS = 60_000;
const PAYMENT_ACTION_CACHE_MAX = 500;
const paymentActionCache = new Map();

export function clearPaymentActionCache() {
  paymentActionCache.clear();
}

export async function paymentActionForOpenInvoice({
  customerId,
  subscriptionId = '',
  latestInvoiceId = '',
  fallbackUrl = '',
  fallbackLabel = 'Choose a plan',
} = {}) {
  const key = [customerId, subscriptionId, latestInvoiceId].map((v) => String(v || '').trim()).join('|');
  const cached = paymentActionCache.get(key);
  let openInvoice;
  if (cached && Date.now() - cached.at < PAYMENT_ACTION_TTL_MS) {
    openInvoice = cached.openInvoice;
  } else {
    openInvoice = await getOpenPayableInvoiceForCustomer({ customerId, subscriptionId, latestInvoiceId });
    if (paymentActionCache.size >= PAYMENT_ACTION_CACHE_MAX) {
      paymentActionCache.delete(paymentActionCache.keys().next().value);
    }
    paymentActionCache.set(key, { at: Date.now(), openInvoice: openInvoice || null });
  }
  if (openInvoice?.hostedInvoiceUrl) {
    return {
      paymentActionUrl: openInvoice.hostedInvoiceUrl,
      paymentActionLabel: 'Pay now / Update payment method',
      openInvoice,
    };
  }
  if (fallbackUrl) {
    return { paymentActionUrl: fallbackUrl, paymentActionLabel: fallbackLabel, openInvoice: null };
  }
  return null;
}

export async function getOpenPayableInvoiceForCustomer({
  customerId,
  subscriptionId = '',
  latestInvoiceId = '',
} = {}) {
  const normalizedCustomerId = String(customerId || '').trim();
  const normalizedSubscriptionId = String(subscriptionId || '').trim();
  const normalizedLatestInvoiceId = String(latestInvoiceId || '').trim();
  if (!normalizedCustomerId && !normalizedLatestInvoiceId) return null;

  const stripe = getStripeClient();
  try {
    if (normalizedLatestInvoiceId) {
      const invoice = await stripe.invoices.retrieve(normalizedLatestInvoiceId);
      if (invoiceMatchesSubscription(invoice, normalizedSubscriptionId)) {
        const payable = await invoiceWithHostedUrl(stripe, invoice);
        if (payable) return presentOpenInvoice(payable);
      }
    }
    if (!normalizedCustomerId) return null;

    const listParams = {
      customer: normalizedCustomerId,
      status: 'open',
      limit: 10,
    };
    if (normalizedSubscriptionId) listParams.subscription = normalizedSubscriptionId;

    let invoices = [];
    try {
      const result = await stripe.invoices.list(listParams);
      invoices = result?.data || [];
    } catch (error) {
      if (normalizedSubscriptionId && !isStripeResourceMissing(error)) {
        const result = await stripe.invoices.list({
          customer: normalizedCustomerId,
          status: 'open',
          limit: 10,
        });
        invoices = result?.data || [];
      } else {
        throw error;
      }
    }

    for (const invoice of invoices) {
      if (!invoiceMatchesSubscription(invoice, normalizedSubscriptionId)) continue;
      const payable = await invoiceWithHostedUrl(stripe, invoice);
      if (payable) return presentOpenInvoice(payable);
    }
    return null;
  } catch (error) {
    if (!isStripeResourceMissing(error)) {
      console.warn('Looking up open payable invoice failed:', error?.message || error);
    }
    return null;
  }
}
