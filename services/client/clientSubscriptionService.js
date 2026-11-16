import ClientSubscription from '../../models/ClientSubscription.js';
import User from '../../models/User.js';
import {
  canonicalClientTier,
  getClientPlan,
  isSameClientTier,
} from './plans.js';
import { getStripeClient } from '../billing/stripeClient.js';
import {
  buildCheckoutIdempotencyKey,
  cancelIncompleteStripeSubscriptions,
  deduplicateNewCheckoutSession,
  expireLeftoverOpenCheckoutSessions,
} from '../billing/subscriptionShared.js';
import { getOpenPayableInvoiceForCustomer } from '../billing/subscriptionInvoiceService.js';
import { chargeForPlan, createRecurringPrice, normalizeBillingPeriod, recurringPriceData } from '../billing/planPrices.js';
import {
  BLOCKING_CLIENT_CHECKOUT_STATUSES,
  CLEANABLE_CLIENT_STRIPE_STATUSES,
  appendPlanChange,
  buildClientCheckoutMetadata,
  buildClientStripeSyncUpdate,
  buildScheduleItemsFromSubscription,
  buildSinglePriceScheduleItem,
  clientHttpError,
  clientSubscriptionEndedError,
  getClientFrontendOrigin,
  getClientTierRank,
  getStripeSubscriptionPeriodEnd,
  getStripeSubscriptionPeriodStart,
  hasOpenClientCheckoutConflict,
  invoiceRequiresPayment,
  isClientPeriodEnded,
  isClientStripeSubscription,
  isClientSubscriptionActive,
  isClientSubscriptionAlreadyEnded,
  isStripeSubscriptionMissing,
  normalizeStripeId,
  openClientSubscriptionConflictError,
  presentChangeInvoice,
  presentClientSubscription,
  presentPaidClientInvoice,
  shouldApplyIncomingClientStripeSubscription,
  stripeTimestampFromDate,
  toIsoDate,
} from './clientSubscriptionHelpers.js';

export {
  BLOCKING_CLIENT_CHECKOUT_STATUSES,
  CLEANABLE_CLIENT_STRIPE_STATUSES,
  CLIENT_PAST_DUE_GRACE_MS,
  CLIENT_PERIOD_END_GRACE_MS,
  LIVE_CLIENT_STRIPE_STATUSES,
  TERMINAL_CLIENT_STRIPE_STATUSES,
  getClientAccessState,
  getClientFrontendOrigin,
  getClientPastDueGraceEndsAt,
  getClientPaymentMessage,
  isClientPastDueWithinGrace,
  isClientSubscriptionActive,
  presentClientSubscription,
  shouldApplyIncomingClientStripeSubscription,
  shouldRefreshClientSubscriptionFromStripe,
} from './clientSubscriptionHelpers.js';

async function voidOrDeleteUnpaidInvoice(stripe, invoice) {
  if (!invoiceRequiresPayment(invoice)) return;

  const status = String(invoice.status || '').toLowerCase();
  if (status === 'draft') {
    await stripe.invoices.del(invoice.id);
    return;
  }

  await stripe.invoices.voidInvoice(invoice.id);
}

async function clearClientPendingScheduleIfAny(stripe, subscription, attachedScheduleId = '') {
  const scheduleId = String(subscription?.stripe_subscription_schedule_id || attachedScheduleId || '').trim();
  if (!scheduleId) return;

  try {
    await stripe.subscriptionSchedules.release(scheduleId);
  } catch (err) {
    if (err?.code !== 'resource_missing') throw err;
  }

  await ClientSubscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        pending_tier: '',
        pending_tier_effective_at: null,
        stripe_subscription_schedule_id: '',
      },
    },
  );
}

async function getOrCreateClientSubscriptionSchedule(stripe, stripeSubscription, existingScheduleId = '') {
  const scheduleId = String(existingScheduleId || normalizeStripeId(stripeSubscription.schedule)).trim();
  if (scheduleId) {
    try {
      return await stripe.subscriptionSchedules.retrieve(scheduleId);
    } catch (err) {
      if (err?.code !== 'resource_missing') throw err;
    }
  }

  return stripe.subscriptionSchedules.create({
    from_subscription: stripeSubscription.id,
  });
}

