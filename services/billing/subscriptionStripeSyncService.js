import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import PublicProfile from '../../models/PublicProfile.js';
import { getPlan, getPlanByPriceId, getPlanTier } from './plans.js';
import { getStripeClient } from './stripeClient.js';
import {
  expireCanceledSubscriptionIfNeeded,
  markSubscriptionStripeStateExpired,
} from './subscriptionLocalService.js';
import {
  clearPendingScheduleIfAny,
  voidOrDeleteUnpaidInvoice,
} from './subscriptionScheduleService.js';
import {
  STRIPE_BLOCKING_STATUSES,
  canReuseLocalProfessionalStripeSnapshot,
  firstSubscriptionPriceId,
  getInvoiceSubscriptionId,
  getStripeSubscriptionPeriodEnd,
  getStripeSubscriptionPeriodStart,
  invoiceLinePriceId,
  invoiceRequiresPayment,
  isProfessionalPlatformStripeSubscription,
  isStripeResourceMissing,
  normalizeStripeId,
  professionalHasUsedTrial,
  shouldApplyIncomingProfessionalStripeSubscription,
  toDateFromUnix,
} from './subscriptionShared.js';
import { syncClientStripeSubscription } from '../client/clientSubscriptionService.js';
import {
  invoiceIsStorefrontTemplate,
  isStorefrontTemplateStripeMetadata,
  stripeSubscriptionBelongsToStorefrontTemplate,
  syncStorefrontTemplateSubscription,
} from './storefrontTemplates/unlock.js';
import {
  processPaidSubscriptionReferralCredit,
  syncPendingCreditFromStripeBalance,
} from '../referral/networkCircle.js';

export async function findBlockingStripeSubscription(customerId) {
  const normalizedCustomerId = String(customerId || '').trim();
  if (!normalizedCustomerId) return null;
  const result = await getStripeClient().subscriptions.list({
    customer: normalizedCustomerId,
    status: 'all',
    limit: 20,
  });
  return result.data.find((sub) => (
    isProfessionalPlatformStripeSubscription(sub)
    && STRIPE_BLOCKING_STATUSES.has(String(sub.status || ''))
  )) || null;
}

function planFromInvoice(invoice = {}) {
  const match = paidPlanFromInvoice(invoice);
  return match?.plan || null;
}

function paidPlanFromInvoice(invoice = {}) {
  for (const line of invoice.lines?.data || []) {
    const priceId = invoiceLinePriceId(line);
    const metaPlan = String(
      line?.metadata?.plan_key || line?.price?.metadata?.plan_key || '',
    ).trim();
    const plan = (metaPlan && getPlan(metaPlan)) || getPlanByPriceId(priceId);
    if (plan && priceId) return { plan, priceId };
  }
  return null;
}

function invoiceHasPrice(invoice = {}, priceId = '') {
  const normalizedPriceId = String(priceId || '').trim();
  if (!normalizedPriceId) return false;
  return (invoice.lines?.data || []).some(
    (line) => invoiceLinePriceId(line) === normalizedPriceId,
  );
}

async function findLatestPaidPlanForSubscription(stripe, customerId, subscriptionId) {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    status: 'paid',
    limit: 20,
    expand: ['data.lines'],
  });
  for (const invoice of invoices.data || []) {
    const invoiceSubscriptionId = getInvoiceSubscriptionId(invoice);
    if (invoiceSubscriptionId && subscriptionId && invoiceSubscriptionId !== subscriptionId) {
      continue;
    }
    const paid = paidPlanFromInvoice(invoice);
    if (paid) {
      return {
        plan: paid.plan,
        priceId: paid.priceId,
        invoice,
      };
    }
  }
  return null;
}

