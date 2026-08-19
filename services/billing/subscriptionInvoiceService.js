import Subscription from '../../models/Subscription.js';
import { getStripeClient } from './stripeClient.js';
import { markSubscriptionStripeStateExpired } from './subscriptionLocalService.js';
import {
  buildProrationNote,
  describeInvoice,
  formatInvoiceAmount,
  isStripeResourceMissing,
} from './subscriptionShared.js';

export async function listPaidInvoicesForUser(user, limit = 24) {
  const subscription = await Subscription.findOne({ user_id: user._id }).lean();
  const customerId = String(subscription?.stripe_customer_id || '').trim();
  if (!customerId) return [];

  let result;
  try {
    result = await getStripeClient().invoices.list({
      customer: customerId,
      status: 'paid',
      limit: Math.min(Math.max(Number(limit) || 24, 1), 100),
    });
  } catch (error) {
    if (!isStripeResourceMissing(error)) throw error;
    await markSubscriptionStripeStateExpired(user._id);
    return [];
  }
  return result.data.map((invoice) => ({
    id: invoice.id,
    number: invoice.number || invoice.id,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency || 'usd',
    displayAmount: formatInvoiceAmount(invoice.amount_paid, invoice.currency),
    status: invoice.status,
    createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
    periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    hostedInvoiceUrl: invoice.hosted_invoice_url || '',
    invoicePdf: invoice.invoice_pdf || '',
    description: describeInvoice(invoice),
    prorationNote: buildProrationNote(invoice),
    billingReason: invoice.billing_reason || '',
  }));
}