async function priceForClientPlan(stripe, plan, billingPeriod) {
  const charge = chargeForPlan(plan, billingPeriod);
  const price = await createRecurringPrice(stripe, {
    name: `Nesti ${plan.name}`,
    amount: charge.amount,
    currency: charge.currency,
    interval: charge.interval,
    metadata: {
      subscription_type: 'client',
      tier: plan.tier,
      billing_period: charge.billingPeriod,
    },
  });
  return { price, charge };
}

async function listClientStripeSubscriptions(stripe, customerId) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId) return [];
  const result = await stripe.subscriptions.list({
    customer: normalizedCustomerId,
    status: 'all',
    limit: 20,
  });
  return (result.data || []).filter(isClientStripeSubscription);
}

async function listBlockingClientStripeSubscriptions(stripe, customerId) {
  const subscriptions = await listClientStripeSubscriptions(stripe, customerId);
  return subscriptions.filter((sub) => (
    BLOCKING_CLIENT_CHECKOUT_STATUSES.has(String(sub.status || '').trim().toLowerCase())
  ));
}

export async function assertClientCanStartCheckout(existingSubscription, stripe, customerId) {
  const cancelledSubscriptionIds = (stripe && customerId)
    ? await cancelIncompleteStripeSubscriptions(stripe, customerId, isClientStripeSubscription)
    : [];

  if (existingSubscription) {
    await expireCanceledClientSubscriptionIfNeeded(existingSubscription);
    const status = String(existingSubscription.status || '').trim().toLowerCase();
    const skipLocalIncomplete = status === 'incomplete' && Boolean(stripe && customerId);
    if (!skipLocalIncomplete && hasOpenClientCheckoutConflict(existingSubscription)) {
      throw openClientSubscriptionConflictError(existingSubscription.status);
    }
  }

  if (!stripe || !customerId) return cancelledSubscriptionIds;
  const blocking = await listBlockingClientStripeSubscriptions(stripe, customerId);
  if (blocking.length) {
    throw openClientSubscriptionConflictError(blocking[0]?.status);
  }
  return cancelledSubscriptionIds;
}

export async function createClientCheckoutSession(userId, tier, billingPeriod) {
  const plan = getClientPlan(tier);
  if (!plan) {
    throw clientHttpError(`Invalid client tier: ${tier}`, 400, 'INVALID_CLIENT_TIER');
  }
  const period = normalizeBillingPeriod(billingPeriod);

  const user = await User.findById(userId);
  if (!user) {
    throw clientHttpError('User not found', 404, 'USER_NOT_FOUND');
  }

  const existingSubscription = await ClientSubscription.findOne({ user_id: userId });

  const stripe = getStripeClient();
  const charge = chargeForPlan(plan, period);

  let customerId = existingSubscription?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: {
        user_id: String(userId),
        subscription_type: 'client',
      },
    });
    customerId = customer.id;
  }

  const frontendOrigin = getClientFrontendOrigin();
  const metadata = buildClientCheckoutMetadata(userId, plan, charge);
  const checkoutOptions = {
    userId: String(userId),
    subscriptionType: 'client',
    planKey: plan.tier,
    billingPeriod: charge.billingPeriod,
  };
  const reusableSession = await expireLeftoverOpenCheckoutSessions(stripe, customerId, checkoutOptions);
  if (reusableSession?.url) {
    return {
      sessionId: reusableSession.id,
      sessionUrl: reusableSession.url,
    };
  }

  const cancelledSubscriptionIds = await assertClientCanStartCheckout(
    existingSubscription,
    stripe,
    customerId,
  );

  const openedWhileCancelling = await expireLeftoverOpenCheckoutSessions(stripe, customerId, checkoutOptions);
  if (openedWhileCancelling?.url) {
    return {
      sessionId: openedWhileCancelling.id,
      sessionUrl: openedWhileCancelling.url,
    };
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: recurringPriceData({
          name: `Nesti ${plan.name}`,
          amount: charge.amount,
          currency: charge.currency,
          interval: charge.interval,
          description: charge.billingPeriod === 'year' ? 'Billed once a year' : 'Billed monthly',
        }),
        quantity: 1,
      },
    ],
    success_url: `${frontendOrigin}/client-dashboard/subscription?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendOrigin}/client-dashboard/subscription?billing=cancelled`,
    metadata,
    subscription_data: {
      metadata,
    },
  }, {
    idempotencyKey: buildCheckoutIdempotencyKey({
      kind: 'client-checkout',
      userId,
      planKey: plan.tier,
      billingPeriod: charge.billingPeriod,
      leftoverSubscriptionIds: cancelledSubscriptionIds,
    }),
  });

  const deduped = await deduplicateNewCheckoutSession(stripe, customerId, session, checkoutOptions);
  return {
    sessionId: deduped.id,
    sessionUrl: deduped.url,
  };
}

