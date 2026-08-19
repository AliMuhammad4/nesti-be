import PublicProfile from '../../models/PublicProfile.js';
import Subscription from '../../models/Subscription.js';
import { getStripeClient } from './stripeClient.js';
import { ensureStripeCustomerForUser } from './subscriptionService.js';

export const STOREFRONT_TEMPLATE_TIERS = {
  'agent-investor': {
    template_id: 'agent-investor',
    name: 'Investor Specialist',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'agent',
  },
  'agent-classic': {
    template_id: 'agent-classic',
    name: 'Realtor Classic',
    tier: 'basic',
    amount: 2500,
    currency: 'usd',
    professional_type: 'agent',
  },
  'agent-first-home': {
    template_id: 'agent-first-home',
    name: 'First Home Specialist',
    tier: 'standard',
    amount: 7500,
    currency: 'usd',
    professional_type: 'agent',
  },
  'agent-community-expert': {
    template_id: 'agent-community-expert',
    name: 'Community Expert',
    tier: 'standard',
    amount: 7500,
    currency: 'usd',
    professional_type: 'agent',
  },
  'agent-luxury-advisor': {
    template_id: 'agent-luxury-advisor',
    name: 'Luxury Advisor',
    tier: 'premium',
    amount: 9900,
    currency: 'usd',
    professional_type: 'agent',
  },
  'agent-seller-expert': {
    template_id: 'agent-seller-expert',
    name: 'Seller Expert',
    tier: 'premium',
    amount: 9900,
    currency: 'usd',
    professional_type: 'agent',
  },
  'mortgage_broker-classic': {
    template_id: 'mortgage_broker-classic',
    name: 'Mortgage Advisor',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'mortgage_broker',
  },
  'mortgage_broker-first-home': {
    template_id: 'mortgage_broker-first-home',
    name: 'First Home Financing',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'mortgage_broker',
  },
  'mortgage_broker-wealth': {
    template_id: 'mortgage_broker-wealth',
    name: 'Wealth Financing',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'mortgage_broker',
  },
  'mortgage_broker-renewal': {
    template_id: 'mortgage_broker-renewal',
    name: 'Renewal and Refinance',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'mortgage_broker',
  },
  'mortgage_broker-commercial': {
    template_id: 'mortgage_broker-commercial',
    name: 'Commercial Financing',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'mortgage_broker',
  },
  'lawyer-classic': {
    template_id: 'lawyer-classic',
    name: 'Real Estate Counsel',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'lawyer',
  },
  'lawyer-first-home-closing': {
    template_id: 'lawyer-first-home-closing',
    name: 'First Home Closing',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'lawyer',
  },
  'lawyer-investor': {
    template_id: 'lawyer-investor',
    name: 'Investor Counsel',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'lawyer',
  },
  'lawyer-newcomer': {
    template_id: 'lawyer-newcomer',
    name: 'Newcomer Counsel',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'lawyer',
  },
  'lawyer-commercial': {
    template_id: 'lawyer-commercial',
    name: 'Commercial Counsel',
    tier: 'free',
    amount: 0,
    currency: 'usd',
    professional_type: 'lawyer',
  },
};

const FREE_TEMPLATE_IDS = new Set(
  Object.values(STOREFRONT_TEMPLATE_TIERS)
    .filter((template) => template.amount <= 0)
    .map((template) => template.template_id),
);

function normalizeTemplateId(templateId) {
  return String(templateId || '').trim().toLowerCase();
}

function uniqueTemplateIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(normalizeTemplateId).filter(Boolean))];
}

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

export function getStorefrontTemplateTier(templateId) {
  return STOREFRONT_TEMPLATE_TIERS[normalizeTemplateId(templateId)] || null;
}

export function listStorefrontTemplateTiers() {
  return Object.values(STOREFRONT_TEMPLATE_TIERS);
}

export function isStorefrontTemplateFree(templateId) {
  return FREE_TEMPLATE_IDS.has(normalizeTemplateId(templateId));
}

export function storefrontTemplateSupportsProfile(template, profile) {
  return Boolean(
    template
    && profile
    && String(template.professional_type || '') === String(profile.professional_type || ''),
  );
}

export function userHasStorefrontTemplateAccess(profile, templateId) {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  if (!normalizedTemplateId) return false;
  const template = getStorefrontTemplateTier(normalizedTemplateId);
  if (!storefrontTemplateSupportsProfile(template, profile)) return false;
  if (isStorefrontTemplateFree(normalizedTemplateId)) return true;
  const unlocked = uniqueTemplateIds(profile?.storefront?.unlocked_template_ids);
  return unlocked.includes(normalizedTemplateId);
}

export function serializeStorefrontTemplateEntitlements(profile) {
  const compatibleFreeTemplateIds = [...FREE_TEMPLATE_IDS].filter((templateId) => (
    storefrontTemplateSupportsProfile(getStorefrontTemplateTier(templateId), profile)
  ));
  const unlockedTemplateIds = uniqueTemplateIds([
    ...compatibleFreeTemplateIds,
    ...(profile?.storefront?.unlocked_template_ids || []),
  ]);
  return {
    templates: listStorefrontTemplateTiers().map((template) => ({
      ...template,
      unlocked: (
        storefrontTemplateSupportsProfile(template, profile)
        && unlockedTemplateIds.includes(template.template_id)
      ),
      display_amount: template.amount > 0 ? `$${Math.round(template.amount / 100)}` : 'Free',
    })),
    unlocked_template_ids: unlockedTemplateIds,
  };
}