async function repairUnpaidUpgradeIfNeeded(stripe, user, localSubscription, stripeSubscription) {
  const latestInvoice = stripeSubscription.latest_invoice
    && typeof stripeSubscription.latest_invoice === 'object'
    ? stripeSubscription.latest_invoice
    : null;
  if (
    !invoiceRequiresPayment(latestInvoice)
    || String(latestInvoice.billing_reason || '') !== 'subscription_update'
  ) {
    return { repaired: false, stripeSubscription };
  }

  const subscriptionId = normalizeStripeId(stripeSubscription);
  const customerId = normalizeStripeId(stripeSubscription.customer)
    || String(localSubscription?.stripe_customer_id || '').trim();
  const currentPriceId = firstSubscriptionPriceId(stripeSubscription);
  const lastPaid = await findLatestPaidPlanForSubscription(stripe, customerId, subscriptionId);
  if (!lastPaid?.priceId || lastPaid.priceId === currentPriceId) {
    return { repaired: false, stripeSubscription };
  }
  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) return { repaired: false, stripeSubscription };

  await clearPendingScheduleIfAny(
    stripe,
    localSubscription,
    normalizeStripeId(stripeSubscription.schedule),
  );
  await voidOrDeleteUnpaidInvoice(stripe, latestInvoice);
  const restored = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
    items: [{ id: subscriptionItemId, price: lastPaid.priceId }],
    proration_behavior: 'none',
    payment_behavior: 'allow_incomplete',
    expand: ['latest_invoice'],
    metadata: {
      user_id: String(user._id),
      plan_key: lastPaid.plan.plan_key,
    },
  });
  const subscription = await syncStripeSubscription(restored, {
    user_id: String(user._id),
    plan_key: lastPaid.plan.plan_key,
    clearPendingPlan: true,
  });
  return { repaired: true, stripeSubscription: restored, subscription };
}

async function repairPaidPlanMismatchIfNeeded(stripe, user, localSubscription, stripeSubscription) {
  const subscriptionId = normalizeStripeId(stripeSubscription);
  const customerId = normalizeStripeId(stripeSubscription.customer)
    || String(localSubscription?.stripe_customer_id || '').trim();
  const currentPriceId = firstSubscriptionPriceId(stripeSubscription);
  const lastPaid = await findLatestPaidPlanForSubscription(stripe, customerId, subscriptionId);
  if (!lastPaid?.priceId || lastPaid.priceId === currentPriceId) {
    return { repaired: false, stripeSubscription };
  }
  if (invoiceHasPrice(lastPaid.invoice, currentPriceId)) {
    return { repaired: false, stripeSubscription };
  }

  const currentPlan = getPlanByPriceId(currentPriceId);
  const currentTier = getPlanTier(currentPlan?.plan_key);
  const lastPaidTier = getPlanTier(lastPaid.plan?.plan_key);
  if (currentTier > 0 && lastPaidTier > 0 && currentTier < lastPaidTier) {
    return { repaired: false, stripeSubscription };
  }
  const pendingPlanKey = String(localSubscription?.pending_plan_key || '').trim().toLowerCase();
  if (pendingPlanKey) {
    const pendingTier = getPlanTier(pendingPlanKey);
    if (pendingTier > 0 && currentTier > 0 && pendingTier < currentTier) {
      return { repaired: false, stripeSubscription };
    }
  }

  const attachedScheduleId = normalizeStripeId(stripeSubscription.schedule);
  if (attachedScheduleId) {
    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(attachedScheduleId);
      if (new Set(['not_started', 'active']).has(String(schedule.status || ''))) {
        return { repaired: false, stripeSubscription };
      }
    } catch (error) {
      if (error?.code !== 'resource_missing') throw error;
    }
  }
  const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
  if (!subscriptionItemId) return { repaired: false, stripeSubscription };

  await clearPendingScheduleIfAny(stripe, localSubscription, attachedScheduleId);
  const restored = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
    items: [{ id: subscriptionItemId, price: lastPaid.priceId }],
    proration_behavior: 'none',
    payment_behavior: 'allow_incomplete',
    expand: ['latest_invoice'],
    metadata: {
      user_id: String(user._id),
      plan_key: lastPaid.plan.plan_key,
    },
  });
  const subscription = await syncStripeSubscription(restored, {
    user_id: String(user._id),
    plan_key: lastPaid.plan.plan_key,
    clearPendingPlan: true,
  });
  return { repaired: true, stripeSubscription: restored, subscription };
}

async function markProfessionalStripeRefreshAttempt(subscription) {
  if (!subscription?._id) return;
  const metadata = {
    ...(subscription.metadata && typeof subscription.metadata === 'object' ? subscription.metadata : {}),
    stripe_refresh_attempted_at: new Date().toISOString(),
  };
  await Subscription.updateOne({ _id: subscription._id }, { $set: { metadata } });
}