export async function expireCanceledClientSubscriptionIfNeeded(subscription) {
  if (!subscription) return subscription;

  const status = String(subscription.status || '').trim().toLowerCase();
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const periodEnded = isClientPeriodEnded(subscription);
  const terminalStatus = status === 'canceled' || status === 'cancelled' || status === 'incomplete_expired';
  const shouldExpire =
    terminalStatus ||
    (cancelAtPeriodEnd && periodEnded && ['active', 'trialing', 'past_due'].includes(status));

  if (!shouldExpire) return subscription;

  if (status === 'canceled') {
    if (subscription.cancel_at_period_end) {
      subscription.cancel_at_period_end = false;
      if (typeof subscription.save === 'function') {
        await subscription.save();
      } else {
        await ClientSubscription.updateOne(
          { _id: subscription._id },
          { $set: { cancel_at_period_end: false } },
        );
      }
    }
    return subscription;
  }

  subscription.status = 'canceled';
  subscription.cancel_at_period_end = false;
  if (typeof subscription.save === 'function') {
    await subscription.save();
    return subscription;
  }

  await ClientSubscription.updateOne(
    { _id: subscription._id },
    { $set: { status: 'canceled', cancel_at_period_end: false } },
  );
  return ClientSubscription.findById(subscription._id);
}

export async function getClientSubscriptionForUser(userId) {
  const subscription = await ClientSubscription.findOne({ user_id: userId });
  if (!subscription) return null;
  const expired = await expireCanceledClientSubscriptionIfNeeded(subscription);
  return expired?.toObject ? expired.toObject() : expired;
}

export async function getClientSubscriptionPresentationForUser(userId, { refreshFromStripe = false } = {}) {
  let subscription = await ClientSubscription.findOne({ user_id: userId });
  if (!subscription) return null;

  if (refreshFromStripe && subscription.stripe_subscription_id) {
    try {
      const stripe = getStripeClient();
      const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
      await syncClientStripeSubscription(stripeSubscription);
      subscription = await ClientSubscription.findOne({ user_id: userId });
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      const missing =
        error?.code === 'resource_missing' ||
        error?.raw?.code === 'resource_missing' ||
        message.includes('no such subscription');
      if (missing) {
        subscription.status = 'canceled';
        subscription.cancel_at_period_end = false;
        await subscription.save();
      } else {
        console.warn('Client subscription refresh from Stripe failed:', error?.message || error);
      }
    }
  }

  subscription = await expireCanceledClientSubscriptionIfNeeded(subscription);
  const presented = presentClientSubscription(subscription);
  const status = String(presented?.status || subscription?.status || '').trim().toLowerCase();
  if (presented && (status === 'past_due' || status === 'unpaid')) {
    const openInvoice = await getOpenPayableInvoiceForCustomer({
      customerId: subscription.stripe_customer_id,
      subscriptionId: subscription.stripe_subscription_id,
      latestInvoiceId: subscription.latest_invoice_id || subscription.stripe_invoice_id,
    });
    if (openInvoice?.hostedInvoiceUrl) {
      presented.payment_action_url = openInvoice.hostedInvoiceUrl;
      presented.payment_action_label = 'Pay now / Update payment method';
      presented.open_invoice = {
        id: openInvoice.id,
        display_amount_due: openInvoice.displayAmountDue,
        currency: openInvoice.currency,
        status: openInvoice.status,
      };
    }
  }
  return presented;
}

