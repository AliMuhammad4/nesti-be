import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import Subscription from '../../models/Subscription.js';
import logger from '../../utils/logger.js';
import { emitNotification } from '../realtime/workspaceSocket.js';
import { getPlanByPriceId } from './plans.js';

function normalizeStripeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.id || '');
}

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
    const plan = getPlanByPriceId(priceId);
    if (plan && !plans.some((p) => p.plan_key === plan.plan_key)) {
      plans.push(plan);
    }
  }
  return plans;
}

async function findUserIdForStripeObject(object = {}) {
  const metadataUserId = String(object.metadata?.user_id || '').trim();
  if (metadataUserId) return metadataUserId;

  const subscriptionId = normalizeStripeId(object.subscription || object.id);
  if (subscriptionId) {
    const sub = await Subscription.findOne({ stripe_subscription_id: subscriptionId })
      .select('user_id')
      .lean();
    if (sub?.user_id) return String(sub.user_id);
  }

  const customerId = normalizeStripeId(object.customer);
  if (customerId) {
    const sub = await Subscription.findOne({ stripe_customer_id: customerId })
      .select('user_id')
      .lean();
    if (sub?.user_id) return String(sub.user_id);
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

async function notifyInvoicePaid(event) {
  const invoice = event.data.object;
  const userId = await findUserIdForStripeObject(invoice);
  if (!userId) return null;

  const amount = formatAmount(invoice.amount_paid, invoice.currency);
  const reason = String(invoice.billing_reason || '');
  const plans = invoicePricePlans(invoice);
  const planName = plans.at(-1)?.name || 'subscription';

  let title = 'Payment received';
  let body = `Your ${planName} payment of ${amount} was received.`;

  if (reason === 'subscription_create') {
    title = 'Subscription started';
    body = `Your ${planName} subscription is active. Payment received: ${amount}.`;
  } else if (reason === 'subscription_cycle') {
    title = 'Subscription renewed';
    body = `Your ${planName} subscription renewed successfully. Payment received: ${amount}.`;
  } else if (reason === 'subscription_update') {
    title = 'Plan change payment received';
    body = `Your plan change payment of ${amount} was received.`;
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
