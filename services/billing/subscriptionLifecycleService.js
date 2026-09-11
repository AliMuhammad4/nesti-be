import Subscription from '../../models/Subscription.js';
import { getPlan, getPlanTier, getStripePriceId } from './plans.js';
import { getStripeClient } from './stripeClient.js';
import { ensureStripeCustomerForUser } from './subscriptionCustomerService.js';
import { markSubscriptionStripeStateExpired } from './subscriptionLocalService.js';
import { getFreshSubscriptionForUser } from './subscriptionReadService.js';
import {
  clearPendingScheduleIfAny,
  getOrCreateSubscriptionSchedule,
  voidOrDeleteUnpaidInvoice,
} from './subscriptionScheduleService.js';
import { syncStripeSubscription } from './subscriptionStripeSyncService.js';
import {
  accountStatusFromSubscription,
  buildScheduleItemsFromSubscription,
  buildSinglePriceScheduleItem,
  formatInvoiceAmount,
  getStripeSubscriptionPeriodEnd,
  getStripeSubscriptionPeriodStart,
  invoiceRequiresPayment,
  isStripeResourceMissing,
  isSubscriptionPeriodEnded,
  normalizeStripeId,
  stripeTimestampFromDate,
  toIsoDate,
  userHasActiveSubscriptionAccess,
} from './subscriptionShared.js';

export async function cancelSubscriptionForUser(user, cancellationReason = '') {
  const reason = String(cancellationReason || '').trim();
  const subscription = await Subscription.findOne({ user_id: user._id });
  if (!subscription?.stripe_subscription_id) {
    return { ok: false, code: 404, message: 'No active Stripe subscription found.' };
  }
  const stripe = getStripeClient();
  let stripeSubscription;
  try {
    stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      const cleared = await markSubscriptionStripeStateExpired(user._id);
      return {
        ok: false,
        code: 409,
        message: 'The previous Stripe subscription no longer exists for the current Stripe account. The local subscription state has been reset; please subscribe again.',
        subscription: cleared,
      };
    }
    throw error;
  }
  const attachedScheduleId = normalizeStripeId(stripeSubscription.schedule);
  if (subscription.stripe_subscription_schedule_id || attachedScheduleId) {
    await clearPendingScheduleIfAny(stripe, subscription, attachedScheduleId);
  }
  const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    cancel_at_period_end: true,
    metadata: {
      ...(stripeSubscription.metadata || {}),
      cancellation_reason: reason.slice(0, 500),
      cancellation_requested_at: new Date().toISOString(),
    },
  });
  let synced = await syncStripeSubscription(updated, { clearPendingPlan: true });
  synced = await Subscription.findOneAndUpdate(
    { user_id: user._id },
    {
      $set: {
        'metadata.cancellation_reason': reason,
        'metadata.cancellation_requested_at': new Date(),
      },
    },
    { returnDocument: 'after' },
  );
  return { ok: true, subscription: synced };
}

export async function resumeSubscriptionForUser(user) {
  const subscription = await getFreshSubscriptionForUser(user);
  if (!subscription?.stripe_subscription_id) {
    return {
      ok: false,
      code: 404,
      message: 'No Stripe subscription found. Please subscribe again to restore access.',
      subscription,
    };
  }
  if (accountStatusFromSubscription(subscription) === 'expired' || isSubscriptionPeriodEnded(subscription)) {
    return {
      ok: false,
      code: 409,
      message: 'Your subscription period has ended. Please subscribe again to restore access.',
      subscription,
    };
  }
  if (!subscription.cancel_at_period_end) {
    return { ok: false, code: 400, message: 'Subscription is not scheduled to cancel.' };
  }

  let updated;
  try {
    updated = await getStripeClient().subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: false,
    });
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      const cleared = await markSubscriptionStripeStateExpired(user._id);
      return {
        ok: false,
        code: 409,
        message: 'The previous Stripe subscription no longer exists. Please subscribe again to restore access.',
        subscription: cleared,
      };
    }
    const stripeMessage = String(error?.raw?.message || error?.message || '').toLowerCase();
    if (
      stripeMessage.includes('canceled')
      || stripeMessage.includes('cancelled')
      || String(error?.code || '') === 'resource_missing'
    ) {
      const cleared = await markSubscriptionStripeStateExpired(user._id);
      return {
        ok: false,
        code: 409,
        message: 'Your subscription has already ended. Please subscribe again to restore access.',
        subscription: cleared,
      };
    }
    throw error;
  }
  return { ok: true, subscription: await syncStripeSubscription(updated) };
}