export async function listClientPaidInvoicesForUser(userId, limit = 24) {
  const subscription = await ClientSubscription.findOne({ user_id: userId }).lean();
  const customerId = String(subscription?.stripe_customer_id || '').trim();
  if (!customerId) return [];

  const stripe = getStripeClient();
  const result = await stripe.invoices.list({
    customer: customerId,
    status: 'paid',
    limit: Math.min(Math.max(Number(limit) || 24, 1), 100),
  });

  return result.data.map((invoice) => presentPaidClientInvoice(invoice, subscription));
}

async function recordImmediatePlanChange(synced, subscription, { currentTier, targetTier, type }) {
  const set = {
    pending_tier: '',
    pending_tier_effective_at: null,
    stripe_subscription_schedule_id: '',
  };
  if (type === 'upgrade') {
    set.metadata = appendPlanChange(synced.metadata || subscription.metadata, {
      from: currentTier,
      to: targetTier,
      type: 'upgrade',
      at: new Date().toISOString(),
    });
  }
  await ClientSubscription.updateOne({ _id: synced._id }, { $set: set });
  return presentClientSubscription(await ClientSubscription.findById(synced._id).lean());
}

async function upgradeClientSubscriptionPlan({
  stripe,
  subscription,
  stripeSubscription,
  subscriptionItemId,
  priceId,
  userId,
  currentTier,
  targetTier,
  plan,
}) {
  await clearClientPendingScheduleIfAny(stripe, subscription, normalizeStripeId(stripeSubscription.schedule));

  const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    items: [{ id: subscriptionItemId, price: priceId }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
    cancel_at_period_end: false,
    expand: ['latest_invoice'],
    metadata: {
      user_id: String(userId),
      subscription_type: 'client',
      tier: targetTier,
    },
  });

  const invoice = updated.latest_invoice && typeof updated.latest_invoice === 'object'
    ? updated.latest_invoice
    : null;

  const synced = await syncClientStripeSubscription(updated);
  const presented = await recordImmediatePlanChange(synced, subscription, {
    currentTier,
    targetTier,
    type: 'upgrade',
  });

  return {
    ok: true,
    changeType: 'upgrade',
    subscription: presented,
    planName: plan.name,
    invoice: presentChangeInvoice(invoice),
  };
}

async function revertUnpaidClientUpgrade({
  stripe,
  subscription,
  stripeSubscription,
  latestInvoice,
  subscriptionItemId,
  priceId,
  userId,
  targetTier,
  plan,
}) {
  await clearClientPendingScheduleIfAny(stripe, subscription, normalizeStripeId(stripeSubscription.schedule));
  await voidOrDeleteUnpaidInvoice(stripe, latestInvoice);

  const restored = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    cancel_at_period_end: false,
    items: [{ id: subscriptionItemId, price: priceId }],
    proration_behavior: 'none',
    payment_behavior: 'allow_incomplete',
    expand: ['latest_invoice'],
    metadata: {
      user_id: String(userId),
      subscription_type: 'client',
      tier: targetTier,
    },
  });

  const synced = await syncClientStripeSubscription(restored);
  const presented = await recordImmediatePlanChange(synced, subscription, {
    currentTier: targetTier,
    targetTier,
    type: 'revert_unpaid_upgrade',
  });

  return {
    ok: true,
    changeType: 'revert_unpaid_upgrade',
    subscription: presented,
    planName: plan.name,
  };
}