export async function ensureFreeStorefrontTemplateUnlock(profile) {
  profile.storefront = profile.storefront || {};
  const unlocked = uniqueTemplateIds(profile.storefront.unlocked_template_ids);
  let changed = false;
  FREE_TEMPLATE_IDS.forEach((templateId) => {
    if (!storefrontTemplateSupportsProfile(getStorefrontTemplateTier(templateId), profile)) return;
    if (!unlocked.includes(templateId)) {
      unlocked.push(templateId);
      changed = true;
    }
  });
  if (changed) {
    profile.storefront.unlocked_template_ids = unlocked;
  }
  return changed;
}

export async function unlockStorefrontTemplateForUser(userId, templateId, purchase = {}) {
  const template = getStorefrontTemplateTier(templateId);
  if (!template) return null;
  const profileFilter = {
    user_id: userId,
    professional_type: template.professional_type,
  };

  const unlockUpdate = {
    $addToSet: { 'storefront.unlocked_template_ids': template.template_id },
  };
  const checkoutSessionId = String(purchase.stripe_checkout_session_id || '').trim();
  if (template.amount > 0 && !checkoutSessionId) return null;

  if (template.amount > 0 && checkoutSessionId) {
    await PublicProfile.updateOne(
      {
        ...profileFilter,
        'storefront.template_purchases.stripe_checkout_session_id': { $ne: checkoutSessionId },
      },
      {
        ...unlockUpdate,
        $push: {
          'storefront.template_purchases': {
            template_id: template.template_id,
            tier: template.tier,
            amount: Number(purchase.amount ?? template.amount),
            currency: String(purchase.currency || template.currency).toLowerCase(),
            stripe_checkout_session_id: checkoutSessionId,
            stripe_payment_intent_id: purchase.stripe_payment_intent_id || '',
            stripe_invoice_id: purchase.stripe_invoice_id || '',
            purchased_at: purchase.purchased_at || new Date(),
          },
        },
      },
    );
  }

  // This second atomic update is intentional: it also handles a repeated webhook/confirmation
  // whose purchase record already exists without creating a duplicate purchase.
  await PublicProfile.updateOne(profileFilter, unlockUpdate);
  return PublicProfile.findOne(profileFilter);
}

export async function assertStorefrontTemplateAccess(userId, templateId) {
  const profile = await PublicProfile.findOne({ user_id: userId }).lean();
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  const template = getStorefrontTemplateTier(templateId);
  if (!template) return { ok: false, code: 400, message: 'Unsupported storefront template.' };
  if (!storefrontTemplateSupportsProfile(template, profile)) {
    return { ok: false, code: 400, message: 'This template is not available for your professional type.' };
  }
  if (userHasStorefrontTemplateAccess(profile, template.template_id)) return { ok: true };
  return {
    ok: false,
    code: 402,
    message: `${template.name} is a ${template.tier} template. Unlock it for ${template.amount / 100} USD before publishing.`,
    template,
  };
}

export async function getStorefrontTemplateEntitlementsForUser(userId) {
  const profile = await PublicProfile.findOne({ user_id: userId });
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  await ensureFreeStorefrontTemplateUnlock(profile);
  if (profile.isModified('storefront')) await profile.save();
  return { ok: true, entitlements: serializeStorefrontTemplateEntitlements(profile) };
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
    if (unlockedProfile) {
      return { ok: true, alreadyUnlocked: true, template };
    }
  }

  if (reusableCheckout.open) {
    return { ok: true, session: reusableCheckout.open, template, reused: true };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: template.currency,
          unit_amount: template.amount,
          product_data: {
            name: `${template.name} storefront template`,
            description: `${template.tier[0].toUpperCase()}${template.tier.slice(1)} storefront template unlock`,
          },
        },
        quantity: 1,
      },
    ],
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: `${template.name} storefront template unlock`,
        metadata: {
          purchase_type: 'storefront_template',
          user_id: String(user._id),
          template_id: template.template_id,
          tier: template.tier,
        },
      },
    },
    success_url: `${frontendUrl}/dashboard/public-profile?template_checkout=success&template=${encodeURIComponent(template.template_id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/dashboard/public-profile?template_checkout=cancelled&template=${encodeURIComponent(template.template_id)}`,
    metadata: {
      purchase_type: 'storefront_template',
      user_id: String(user._id),
      template_id: template.template_id,
      tier: template.tier,
    },
    payment_intent_data: {
      metadata: {
        purchase_type: 'storefront_template',
        user_id: String(user._id),
        template_id: template.template_id,
        tier: template.tier,
      },
    },
  }, {
    // Concurrent requests receive the same Stripe session. Stripe prunes
    // idempotency records after the Checkout Session's normal expiry window.
    idempotencyKey: ['storefront-template', String(user._id), template.template_id].join(':'),
  });

  return { ok: true, session, template };
}

export async function syncStorefrontTemplateCheckoutSession(session) {
  const validation = validateStorefrontTemplateCheckoutSession(session);
  if (!validation.ok) return null;

  return unlockStorefrontTemplateForUser(validation.userId, validation.template.template_id, {
    amount: Number(session.amount_total || 0),
    currency: String(session.currency || 'usd').toLowerCase(),
    stripe_checkout_session_id: session.id || '',
    stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || '',
    stripe_invoice_id: typeof session.invoice === 'string' ? session.invoice : session.invoice?.id || '',
    purchased_at: session.created ? new Date(session.created * 1000) : new Date(),
  });
}

export function validateStorefrontTemplateCheckoutSession(
  session,
  { userId: expectedUserId = '', templateId: expectedTemplateId = '' } = {},
) {
  if (String(session?.metadata?.purchase_type || '').trim() !== 'storefront_template') {
    return { ok: false, code: 400, message: 'This checkout session is not for a storefront template.' };
  }
  if (String(session?.mode || '').toLowerCase() !== 'payment') {
    return { ok: false, code: 400, message: 'Checkout session is not a one-time template payment.' };
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

  return { ok: true, userId, template };
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