async function fallbackProfessionalSubscriptionAfterStripeError(user, subscription, error, context) {
  if (isStripeResourceMissing(error)) {
    return markSubscriptionStripeStateExpired(user._id);
  }
  console.warn('Professional subscription refresh from Stripe failed; using local plan.', {
    user_id: String(user?._id || ''),
    context,
    error: error?.message || error,
  });
  await markProfessionalStripeRefreshAttempt(subscription);
  return expireCanceledSubscriptionIfNeeded(subscription);
}

export async function refreshSubscriptionFromStripeForUser(user) {
  const subscription = await Subscription.findOne({ user_id: user._id });
  const customerId = String(subscription?.stripe_customer_id || '').trim();
  if (!customerId) return expireCanceledSubscriptionIfNeeded(subscription);

  let activeStripeSubscription;
  try {
    activeStripeSubscription = await findBlockingStripeSubscription(customerId);
  } catch (error) {
    return fallbackProfessionalSubscriptionAfterStripeError(user, subscription, error, 'list');
  }
  const stripe = getStripeClient();
  if (!activeStripeSubscription) {
    const localSubscriptionId = String(subscription?.stripe_subscription_id || '').trim();
    if (localSubscriptionId) {
      try {
        const endedStripeSubscription = await stripe.subscriptions.retrieve(localSubscriptionId);
        const synced = await syncStripeSubscription(endedStripeSubscription, {
          user_id: String(user._id),
        });
        return expireCanceledSubscriptionIfNeeded(synced);
      } catch (error) {
        return fallbackProfessionalSubscriptionAfterStripeError(user, subscription, error, 'retrieve-local');
      }
    }
    return expireCanceledSubscriptionIfNeeded(subscription);
  }

  let detailedStripeSubscription;
  try {
    detailedStripeSubscription = await stripe.subscriptions.retrieve(activeStripeSubscription.id, {
      expand: ['latest_invoice'],
    });
  } catch (error) {
    return fallbackProfessionalSubscriptionAfterStripeError(user, subscription, error, 'retrieve-active');
  }
  const repairResult = await repairUnpaidUpgradeIfNeeded(
    stripe,
    user,
    subscription,
    detailedStripeSubscription,
  );
  if (repairResult.repaired) return repairResult.subscription;
  const paidPlanRepairResult = await repairPaidPlanMismatchIfNeeded(
    stripe,
    user,
    subscription,
    detailedStripeSubscription,
  );
  if (paidPlanRepairResult.repaired) return paidPlanRepairResult.subscription;

  if (canReuseLocalProfessionalStripeSnapshot(subscription, detailedStripeSubscription)) {
    return expireCanceledSubscriptionIfNeeded(subscription);
  }
  return syncStripeSubscription(detailedStripeSubscription, { user_id: String(user._id) });
}