async function scheduleClientDowngrade({
  stripe,
  subscription,
  stripeSubscription,
  priceId,
  userId,
  currentTier,
  targetTier,
  plan,
}) {
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

  const schedule = await getOrCreateClientSubscriptionSchedule(
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
      user_id: String(userId),
      subscription_type: 'client',
      pending_tier: targetTier,
    },
    phases: [
      {
        items: currentItems,
        start_date: activePhase?.start_date || currentPeriodStartTs || 'now',
        end_date: currentPeriodEndTs,
        proration_behavior: 'none',
        metadata: {
          user_id: String(userId),
          subscription_type: 'client',
          tier: currentTier,
        },
      },
      {
        items: buildSinglePriceScheduleItem(priceId),
        proration_behavior: 'none',
        metadata: {
          user_id: String(userId),
          subscription_type: 'client',
          tier: targetTier,
        },
      },
    ],
  });

  const synced = await ClientSubscription.findOneAndUpdate(
    { _id: subscription._id },
    {
      $set: {
        pending_tier: targetTier,
        pending_tier_effective_at: currentPeriodEnd,
        stripe_subscription_schedule_id: schedule.id,
        cancel_at_period_end: false,
        last_synced_at: new Date(),
        metadata: appendPlanChange(subscription.metadata, {
          from: currentTier,
          to: targetTier,
          type: 'downgrade',
          at: new Date().toISOString(),
        }),
      },
    },
    { returnDocument: 'after' },
  );

  return {
    ok: true,
    changeType: 'downgrade',
    subscription: presentClientSubscription(synced),
    planName: plan.name,
    effectiveAt: toIsoDate(currentPeriodEnd),
  };
}

export async function changeClientSubscriptionPlan(userId, tier) {
  const plan = getClientPlan(tier);
  if (!plan) {
    return { ok: false, code: 400, message: 'Invalid client subscription tier.' };
  }

  let subscription = await ClientSubscription.findOne({ user_id: userId });
  subscription = await expireCanceledClientSubscriptionIfNeeded(subscription);
  if (!subscription || !isClientSubscriptionActive(subscription)) {
    return {
      ok: false,
      code: 409,
      message: 'No active client subscription to change. Subscribe to a plan first.',
    };
  }

  const currentStatus = String(subscription.status || '').trim().toLowerCase();
  if (currentStatus === 'past_due' || currentStatus === 'unpaid') {
    return {
      ok: false,
      code: 409,
      message: 'Update your payment method before changing plans.',
    };
  }

  if (!subscription.stripe_subscription_id) {
    return { ok: false, code: 404, message: 'No Stripe subscription found for this client account.' };
  }

  const currentTier = canonicalClientTier(subscription.tier) || String(subscription.tier || '').trim().toLowerCase();
  const targetTier = String(plan.tier || '').trim().toLowerCase();
  if (isSameClientTier(currentTier, targetTier)) {
    return { ok: false, code: 400, message: 'You are already on this plan.' };
  }

  const currentTierRank = getClientTierRank(currentTier);
  const targetTierRank = getClientTierRank(targetTier);
  if (!currentTierRank || !targetTierRank) {
    return { ok: false, code: 400, message: 'Unable to compare client subscription plans.' };
  }

  const stripe = getStripeClient();
  const { price } = await priceForClientPlan(
    stripe,
    plan,
    subscription.billing_period || 'month',
  );
  const priceId = price.id;
  const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id, {
    expand: ['latest_invoice'],
  });
  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) {
    return { ok: false, code: 500, message: 'Unable to read subscription items from Stripe.' };
  }

  const changeArgs = {
    stripe,
    subscription,
    stripeSubscription,
    subscriptionItemId,
    priceId,
    userId,
    currentTier,
    targetTier,
    plan,
  };

  if (targetTierRank > currentTierRank) {
    return upgradeClientSubscriptionPlan(changeArgs);
  }

  const latestInvoice = stripeSubscription.latest_invoice && typeof stripeSubscription.latest_invoice === 'object'
    ? stripeSubscription.latest_invoice
    : null;
  if (invoiceRequiresPayment(latestInvoice) && String(latestInvoice.billing_reason || '') === 'subscription_update') {
    return revertUnpaidClientUpgrade({ ...changeArgs, latestInvoice });
  }

  return scheduleClientDowngrade(changeArgs);
}

