import User from '../../models/User.js';
import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import EmailDelivery from '../../models/EmailDelivery.js';
import logger from '../../utils/logger.js';
import { supportEmail } from '../../constants/support.js';
import { sendIdempotentEmail } from '../email/emailDeliveryService.js';
import { renderPaymentFailedEmail, renderPaymentRestoredEmail } from '../email/userLifecycleEmails.js';
import { getPlan } from './plans.js';
import { getClientPlan } from '../client/plans.js';
import { getInvoiceSubscriptionId, normalizeStripeId } from './subscriptionShared.js';

export const billingEmailDeps = { sendIdempotentEmail };

function usd(cents) {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function unixToDate(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/** Plan name from the local subscription row that owns this invoice (professional or client). */
async function planNameForInvoice(invoice) {
  const subscriptionId = getInvoiceSubscriptionId(invoice) || normalizeStripeId(invoice.subscription);
  if (!subscriptionId) return '';
  const [pro, client] = await Promise.all([
    Subscription.findOne({ stripe_subscription_id: subscriptionId }).select('plan_key').lean(),
    ClientSubscription.findOne({ stripe_subscription_id: subscriptionId }).select('tier').lean(),
  ]);
  if (pro?.plan_key) return getPlan(pro.plan_key)?.name || '';
  if (client?.tier) return getClientPlan(client.tier)?.name || '';
  return '';
}

async function loadRecipient(userId) {
  const user = await User.findById(userId).select('email first_name role').lean();
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email || String(user.role || '').toLowerCase() === 'admin') return null;
  return { email, first_name: user.first_name || '', role: user.role || '' };
}

const failedKey = (invoiceId) => `billing-payment-failed-${invoiceId}`;

/**
 * Payment-failed / access-locked email. One per invoice: Stripe retries and repeated
 * webhooks reuse the same delivery key, so a sent email is never repeated.
 */
export async function sendPaymentFailedEmail(userId, invoice = {}) {
  const invoiceId = String(invoice.id || '').trim();
  if (!userId || !invoiceId) return { skipped: true };
  // A first checkout that fails never unlocked anything, and a zero invoice has nothing to pay.
  if (invoice.billing_reason === 'subscription_create' || !(Number(invoice.amount_due) > 0)) return { skipped: true };
  const user = await loadRecipient(userId);
  if (!user) return { skipped: true };
  const planName = await planNameForInvoice(invoice);
  const payUrl = invoice.status === 'open' || !invoice.status ? String(invoice.hosted_invoice_url || '') : '';
  const { subject, html, text } = renderPaymentFailedEmail({
    firstName: user.first_name,
    role: user.role,
    planName,
    amount: usd(invoice.amount_due ?? invoice.amount_remaining),
    dueDate: unixToDate(invoice.due_date) || unixToDate(invoice.created),
    nextAttempt: unixToDate(invoice.next_payment_attempt),
    payUrl,
  });
  return billingEmailDeps.sendIdempotentEmail({
    email: user.email,
    subject,
    message: text,
    htmlMessage: html,
    idempotencyKey: failedKey(invoiceId),
    source: 'billing_payment_failed',
    replyTo: supportEmail(),
  });
}

/** "Payment received" email, only for an invoice that earlier triggered a payment-failed email. */
export async function sendPaymentRestoredEmail(userId, invoice = {}) {
  const invoiceId = String(invoice.id || '').trim();
  if (!userId || !invoiceId) return { skipped: true };
  const failed = await EmailDelivery.findOne({ idempotency_key: failedKey(invoiceId), status: 'sent' }).select('_id').lean();
  if (!failed) return { skipped: true };
  const user = await loadRecipient(userId);
  if (!user) return { skipped: true };
  const { subject, html, text } = renderPaymentRestoredEmail({
    firstName: user.first_name,
    role: user.role,
    planName: await planNameForInvoice(invoice),
    amount: usd(invoice.amount_paid),
  });
  return billingEmailDeps.sendIdempotentEmail({
    email: user.email,
    subject,
    message: text,
    htmlMessage: html,
    idempotencyKey: `billing-payment-restored-${invoiceId}`,
    source: 'billing_payment_restored',
    replyTo: supportEmail(),
  });
}

/** Runs a billing email without holding the webhook response; outcomes are logged. */
export function sendBillingEmailInBackground(label, run) {
  Promise.resolve()
    .then(run)
    .then((result) => {
      if (result && result.success === false && !result.inProgress) {
        logger.warn(`${label} email not sent`, { error: result.error?.message || (result.uncertain ? 'uncertain' : 'failed') });
      }
    })
    .catch((error) => logger.warn(`${label} email failed`, { error: error?.message }));
}