export async function syncStripeSubscription(stripeSubscription, extra = {}) {
  const subscriptionId = normalizeStripeId(stripeSubscription?.id);
  if (!subscriptionId) return null;
  if (await stripeSubscriptionBelongsToStorefrontTemplate(subscriptionId, stripeSubscription)) {
    return syncStorefrontTemplateSubscription(stripeSubscription, extra);
  }
  const priceId = firstSubscriptionPriceId(stripeSubscription);
  const plan = getPlanByPriceId(priceId);
  const customerId = normalizeStripeId(stripeSubscription.customer);
  const userId = String(
    stripeSubscription?.metadata?.user_id || extra.user_id || '',
  ).trim();
  const planKey = String(
    extra.plan_key || stripeSubscription?.metadata?.plan_key || plan?.plan_key || '',
  ).trim();
  const billingPeriod = String(
    extra.billing_period || stripeSubscription?.metadata?.billing_period || '',
  ).trim().toLowerCase();
  const filter = userId
    ? { user_id: userId }
    : { stripe_subscription_id: subscriptionId };
  const existing = await Subscription.findOne(filter).lean();
  if (existing && !shouldApplyIncomingProfessionalStripeSubscription(existing, stripeSubscription, extra)) {
    return existing;
  }

  const stripeStatus = String(stripeSubscription.status || 'incomplete').trim().toLowerCase();
  const existingMeta = existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
  const trialUsed = professionalHasUsedTrial(existing) || Boolean(toDateFromUnix(stripeSubscription.trial_start));
  const pastDueSince = stripeStatus === 'past_due'
    ? (existingMeta.past_due_since || new Date().toISOString())
    : undefined;
  const update = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_price_id: priceId,
    status: stripeStatus || 'incomplete',
    current_period_start: getStripeSubscriptionPeriodStart(stripeSubscription),
    current_period_end: getStripeSubscriptionPeriodEnd(stripeSubscription),
    cancel_at_period_end: Boolean(stripeSubscription.cancel_at_period_end),
    trial_start: toDateFromUnix(stripeSubscription.trial_start) || existing?.trial_start || null,
    trial_end: toDateFromUnix(stripeSubscription.trial_end),
    latest_invoice_id: normalizeStripeId(stripeSubscription.latest_invoice),
    last_synced_at: new Date(),
    trial_used: trialUsed || Boolean(existing?.trial_used),
    metadata: {
      ...existingMeta,
      ...(stripeSubscription.metadata || {}),
      trial_used: trialUsed || Boolean(existingMeta.trial_used),
      stripe_subscription_created:
        Number(stripeSubscription.created || 0)
        || existingMeta.stripe_subscription_created
        || undefined,
      past_due_since: stripeStatus === 'past_due' ? pastDueSince : undefined,
    },
  };
  const eventCreated = Number(extra.eventCreated || extra.event_created || 0);
  if (eventCreated > 0) update.metadata.stripe_last_event_created = eventCreated;
  if (stripeStatus !== 'past_due') delete update.metadata.past_due_since;
  if (planKey && getPlan(planKey)) update.plan_key = planKey;
  if (billingPeriod === 'year' || billingPeriod === 'month') update.billing_period = billingPeriod;
  if (extra.last_stripe_event_id) update.last_stripe_event_id = extra.last_stripe_event_id;

  const shouldClearPendingPlan = Boolean(
    extra.clearPendingPlan
    || (existing?.pending_plan_key && planKey && existing.pending_plan_key === planKey),
  );
  const synced = await Subscription.findOneAndUpdate(
    filter,
    {
      $set: update,
      ...(shouldClearPendingPlan
        ? {
            $unset: {
              pending_plan_key: '',
              pending_plan_effective_at: '',
              stripe_subscription_schedule_id: '',
            },
          }
        : {}),
    },
    { returnDocument: 'after', upsert: Boolean(userId) },
  );
  if (synced?.user_id && String(stripeSubscription.status || '') === 'active') {
    try {
      await processPaidSubscriptionReferralCredit(synced.user_id, {
        stripeEventId: extra.last_stripe_event_id || '',
      });
    } catch (error) {
      console.warn('[networkCircle] referral credit on subscription sync failed', error?.message || error);
    }
  }
  return synced;
}

export async function repairPlatformSubscriptionIfTemplateCollision(userId) {
  const subscription = await Subscription.findOne({ user_id: userId }).lean();
  if (!subscription?.stripe_subscription_id) return subscription;
  const publicProfile = await PublicProfile.findOne({ user_id: userId })
    .select('storefront.template_purchases')
    .lean();
  const templateSubIds = new Set(
    (publicProfile?.storefront?.template_purchases || [])
      .map((purchase) => String(purchase.stripe_subscription_id || '').trim())
      .filter(Boolean),
  );
  const currentId = String(subscription.stripe_subscription_id || '').trim();
  if (!templateSubIds.has(currentId)) return subscription;

  const customerId = String(subscription.stripe_customer_id || '').trim();
  if (!customerId) return subscription;
  try {
    const listed = await getStripeClient().subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 30,
    });
    const platformSub = (listed.data || []).find((item) => {
      const id = normalizeStripeId(item);
      if (!id || templateSubIds.has(id)) return false;
      if (isStorefrontTemplateStripeMetadata(item.metadata)) return false;
      const type = String(item.metadata?.subscription_type || '').trim().toLowerCase();
      return type !== 'client';
    });
    if (!platformSub) return subscription;
    const synced = await syncStripeSubscription(platformSub, {
      user_id: String(userId),
      last_stripe_event_id: 'admin-template-collision-repair',
    });
    return synced?.toObject?.() || synced || subscription;
  } catch {
    return subscription;
  }
}