export async function syncClientStripeSubscription(stripeSubscription, extra = {}) {
  const stripeSubscriptionId = String(stripeSubscription?.id || '').trim();
  const existingByStripeId = stripeSubscriptionId
    ? await ClientSubscription.findOne({ stripe_subscription_id: stripeSubscriptionId })
    : null;

  const userId =
    stripeSubscription.metadata?.user_id ||
    (existingByStripeId ? String(existingByStripeId.user_id) : '');
  if (!userId) {
    console.error('No user_id in stripe subscription metadata');
    return null;
  }

  const existingByUser = await ClientSubscription.findOne({ user_id: userId });
  if (
    existingByUser &&
    !shouldApplyIncomingClientStripeSubscription(existingByUser, stripeSubscription, extra)
  ) {
    return expireCanceledClientSubscriptionIfNeeded(existingByUser);
  }

  const { updateData, tier } = buildClientStripeSyncUpdate({
    stripeSubscription,
    existingByStripeId,
    existingByUser,
    userId,
    eventCreated: extra.eventCreated || extra.event_created || 0,
  });
  if (!tier) {
    console.error('No tier in stripe subscription metadata');
    return null;
  }

  const clientSubscription = await ClientSubscription.findOneAndUpdate(
    { user_id: userId },
    updateData,
    { upsert: true, returnDocument: 'after' }
  );

  return expireCanceledClientSubscriptionIfNeeded(clientSubscription);
}

export async function cancelClientSubscription(userId, cancellationReason = '') {
  let clientSubscription = await ClientSubscription.findOne({ user_id: userId });
  if (!clientSubscription) {
    throw clientHttpError('No client subscription found', 404, 'CLIENT_SUBSCRIPTION_NOT_FOUND');
  }

  const safeReason = String(cancellationReason || '').trim();
  if (!safeReason) {
    throw clientHttpError('Cancellation reason is required', 400, 'CANCELLATION_REASON_REQUIRED');
  }

  clientSubscription = await expireCanceledClientSubscriptionIfNeeded(clientSubscription);
  if (isClientSubscriptionAlreadyEnded(clientSubscription)) {
    throw clientSubscriptionEndedError();
  }

  const stripe = getStripeClient();
  try {
    await stripe.subscriptions.update(clientSubscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  } catch (error) {
    if (isStripeSubscriptionMissing(error)) {
      clientSubscription.status = 'canceled';
      clientSubscription.cancel_at_period_end = false;
      await clientSubscription.save();
      throw clientSubscriptionEndedError();
    }
    throw error;
  }

  clientSubscription.cancel_at_period_end = true;
  clientSubscription.metadata = {
    ...(clientSubscription.metadata || {}),
    cancellation_reason: safeReason,
    cancellation_reason_recorded_at: new Date().toISOString(),
  };
  await clientSubscription.save();

  return presentClientSubscription(clientSubscription);
}

export async function resumeClientSubscription(userId) {
  let clientSubscription = await ClientSubscription.findOne({ user_id: userId });
  if (!clientSubscription) {
    throw new Error('No client subscription found');
  }

  clientSubscription =
    (await getClientSubscriptionPresentationForUser(userId, { refreshFromStripe: true })) ||
    clientSubscription;

  const live = await ClientSubscription.findOne({ user_id: userId });
  if (!live?.stripe_subscription_id) {
    const err = new Error('Your subscription has ended. Please subscribe again to restore access.');
    err.statusCode = 409;
    throw err;
  }

  if (!isClientSubscriptionActive(live) || isClientPeriodEnded(live)) {
    const err = new Error('Your subscription period has ended. Please subscribe again to restore access.');
    err.statusCode = 409;
    throw err;
  }

  if (!live.cancel_at_period_end) {
    const err = new Error('Subscription is not scheduled to cancel');
    err.statusCode = 400;
    throw err;
  }

  const stripe = getStripeClient();
  let updated;
  try {
    updated = await stripe.subscriptions.update(live.stripe_subscription_id, {
      cancel_at_period_end: false,
    });
  } catch (error) {
    if (isStripeSubscriptionMissing(error)) {
      live.status = 'canceled';
      live.cancel_at_period_end = false;
      await live.save();
      const err = new Error('Your subscription has already ended. Please subscribe again to restore access.');
      err.statusCode = 409;
      throw err;
    }
    throw error;
  }

  live.metadata = {
    ...(live.metadata || {}),
    cancellation_reason: '',
    cancellation_reason_recorded_at: null,
  };
  await live.save();

  return presentClientSubscription(await syncClientStripeSubscription(updated));
}
