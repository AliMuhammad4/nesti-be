import PublicProfile from '../../../models/PublicProfile.js';
import Subscription from '../../../models/Subscription.js';
import { getStripeClient } from '../stripeClient.js';
import { ensureStripeCustomerForUser } from '../subscriptionService.js';
import {
  getStorefrontTemplateTier,
  normalizeTemplateId,
  storefrontTemplateSupportsProfile,
} from './tiers.js';
import {
  serializeStorefrontTemplateEntitlements,
  userHasStorefrontTemplateAccess,
} from './access.js';
import {
  normalizeStripeId,
  unlockStorefrontTemplateForUser,
} from './unlock.js';

export function selectReusableStorefrontTemplateCheckout(sessions, userId, templateId) {
  const normalizedUserId = String(userId || '');
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const matching = (Array.isArray(sessions) ? sessions : []).filter((candidate) => (
    String(candidate?.metadata?.purchase_type || '') === 'storefront_template'
    && String(candidate?.metadata?.user_id || '') === normalizedUserId
    && normalizeTemplateId(candidate?.metadata?.template_id) === normalizedTemplateId
  ));
  return {
    paid: matching.find((candidate) => (
      candidate.status === 'complete'
      && String(candidate.payment_status || '').toLowerCase() === 'paid'
    )) || null,
    open: matching.find((candidate) => candidate.status === 'open' && candidate.url) || null,
  };
}

export function validateStorefrontTemplateCheckoutSession(
  session,
  { userId: expectedUserId = '', templateId: expectedTemplateId = '' } = {},
) {
  if (String(session?.metadata?.purchase_type || '').trim() !== 'storefront_template') {
    return { ok: false, code: 400, message: 'This checkout session is not for a storefront template.' };
  }
  const mode = String(session?.mode || '').toLowerCase();
  if (mode !== 'subscription' && mode !== 'payment') {
    return { ok: false, code: 400, message: 'Checkout session is not a storefront template payment.' };
  }

  const userId = String(session?.metadata?.user_id || '').trim();
  const templateId = normalizeTemplateId(session?.metadata?.template_id);
  const template = getStorefrontTemplateTier(templateId);
  if (!userId || !template) {
    return { ok: false, code: 400, message: 'Checkout session template details are invalid.' };
  }
  if (expectedUserId && userId !== String(expectedUserId)) {
    return { ok: false, code: 403, message: 'This checkout session belongs to another account.' };
  }
  if (expectedTemplateId && templateId !== normalizeTemplateId(expectedTemplateId)) {
    return { ok: false, code: 400, message: 'Checkout session does not match the selected template.' };
  }
  if (String(session?.payment_status || '').toLowerCase() !== 'paid') {
    return { ok: false, code: 409, message: 'Template payment is still processing.' };
  }
  if (
    Number(session?.amount_total) !== template.amount
    || String(session?.currency || '').toLowerCase() !== template.currency
  ) {
    return { ok: false, code: 409, message: 'Checkout payment amount does not match the template price.' };
  }

  return { ok: true, userId, template, mode };
}

export async function syncStorefrontTemplateCheckoutSession(session) {
  const validation = validateStorefrontTemplateCheckoutSession(session);
  if (!validation.ok) return null;

  const subscriptionId = normalizeStripeId(session.subscription);
  let subscriptionStatus = 'active';
  let cancelAtPeriodEnd = false;
  let currentPeriodEnd = null;
  if (subscriptionId) {
    try {
      const stripeSubscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
      subscriptionStatus = String(stripeSubscription.status || 'active').toLowerCase();
      cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end === true;
      currentPeriodEnd = stripeSubscription.current_period_end
        ? new Date(Number(stripeSubscription.current_period_end) * 1000)
        : null;
    } catch {
      subscriptionStatus = 'active';
    }
  }

  return unlockStorefrontTemplateForUser(validation.userId, validation.template.template_id, {
    amount: Number(session.amount_total || 0),
    currency: String(session.currency || 'usd').toLowerCase(),
    billing_interval: validation.template.interval || 'month',
    stripe_checkout_session_id: session.id || '',
    stripe_payment_intent_id: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || '',
    stripe_invoice_id: typeof session.invoice === 'string'
      ? session.invoice
      : session.invoice?.id || '',
    stripe_subscription_id: subscriptionId,
    subscription_status: subscriptionStatus,
    cancel_at_period_end: cancelAtPeriodEnd,
    current_period_end: currentPeriodEnd,
    purchased_at: session.created ? new Date(session.created * 1000) : new Date(),
  });
}

