import express from 'express';
import logger from '../utils/logger.js';
import StripeWebhookEvent from '../models/StripeWebhookEvent.js';
import { getStripeClient } from '../services/billing/stripeClient.js';
import { notifyBillingStripeEvent } from '../services/billing/billingNotifications.js';
import {
  syncCheckoutSession,
  syncStripeSubscription,
  syncSubscriptionSchedule,
  updateInvoicePaymentState,
} from '../services/billing/subscriptionService.js';

const router = express.Router();

const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'subscription_schedule.created',
  'subscription_schedule.updated',
  'subscription_schedule.completed',
  'subscription_schedule.released',
  'subscription_schedule.canceled',
  'invoice.paid',
  'invoice.payment_failed',
]);

const STALE_PROCESSING_MS = 5 * 60 * 1000;

async function claimStripeEvent(event) {
  const eventId = String(event?.id || '').trim();
  if (!eventId) return { shouldProcess: true, eventId: '' };

  const existing = await StripeWebhookEvent.findOne({ event_id: eventId });
  if (existing) {
    if (existing.status === 'completed') {
      return { shouldProcess: false, eventId };
    }

    const isStaleProcessing =
      existing.status === 'processing'
      && Date.now() - new Date(existing.updatedAt).getTime() > STALE_PROCESSING_MS;

    if (existing.status === 'failed' || isStaleProcessing) {
      existing.status = 'processing';
      existing.error = '';
      existing.event_type = String(event?.type || '');
      await existing.save();
      return { shouldProcess: true, eventId };
    }

    return { shouldProcess: false, eventId };
  }

  await StripeWebhookEvent.create({
    event_id: eventId,
    event_type: String(event?.type || ''),
    status: 'processing',
  });
  return { shouldProcess: true, eventId };
}

async function finalizeStripeEvent(eventId, error) {
  if (!eventId) return;
  await StripeWebhookEvent.updateOne(
    { event_id: eventId },
    {
      $set: {
        status: error ? 'failed' : 'completed',
        error: error?.message || '',
      },
    },
  ).catch((err) => {
    logger.warn('Stripe webhook event finalize failed', {
      event_id: eventId,
      error: err?.message,
    });
  });
}

async function processStripeEvent(event) {
  let result = null;
  switch (event.type) {
    case 'checkout.session.completed':
      result = await syncCheckoutSession(event.data.object, event.id);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      result = await syncStripeSubscription(event.data.object, { last_stripe_event_id: event.id });
      break;
    case 'subscription_schedule.created':
    case 'subscription_schedule.updated':
    case 'subscription_schedule.completed':
    case 'subscription_schedule.released':
    case 'subscription_schedule.canceled':
      result = await syncSubscriptionSchedule(event.data.object, event.id);
      break;
    case 'invoice.paid':
      result = await updateInvoicePaymentState(event.data.object, 'paid', event.id);
      break;
    case 'invoice.payment_failed':
      result = await updateInvoicePaymentState(event.data.object, 'failed', event.id);
      break;
    default:
      return null;
  }

  await notifyBillingStripeEvent(event);
  return result;
}

router.post('/', async (req, res) => {
  const signature = req.get('stripe-signature');
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();

  if (!webhookSecret) {
    logger.error('Stripe webhook secret is not configured');
    return res.status(503).json({ success: false, message: 'Stripe webhook not configured' });
  }

  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed', { error: err.message });
    return res.status(400).json({ success: false, message: 'Invalid Stripe signature' });
  }

  let eventId = '';
  try {
    const claim = await claimStripeEvent(event);
    eventId = claim.eventId;
    if (!claim.shouldProcess) {
      return res.json({ received: true, duplicate: true });
    }

    if (!HANDLED_EVENT_TYPES.has(event.type)) {
      await finalizeStripeEvent(eventId, null);
      return res.json({ received: true, ignored: true });
    }

    await processStripeEvent(event);
    await finalizeStripeEvent(eventId, null);
    return res.json({ received: true });
  } catch (err) {
    await finalizeStripeEvent(eventId, err);
    logger.error('Stripe webhook processing failed', {
      event_id: event?.id,
      event_type: event?.type,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ success: false, message: 'Stripe webhook processing failed' });
  }
});

export default router;