export async function changeSubscriptionPlanForUser(user, planKey) {
  const plan = getPlan(planKey);
  if (!plan) return { ok: false, code: 400, message: 'Invalid subscription plan.' };
  const priceId = getStripePriceId(plan.plan_key);
  if (!priceId) {
    return { ok: false, code: 503, message: `${plan.name} Stripe price is not configured.` };
  }

  const subscription = await getFreshSubscriptionForUser(user);
  if (!userHasActiveSubscriptionAccess(subscription)) {
    return {
      ok: false,
      code: 409,
      message: 'No active subscription to change. Subscribe to a plan first.',
    };
  }
  if (!subscription?.stripe_subscription_id) {
    return { ok: false, code: 404, message: 'No Stripe subscription found for this account.' };
  }
  const currentPlanKey = String(subscription.plan_key || '').trim().toLowerCase();
  if (currentPlanKey === plan.plan_key) {
    return { ok: false, code: 400, message: 'You are already on this plan.' };
  }
  const currentTier = getPlanTier(currentPlanKey);
  const targetTier = getPlanTier(plan.plan_key);
  if (!currentTier || !targetTier) {
    return { ok: false, code: 400, message: 'Unable to compare subscription plans.' };
  }

  const stripe = getStripeClient();
  let stripeSubscription;
  try {
    stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id, {
      expand: ['latest_invoice'],
    });
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      const cleared = await markSubscriptionStripeStateExpired(user._id);
      return {
        ok: false,
        code: 409,
        message: 'The previous Stripe subscription no longer exists for the current Stripe account. The local subscription state has been reset; please subscribe again.',
        subscription: cleared,
      };
    }
    throw error;
  }
  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) {
    return { ok: false, code: 500, message: 'Unable to read subscription items from Stripe.' };
  }
  await ensureStripeCustomerForUser(user, subscription, { planKey: plan.plan_key });

  if (targetTier > currentTier) {
    await clearPendingScheduleIfAny(
      stripe,
      subscription,
      normalizeStripeId(stripeSubscription.schedule),
    );
    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{ id: subscriptionItemId, price: priceId }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
      expand: ['latest_invoice'],
      metadata: {
        user_id: String(user._id),
        plan_key: plan.plan_key,
      },
    });
    const invoice = updated.latest_invoice && typeof updated.latest_invoice === 'object'
      ? updated.latest_invoice
      : null;
    const synced = await syncStripeSubscription(updated, {
      user_id: String(user._id),
      plan_key: plan.plan_key,
      clearPendingPlan: true,
    });
    return {
      ok: true,
      changeType: 'upgrade',
      subscription: synced,
      planName: plan.name,
      invoice: invoice
        ? {
            id: invoice.id,
            status: invoice.status,
            hostedInvoiceUrl: invoice.hosted_invoice_url || '',
            invoicePdf: invoice.invoice_pdf || '',
            amountDue: invoice.amount_due,
            amountPaid: invoice.amount_paid,
            displayAmountDue: formatInvoiceAmount(invoice.amount_due, invoice.currency),
          }
        : null,
    };
  }

  const latestInvoice = stripeSubscription.latest_invoice
    && typeof stripeSubscription.latest_invoice === 'object'
    ? stripeSubscription.latest_invoice
    : null;
  if (
    invoiceRequiresPayment(latestInvoice)
    && String(latestInvoice.billing_reason || '') === 'subscription_update'
  ) {
    await clearPendingScheduleIfAny(
      stripe,
      subscription,
      normalizeStripeId(stripeSubscription.schedule),
    );
    await voidOrDeleteUnpaidInvoice(stripe, latestInvoice);
    const restored = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: false,
      items: [{ id: subscriptionItemId, price: priceId }],
      proration_behavior: 'none',
      payment_behavior: 'allow_incomplete',
      expand: ['latest_invoice'],
      metadata: {
        user_id: String(user._id),
        plan_key: plan.plan_key,
      },
    });
    const synced = await syncStripeSubscription(restored, {
      user_id: String(user._id),
      clearPendingPlan: true,
    });
    return {
      ok: true,
      changeType: 'revert_unpaid_upgrade',
      subscription: synced,
      planName: plan.name,
    };
  }

  const currentPeriodStart = getStripeSubscriptionPeriodStart(stripeSubscription);
  const currentPeriodEnd = getStripeSubscriptionPeriodEnd(stripeSubscription);
  const currentPeriodStartTs = stripeTimestampFromDate(currentPeriodStart);
  const currentPeriodEndTs = stripeTimestampFromDate(currentPeriodEnd);
  if (!currentPeriodEndTs) {
    return { ok: false, code: 500, message: 'Unable to read current billing period from Stripe.' };
  }
  const currentItems = buildScheduleItemsFromSubscription(stripeSubscription);
  if (!currentItems.length) {
    return { ok: false, code: 500, message: 'Unable to read current subscription items from Stripe.' };
  }
  const schedule = await getOrCreateSubscriptionSchedule(
    stripe,
    stripeSubscription,
    subscription.stripe_subscription_schedule_id,
  );
  const activePhase = schedule.phases?.find((phase) => {
    const startsAt = Number(phase.start_date || 0);
    const endsAt = Number(phase.end_date || 0);
    const now = Math.floor(Date.now() / 1000);
    return startsAt <= now && (!endsAt || endsAt >= now);
  }) || schedule.phases?.[0];
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    metadata: {
      user_id: String(user._id),
      pending_plan_key: plan.plan_key,
    },
    phases: [
      {
        items: currentItems,
        start_date: activePhase?.start_date || currentPeriodStartTs || 'now',
        end_date: currentPeriodEndTs,
        proration_behavior: 'none',
        metadata: {
          user_id: String(user._id),
          plan_key: currentPlanKey,
        },
      },
      {
        items: buildSinglePriceScheduleItem(priceId),
        proration_behavior: 'none',
        metadata: {
          user_id: String(user._id),
          plan_key: plan.plan_key,
        },
      },
    ],
  });
  const synced = await Subscription.findOneAndUpdate(
    { _id: subscription._id },
    {
      $set: {
        pending_plan_key: plan.plan_key,
        pending_plan_effective_at: currentPeriodEnd,
        stripe_subscription_schedule_id: schedule.id,
        cancel_at_period_end: false,
        last_synced_at: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
  return {
    ok: true,
    changeType: 'downgrade',
    subscription: synced,
    planName: plan.name,
    effectiveAt: toIsoDate(currentPeriodEnd),
  };
}
