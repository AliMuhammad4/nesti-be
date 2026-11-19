import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import PublicProfile from '../../models/PublicProfile.js';
import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import logger from '../../utils/logger.js';
import { emitNotification } from '../realtime/workspaceSocket.js';
import { getPlan, getPlanByPriceId } from './plans.js';
import { getStorefrontTemplateTier } from './storefrontTemplatePurchases.js';
import { getInvoiceSubscriptionId, normalizeStripeId } from './subscriptionShared.js';
import { sendBillingEmailInBackground, sendPaymentFailedEmail, sendPaymentRestoredEmail } from './billingEmails.js';
import { clearPaymentActionCache } from './subscriptionInvoiceService.js';
import { chargeForPlan } from './planPrices.js';

function formatAmount(amount, currency = 'usd') {
  const value = Number(amount || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'usd').toUpperCase(),
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function invoicePricePlans(invoice = {}) {
  const lines = invoice.lines?.data || [];
  const plans = [];
  for (const line of lines) {
    const priceId =
      normalizeStripeId(line.price) ||
      String(line.pricing?.price_details?.price || '').trim();
    const plan = getPlanByPriceId(priceId) || getPlan(line.metadata?.plan_key);
    if (plan && !plans.some((p) => p.plan_key === plan.plan_key)) {
      plans.push(plan);
    }
  }
  return plans;
}

function invoiceMetadataSources(invoice = {}) {
  return [
    invoice.metadata,
    invoice.subscription_details?.metadata,
    invoice.parent?.subscription_details?.metadata,
    ...(invoice.lines?.data || []).map((line) => line.metadata),
    ...(invoice.lines?.data || []).map((line) => line.parent?.subscription_item_details?.metadata),
  ].filter(Boolean);
}

function invoicePlanName(invoice = {}) {
  const priced = invoicePricePlans(invoice).at(-1)?.name;
  if (priced) return priced;
  for (const source of invoiceMetadataSources(invoice)) {
    const plan = getPlan(source.plan_key);
    if (plan?.name) return plan.name;
  }
  const description = (invoice.lines?.data || []).map((line) => String(line.description || '')).join(' ');
  const named = description.match(/Nesti\s+(Basic|Standard|Enterprise)/i);
  if (named) return named[1].charAt(0).toUpperCase() + named[1].slice(1).toLowerCase();
  return 'subscription';
}

function invoiceIsAnnual(invoice = {}) {
  const period = invoiceMetadataSources(invoice)
    .map((source) => String(source.billing_period || '').toLowerCase())
    .find(Boolean);
  if (period === 'year' || period === 'annual' || period === 'yearly') return true;
  const description = (invoice.lines?.data || []).map((line) => String(line.description || '')).join(' ');
  if (/\/\s*year/i.test(description)) return true;
  return (invoice.lines?.data || []).some((line) => {
    const interval = String(
      line.price?.recurring?.interval
      || line.pricing?.price_details?.recurring?.interval
      || '',
    ).toLowerCase();
    return interval === 'year';
  });
}

function isStorefrontTemplateMetadata(source = {}) {
  return (
    String(source.purchase_type || '').trim() === 'storefront_template'
    || String(source.subscription_type || '').trim() === 'storefront_template'
  );
}

function invoiceStorefrontTemplatePurchase(invoice = {}) {
  const sources = [
    invoice.metadata,
    invoice.subscription_details?.metadata,
    invoice.parent?.subscription_details?.metadata,
    invoice.parent?.quote_details?.metadata,
    ...(invoice.lines?.data || []).map((line) => line.metadata),
    ...(invoice.lines?.data || []).map((line) => line.parent?.subscription_item_details?.metadata),
  ].filter(Boolean);

  const metadata = sources.find((source) => (
    isStorefrontTemplateMetadata(source)
    && String(source.template_id || '').trim()
  ));
  if (!metadata) return null;

  const template = getStorefrontTemplateTier(metadata.template_id);
  return {
    template_id: String(metadata.template_id || '').trim(),
    tier: String(metadata.tier || template?.tier || '').trim(),
    name: template?.name || 'Storefront template',
  };
}

async function findUserIdForStripeObject(object = {}) {
  const metadataUserId = String(object.metadata?.user_id || '').trim();
  if (metadataUserId) return metadataUserId;

  const subscriptionId = getInvoiceSubscriptionId(object)
    || normalizeStripeId(object.subscription || object.id);
  if (subscriptionId) {
    const [proSub, clientSub, templateProfile] = await Promise.all([
      Subscription.findOne({ stripe_subscription_id: subscriptionId }).select('user_id').lean(),
      ClientSubscription.findOne({ stripe_subscription_id: subscriptionId }).select('user_id').lean(),
      PublicProfile.findOne({
        'storefront.template_purchases.stripe_subscription_id': subscriptionId,
      }).select('user_id').lean(),
    ]);
    if (proSub?.user_id) return String(proSub.user_id);
    if (clientSub?.user_id) return String(clientSub.user_id);
    if (templateProfile?.user_id) return String(templateProfile.user_id);
  }

  const customerId = normalizeStripeId(object.customer);
  if (customerId) {
    const [proSub, clientSub] = await Promise.all([
      Subscription.findOne({ stripe_customer_id: customerId }).select('user_id').lean(),
      ClientSubscription.findOne({ stripe_customer_id: customerId }).select('user_id').lean(),
    ]);
    if (proSub?.user_id) return String(proSub.user_id);
    if (clientSub?.user_id) return String(clientSub.user_id);
  }

  return '';
}

async function persistAndEmit(userId, eventId, payload) {
  if (!userId || !eventId) return null;

  const exists = await ProfessionalNotification.findOne({
    user_id: userId,
    'action.stripe_event_id': eventId,
  }).select('_id').lean();
  if (exists?._id) return null;

  const doc = await ProfessionalNotification.create({
    user_id: userId,
    notification_type: payload.notification_type,
    title: payload.title,
    body: payload.body,
    severity: payload.severity || 'info',
    action: {
      type: 'open_billing',
      href: '/checkout',
      stripe_event_id: eventId,
      ...(payload.action || {}),
    },
  });

  emitNotification(userId, {
    notification_id: String(doc._id),
    notification_type: payload.notification_type,
    title: payload.title,
    body: payload.body,
    severity: payload.severity || 'info',
    action: doc.action,
  });

  return doc;
}

function invoiceHasProration(invoice = {}) {
  return (invoice.lines?.data || []).some((line) => (
    line.proration === true
    || line.parent?.subscription_item_details?.proration === true
    || line.parent?.invoice_item_details?.proration === true
  ));
}

function formatShortDate(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function invoiceTrialEnd(invoice = {}) {
  const ends = (invoice.lines?.data || [])
    .map((line) => Number(line.period?.end || 0))
    .filter((n) => n > 0);
  const unix = ends.length ? Math.max(...ends) : Number(invoice.period_end || 0);
  return unix ? new Date(unix * 1000) : null;
}
async function trialFirstCharge(invoice = {}) {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  const local = subscriptionId
    ? await Subscription.findOne({ stripe_subscription_id: subscriptionId })
      .select('plan_key billing_period trial_end').lean()
    : null;
  const plan = getPlan(local?.plan_key) || invoicePricePlans(invoice).at(-1) || null;
  const period = local?.billing_period || (invoiceIsAnnual(invoice) ? 'year' : 'month');
  const charge = plan ? chargeForPlan(plan, period) : null;
  const endsAt = local?.trial_end ? new Date(local.trial_end) : invoiceTrialEnd(invoice);
  return {
    planName: plan?.name || invoicePlanName(invoice),
    amountLabel: charge && Number.isFinite(charge.amount) && charge.amount > 0
      ? `${formatAmount(charge.amount, charge.currency)}${charge.billingPeriod === 'year' ? '/year' : '/month'}`
      : '',
    dateLabel: formatShortDate(endsAt),
  };
}

async function notifyZeroAmountInvoice(event, userId, invoice) {
  const reason = String(invoice.billing_reason || '');
  if (reason !== 'subscription_create' && reason !== 'subscription_update') return null;
  const { planName, amountLabel, dateLabel } = await trialFirstCharge(invoice);
  const firstCharge = amountLabel && dateLabel
    ? ` Your first charge of ${amountLabel} is on ${dateLabel}.`
    : dateLabel
      ? ` Your first charge is on ${dateLabel}.`
      : '';
  const cancelNote = ' Cancel before then and you will not be charged.';
  const isCreate = reason === 'subscription_create';
  return persistAndEmit(userId, event.id, {
    notification_type: isCreate ? 'billing_trial_started' : 'billing_trial_plan_changed',
    title: isCreate ? 'Free trial started' : 'Plan changed during free trial',
    body: isCreate
      ? `Your ${planName} plan is in its free trial.${firstCharge}${firstCharge ? cancelNote : ''}`
      : `You switched to ${planName}. Your free trial continues.${firstCharge}`,
    severity: 'info',
    action: {
      href: '/settings?tab=subscription',
      invoice_id: invoice.id,
    },
  });
}

async function notifyInvoicePaid(event) {
  const invoice = event.data.object;
  const userId = await findUserIdForStripeObject(invoice);
  if (!userId) return null;

  const amount = formatAmount(invoice.amount_paid, invoice.currency);
  const templatePurchase = invoiceStorefrontTemplatePurchase(invoice);
  if (templatePurchase) {
    return persistAndEmit(userId, event.id, {
      notification_type: 'storefront_template_payment_paid',
      title: 'Template subscription active',
      body: `${templatePurchase.name} is active for ${amount}/month. You can publish with it while subscribed.`,
      severity: 'info',
      action: {
        type: 'open_storefront_builder',
        href: '/dashboard/public-profile',
        invoice_id: invoice.id,
        hosted_invoice_url: invoice.hosted_invoice_url || '',
        template_id: templatePurchase.template_id,
      },
    });
  }

  if (Number(invoice.amount_paid || 0) <= 0) {
    return notifyZeroAmountInvoice(event, userId, invoice);
  }

  sendBillingEmailInBackground('Payment restored', () => sendPaymentRestoredEmail(userId, invoice));

  const reason = String(invoice.billing_reason || '');
  const planName = invoicePlanName(invoice);
  const periodLabel = invoiceIsAnnual(invoice) ? ' for the year' : '';

  let title = 'Payment paid';
  let body = `Your ${planName} payment of ${amount}${periodLabel} was paid.`;

  if (reason === 'subscription_create') {
    title = 'Subscription started';
    body = `Your ${planName} subscription is active. Amount paid: ${amount}${periodLabel}.`;
  } else if (reason === 'subscription_cycle') {
    title = 'Subscription renewed';
    body = `Your ${planName} subscription renewed successfully. Amount paid: ${amount}${periodLabel}.`;
  } else if (reason === 'subscription_update' && !invoiceHasProration(invoice)) {
    title = 'Subscription started';
    body = `Payment received: ${amount}${periodLabel} for ${planName}. Your subscription is active.`;
  } else if (reason === 'subscription_update') {
    title = 'Plan change payment paid';
    body = `Your plan change payment of ${amount}${periodLabel} was paid.`;
  }

  return persistAndEmit(userId, event.id, {
    notification_type: 'billing_payment_paid',
    title,
    body,
    severity: 'info',
    action: {
      invoice_id: invoice.id,
      hosted_invoice_url: invoice.hosted_invoice_url || '',
    },
  });
}

async function notifyInvoicePaymentFailed(event) {
  const invoice = event.data.object;
  const userId = await findUserIdForStripeObject(invoice);
  if (!userId) return null;

  const amount = formatAmount(invoice.amount_due || invoice.amount_remaining, invoice.currency);
  const templatePurchase = invoiceStorefrontTemplatePurchase(invoice);
  if (templatePurchase) {
    return persistAndEmit(userId, event.id, {
      notification_type: 'storefront_template_payment_failed',
      title: 'Template subscription payment failed',
      body: `We could not renew ${templatePurchase.name}. Update billing to keep this template unlocked.`,
      severity: 'critical',
      action: {
        type: 'open_storefront_builder',
        href: '/dashboard/public-profile',
        invoice_id: invoice.id,
        hosted_invoice_url: invoice.hosted_invoice_url || '',
        template_id: templatePurchase.template_id,
      },
    });
  }

  sendBillingEmailInBackground('Payment failed', () => sendPaymentFailedEmail(userId, invoice));

  return persistAndEmit(userId, event.id, {
    notification_type: 'billing_payment_failed',
    title: 'Payment failed',
    body: `We could not collect your subscription payment of ${amount}. Please update your billing details to keep access active.`,
    severity: 'critical',
    action: {
      invoice_id: invoice.id,
      hosted_invoice_url: invoice.hosted_invoice_url || '',
    },
  });
}

async function notifySubscriptionUpdated(event) {
  const stripeSubscription = event.data.object;
  const previous = event.data.previous_attributes || {};
  const userId = await findUserIdForStripeObject(stripeSubscription);
  if (!userId) return null;

  if (isStorefrontTemplateMetadata(stripeSubscription?.metadata)) return null;

  if (
    Object.prototype.hasOwnProperty.call(previous, 'cancel_at_period_end') &&
    stripeSubscription.cancel_at_period_end === true
  ) {
    return persistAndEmit(userId, event.id, {
      notification_type: 'billing_subscription_cancel_scheduled',
      title: 'Subscription cancellation scheduled',
      body: 'Your subscription will remain active until the end of the current billing period, then it will cancel.',
      severity: 'high',
      action: { subscription_id: stripeSubscription.id },
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(previous, 'cancel_at_period_end') &&
    stripeSubscription.cancel_at_period_end === false
  ) {
    return persistAndEmit(userId, event.id, {
      notification_type: 'billing_subscription_resumed',
      title: 'Subscription resumed',
      body: 'Your subscription will continue renewing automatically.',
      severity: 'info',
      action: { subscription_id: stripeSubscription.id },
    });
  }

  return null;
}

async function notifySubscriptionSchedule(event) {
  const schedule = event.data.object;
  const userId = await findUserIdForStripeObject(schedule);
  if (!userId) return null;

  if (event.type === 'subscription_schedule.updated') {
    const pendingPlanKey = String(schedule.metadata?.pending_plan_key || '').trim();
    const pendingPlanName = pendingPlanKey
      ? pendingPlanKey.charAt(0).toUpperCase() + pendingPlanKey.slice(1)
      : 'the selected plan';
    return persistAndEmit(userId, event.id, {
      notification_type: 'billing_downgrade_scheduled',
      title: 'Downgrade scheduled',
      body: `${pendingPlanName} will start on your next renewal date. Your current plan remains active until then.`,
      severity: 'info',
      action: {
        schedule_id: schedule.id,
        pending_plan_key: pendingPlanKey,
      },
    });
  }

  if (event.type === 'subscription_schedule.completed') {
    return persistAndEmit(userId, event.id, {
      notification_type: 'billing_scheduled_plan_applied',
      title: 'Scheduled plan change applied',
      body: 'Your scheduled subscription plan change has been applied.',
      severity: 'info',
      action: { schedule_id: schedule.id },
    });
  }

  return null;
}

export async function notifyBillingStripeEvent(event) {
  if (String(event?.type || '').startsWith('invoice.')) clearPaymentActionCache();
  try {
    switch (event.type) {
      case 'invoice.paid':
        return notifyInvoicePaid(event);
      case 'invoice.payment_failed':
        return notifyInvoicePaymentFailed(event);
      case 'customer.subscription.updated':
        return notifySubscriptionUpdated(event);
      case 'subscription_schedule.updated':
      case 'subscription_schedule.completed':
        return notifySubscriptionSchedule(event);
      default:
        return null;
    }
  } catch (err) {
    logger.warn('Billing notification failed', {
      event_id: event?.id,
      event_type: event?.type,
      error: err?.message,
    });
    return null;
  }
}