export async function syncCheckoutSession(session, eventId = '', eventCreated = 0) {
  const stripe = getStripeClient();
  const subscriptionId = normalizeStripeId(session.subscription);
  if (!subscriptionId) return null;
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const subscriptionType = String(
    session?.metadata?.subscription_type || stripeSubscription?.metadata?.subscription_type || '',
  ).trim().toLowerCase();
  const billingPeriod = String(
    session?.metadata?.billing_period || stripeSubscription?.metadata?.billing_period || '',
  ).trim().toLowerCase();
  const amountPaid = Number(session?.amount_total ?? session?.amount_subtotal ?? 0);
  let synced;
  if (subscriptionType === 'client') {
    synced = await syncClientStripeSubscription(stripeSubscription, {
      last_stripe_event_id: eventId,
      eventCreated,
    });
  } else {
    synced = await syncStripeSubscription(stripeSubscription, {
      user_id: session?.metadata?.user_id,
      plan_key: session?.metadata?.plan_key,
      billing_period: billingPeriod,
      last_stripe_event_id: eventId,
      eventCreated,
    });
  }
  if (amountPaid > 0 && synced) {
    const purchase = {
      plan_key: String(session?.metadata?.plan_key || synced.plan_key || synced.tier || ''),
      billing_period: billingPeriod === 'year' ? 'year' : (synced.billing_period || 'month'),
      amount: amountPaid,
      currency: String(session?.currency || 'usd'),
      stripe_invoice_id: normalizeStripeId(session?.invoice) || '',
      confirmed_at: new Date(),
    };
    if (subscriptionType === 'client' || synced.tier) {
      synced = await ClientSubscription.findOneAndUpdate(
        { stripe_subscription_id: subscriptionId },
        { $set: { last_purchase: purchase, billing_period: purchase.billing_period } },
        { returnDocument: 'after' },
      ) || synced;
    } else if (synced.user_id || synced.plan_key) {
      synced = await Subscription.findOneAndUpdate(
        { stripe_subscription_id: subscriptionId },
        { $set: { last_purchase: purchase, billing_period: purchase.billing_period } },
        { returnDocument: 'after' },
      ) || synced;
    }
  }
  return synced;
}