export async function createStorefrontTemplateCheckoutSession(user, templateId) {
  const template = getStorefrontTemplateTier(templateId);
  if (!template) {
    return { ok: false, code: 400, message: 'Invalid storefront template.' };
  }
  const profile = await PublicProfile.findOne({ user_id: user._id });
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  if (!storefrontTemplateSupportsProfile(template, profile)) {
    return { ok: false, code: 400, message: 'This template is not available for your professional type.' };
  }
  if (template.amount <= 0) {
    await unlockStorefrontTemplateForUser(user._id, template.template_id);
    return { ok: true, free: true, template };
  }

  if (userHasStorefrontTemplateAccess(profile, template.template_id)) {
    return { ok: true, alreadyUnlocked: true, template };
  }

  const subscription = await Subscription.findOne({ user_id: user._id });
  const customerId = await ensureStripeCustomerForUser(user, subscription, { planKey: 'template' });
  const frontendUrl = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || '').replace(/\/+$/, '');
  if (!frontendUrl) {
    return { ok: false, code: 503, message: 'FRONTEND_URL is not configured.' };
  }

  const stripe = getStripeClient();
  const [recentSessions, openSessions] = await Promise.all([
    stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
    }),
    stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 100,
    }),
  ]);
  const reusableCheckout = selectReusableStorefrontTemplateCheckout(
    [...(recentSessions.data || []), ...(openSessions.data || [])],
    user._id,
    template.template_id,
  );
  if (reusableCheckout.paid) {
    const unlockedProfile = await syncStorefrontTemplateCheckoutSession(reusableCheckout.paid);
    if (unlockedProfile && userHasStorefrontTemplateAccess(unlockedProfile, template.template_id)) {
      return { ok: true, alreadyUnlocked: true, template };
    }
  }

  if (reusableCheckout.open) {
    return { ok: true, session: reusableCheckout.open, template, reused: true };
  }

  const sharedMetadata = {
    purchase_type: 'storefront_template',
    subscription_type: 'storefront_template',
    user_id: String(user._id),
    template_id: template.template_id,
    tier: template.tier,
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: template.currency,
          unit_amount: template.amount,
          recurring: { interval: template.interval || 'month' },
          product_data: {
            name: `${template.name} storefront template`,
            description: `${template.tier[0].toUpperCase()}${template.tier.slice(1)} storefront template · billed monthly`,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${frontendUrl}/dashboard/public-profile?template_checkout=success&template=${encodeURIComponent(template.template_id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/dashboard/public-profile?template_checkout=cancelled&template=${encodeURIComponent(template.template_id)}`,
    metadata: sharedMetadata,
    subscription_data: {
      metadata: sharedMetadata,
    },
  }, {
    // Concurrent requests receive the same Stripe session. Stripe prunes
    // idempotency records after ~24h; v2-monthly separates prior one-time keys.
    idempotencyKey: ['storefront-template', 'v2-monthly', String(user._id), template.template_id].join(':'),
  });

  return { ok: true, session, template };
}

export async function confirmStorefrontTemplateCheckoutSession(user, sessionId, templateId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return { ok: false, code: 400, message: 'Checkout session ID is required.' };
  }

  let session;
  try {
    session = await getStripeClient().checkout.sessions.retrieve(normalizedSessionId);
  } catch {
    return { ok: false, code: 404, message: 'Template checkout session was not found.' };
  }

  const validation = validateStorefrontTemplateCheckoutSession(session, {
    userId: user._id,
    templateId,
  });
  if (!validation.ok) return validation;

  const profile = await syncStorefrontTemplateCheckoutSession(session);
  if (!profile) {
    return { ok: false, code: 404, message: 'Public profile not found.' };
  }

  return {
    ok: true,
    template: validation.template,
    entitlements: serializeStorefrontTemplateEntitlements(profile),
  };
}