export async function updateInvoicePaymentState(invoice, paymentStatus, eventId = '', eventCreated = 0) {
  const invoiceId = normalizeStripeId(invoice?.id);
  const customerId = normalizeStripeId(invoice?.customer);
  let resolvedInvoice = invoice;
  let subscriptionId = getInvoiceSubscriptionId(resolvedInvoice);
  let isTemplateInvoice = invoiceIsStorefrontTemplate(resolvedInvoice);
  let invoiceRetrieveError = null;

  if (!subscriptionId && invoiceId) {
    try {
      const liveInvoice = await getStripeClient().invoices.retrieve(invoiceId, {
        expand: ['parent.subscription_details.subscription'],
      });
      resolvedInvoice = liveInvoice || resolvedInvoice;
      subscriptionId = getInvoiceSubscriptionId(resolvedInvoice);
      isTemplateInvoice = isTemplateInvoice || invoiceIsStorefrontTemplate(resolvedInvoice);
    } catch (error) {
      invoiceRetrieveError = error;
      console.warn('invoice subscription resolve via Stripe retrieve failed:', error?.message || error);
    }
  }
  if (!subscriptionId && invoiceId && !isTemplateInvoice) {
    const templateProfile = await PublicProfile.findOne({
      'storefront.template_purchases.stripe_invoice_id': invoiceId,
    })
      .select('storefront.template_purchases')
      .lean();
    const templatePurchase = (templateProfile?.storefront?.template_purchases || []).find(
      (row) => String(row.stripe_invoice_id || '').trim() === invoiceId,
    );
    if (templatePurchase) {
      isTemplateInvoice = true;
      subscriptionId = String(templatePurchase.stripe_subscription_id || '').trim();
    }
  }
  if (!subscriptionId && customerId && !isTemplateInvoice) {
    const localProfessional = await Subscription.findOne({ stripe_customer_id: customerId })
      .select('user_id stripe_subscription_id')
      .lean();
    const localClient = await ClientSubscription.findOne({ stripe_customer_id: customerId })
      .select('stripe_subscription_id')
      .lean();
    const professionalSubId = String(localProfessional?.stripe_subscription_id || '').trim();
    const clientSubId = String(localClient?.stripe_subscription_id || '').trim();

    let thisUserHasTemplateSubs = false;
    if (localProfessional?.user_id) {
      const profile = await PublicProfile.findOne({ user_id: localProfessional.user_id })
        .select('storefront.template_purchases')
        .lean();
      const purchases = Array.isArray(profile?.storefront?.template_purchases)
        ? profile.storefront.template_purchases
        : [];
      if (invoiceId) {
        const byInvoice = purchases.find(
          (row) => String(row.stripe_invoice_id || '').trim() === invoiceId,
        );
        if (byInvoice) {
          isTemplateInvoice = true;
          subscriptionId = String(byInvoice.stripe_subscription_id || '').trim();
        }
      }
      thisUserHasTemplateSubs = purchases.some(
        (row) => String(row.stripe_subscription_id || '').trim(),
      );
    }

    if (!subscriptionId && !isTemplateInvoice) {
      const onlyProfessional = Boolean(professionalSubId) && !clientSubId && !thisUserHasTemplateSubs;
      const onlyClient = Boolean(clientSubId) && !professionalSubId && !thisUserHasTemplateSubs;
      if (onlyProfessional) {
        subscriptionId = professionalSubId;
      } else if (onlyClient) {
        subscriptionId = clientSubId;
      }
    }
  }
  if (isTemplateInvoice && !subscriptionId) {
    console.warn('template invoice payment sync skipped: missing subscription id', {
      invoiceId,
      customerId,
      paymentStatus,
      eventId,
    });
    if (invoiceRetrieveError && !isStripeResourceMissing(invoiceRetrieveError)) {
      throw invoiceRetrieveError;
    }
    return null;
  }
  if (!subscriptionId) {
    console.warn('invoice payment sync skipped: missing subscription id', {
      invoiceId,
      customerId,
      paymentStatus,
      eventId,
    });
    if (invoiceRetrieveError && !isStripeResourceMissing(invoiceRetrieveError)) {
      throw invoiceRetrieveError;
    }
    return null;
  }
  let synced = null;
  let clientInvoice = false;
  try {
    const stripeSubscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
    isTemplateInvoice = isTemplateInvoice
      || await stripeSubscriptionBelongsToStorefrontTemplate(subscriptionId, stripeSubscription);
    const subscriptionType = String(
      stripeSubscription?.metadata?.subscription_type || '',
    ).trim().toLowerCase();
    const eventExtra = { last_stripe_event_id: eventId, eventCreated };
    if (isTemplateInvoice) {
      synced = await syncStorefrontTemplateSubscription(stripeSubscription, eventExtra);
    } else if (subscriptionType === 'client') {
      clientInvoice = true;
      synced = await syncClientStripeSubscription(stripeSubscription, eventExtra);
    } else {
      const existingClient = await ClientSubscription.findOne({
        stripe_subscription_id: subscriptionId,
      }).select('_id').lean();
      clientInvoice = Boolean(existingClient);
      if (existingClient) {
        synced = await syncClientStripeSubscription(stripeSubscription, eventExtra);
      } else {
        synced = await syncStripeSubscription(stripeSubscription, eventExtra);
      }
    }
  } catch (error) {
    console.warn('invoice payment sync from Stripe subscription failed:', error?.message || error);
  }

  if (isTemplateInvoice) return synced;

  const existingEventCreated = Number(synced?.metadata?.stripe_last_event_created || 0);
  if (eventCreated > 0 && existingEventCreated > 0 && eventCreated < existingEventCreated) {
    return synced;
  }

  const update = {
    latest_invoice_id: invoiceId,
    last_payment_status: paymentStatus,
    last_stripe_event_id: eventId,
    last_synced_at: new Date(),
  };
  if (eventCreated > 0) update['metadata.stripe_last_event_created'] = eventCreated;
  if (paymentStatus === 'failed') update.status = 'past_due';
  if (clientInvoice || synced?.tier) {
    const paymentSynced = await ClientSubscription.findOneAndUpdate(
      { stripe_subscription_id: subscriptionId },
      { $set: update },
      { returnDocument: 'after' },
    );
    if (paymentSynced) synced = paymentSynced;
  } else {
    const paymentSynced = await Subscription.findOneAndUpdate(
      { stripe_subscription_id: subscriptionId },
      { $set: update },
      { returnDocument: 'after' },
    );
    if (paymentSynced) synced = paymentSynced;
  }

  const amountPaid = Number(invoice?.amount_paid ?? invoice?.total ?? 0);
  if (paymentStatus === 'paid' && amountPaid > 0 && synced?.user_id) {
    const confirmed = await Subscription.findOneAndUpdate(
      { stripe_subscription_id: subscriptionId },
      {
        $set: {
          last_purchase: {
            plan_key: synced.plan_key || '',
            billing_period: synced.billing_period || '',
            amount: amountPaid,
            currency: String(invoice?.currency || 'usd'),
            stripe_invoice_id: normalizeStripeId(invoice?.id),
            confirmed_at: new Date(),
          },
        },
      },
      { returnDocument: 'after' },
    );
    if (confirmed) synced = confirmed;
  } else if (paymentStatus === 'paid' && amountPaid > 0 && synced?.tier) {
    const confirmed = await ClientSubscription.findOneAndUpdate(
      { stripe_subscription_id: subscriptionId },
      {
        $set: {
          last_purchase: {
            plan_key: synced.tier || '',
            billing_period: synced.billing_period || '',
            amount: amountPaid,
            currency: String(invoice?.currency || 'usd'),
            stripe_invoice_id: normalizeStripeId(invoice?.id),
            confirmed_at: new Date(),
          },
        },
      },
      { returnDocument: 'after' },
    );
    if (confirmed) synced = confirmed;
  }
  if (paymentStatus === 'paid' && synced?.user_id) {
    try {
      await processPaidSubscriptionReferralCredit(synced.user_id, {
        stripeEventId: eventId,
        invoiceAmountPaid: Number(invoice?.amount_paid ?? invoice?.total ?? 0),
      });
      await syncPendingCreditFromStripeBalance(synced.user_id, {
        stripeCustomerId: synced.stripe_customer_id,
      });
    } catch (error) {
      console.warn('[networkCircle] referral credit on invoice.paid failed', error?.message || error);
    }
  }
  return synced;
}

export async function syncSubscriptionSchedule(schedule, eventId = '', eventCreated = 0) {
  const scheduleId = normalizeStripeId(schedule?.id);
  if (!scheduleId) return null;
  const subscriptionId =
    normalizeStripeId(schedule.subscription) || normalizeStripeId(schedule.released_subscription);
  const isTerminalSchedule = new Set(['completed', 'released', 'canceled'])
    .has(String(schedule.status || ''));
  const pendingPlanKey = String(
    schedule?.metadata?.pending_plan_key
    || schedule?.phases?.[1]?.metadata?.plan_key
    || '',
  ).trim();
  const update = {
    last_stripe_event_id: eventId,
    last_synced_at: new Date(),
  };
  if (isTerminalSchedule) {
    update.pending_plan_key = '';
    update.pending_plan_effective_at = null;
    update.stripe_subscription_schedule_id = '';
  } else {
    update.stripe_subscription_schedule_id = scheduleId;
    if (pendingPlanKey && getPlan(pendingPlanKey)) {
      update.pending_plan_key = pendingPlanKey;
      update.pending_plan_effective_at = toDateFromUnix(schedule?.phases?.[0]?.end_date);
    }
  }
  let synced = await Subscription.findOneAndUpdate(
    { stripe_subscription_schedule_id: scheduleId },
    { $set: update },
    { returnDocument: 'after' },
  );
  if (!synced && subscriptionId) {
    synced = await Subscription.findOneAndUpdate(
      { stripe_subscription_id: subscriptionId },
      { $set: update },
      { returnDocument: 'after' },
    );
  }
  if (subscriptionId && isTerminalSchedule) {
    try {
      const stripeSubscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
      return syncStripeSubscription(stripeSubscription, {
        last_stripe_event_id: eventId,
        eventCreated,
        clearPendingPlan: true,
      });
    } catch {
      return synced;
    }
  }
  return synced;
}
