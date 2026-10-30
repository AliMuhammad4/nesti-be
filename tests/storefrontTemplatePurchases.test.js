import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStorefrontTemplateTier,
  selectReusableStorefrontTemplateCheckout,
  serializeStorefrontTemplateEntitlements,
  userHasStorefrontTemplateAccess,
  validateStorefrontTemplateCheckoutSession,
} from '../services/billing/storefrontTemplatePurchases.js';

function paidTemplateSession(overrides = {}) {
  return {
    id: 'cs_test_template',
    mode: 'subscription',
    payment_status: 'paid',
    amount_total: 2500,
    currency: 'usd',
    subscription: 'sub_test_template',
    metadata: {
      purchase_type: 'storefront_template',
      user_id: 'user-1',
      template_id: 'agent-classic',
    },
    ...overrides,
  };
}

test('template checkout confirmation accepts a matching paid Stripe subscription session', () => {
  const result = validateStorefrontTemplateCheckoutSession(paidTemplateSession(), {
    userId: 'user-1',
    templateId: 'agent-classic',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'subscription');
  assert.equal(result.template.template_id, 'agent-classic');
});

test('template checkout confirmation rejects a session owned by another account', () => {
  const result = validateStorefrontTemplateCheckoutSession(paidTemplateSession(), {
    userId: 'user-2',
    templateId: 'agent-classic',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 403);
});

test('template checkout confirmation waits for a paid payment status', () => {
  const result = validateStorefrontTemplateCheckoutSession(
    paidTemplateSession({ payment_status: 'unpaid' }),
    { userId: 'user-1', templateId: 'agent-classic' },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 409);
});

test('template checkout confirmation rejects a mismatched template or amount', () => {
  const wrongTemplate = validateStorefrontTemplateCheckoutSession(paidTemplateSession(), {
    userId: 'user-1',
    templateId: 'agent-luxury-advisor',
  });
  const wrongAmount = validateStorefrontTemplateCheckoutSession(
    paidTemplateSession({ amount_total: 100 }),
    { userId: 'user-1', templateId: 'agent-classic' },
  );

  assert.equal(wrongTemplate.ok, false);
  assert.equal(wrongTemplate.code, 400);
  assert.equal(wrongAmount.ok, false);
  assert.equal(wrongAmount.code, 409);
});

test('template access enforces professional type and monthly subscription status', () => {
  const agentProfile = {
    professional_type: 'agent',
    storefront: {
      unlocked_template_ids: ['agent-classic'],
      template_purchases: [{
        template_id: 'agent-classic',
        stripe_subscription_id: 'sub_1',
        subscription_status: 'active',
      }],
    },
  };
  const canceledAgent = {
    professional_type: 'agent',
    storefront: {
      unlocked_template_ids: ['agent-classic'],
      template_purchases: [{
        template_id: 'agent-classic',
        stripe_subscription_id: 'sub_1',
        subscription_status: 'canceled',
      }],
    },
  };
  const lawyerProfile = {
    professional_type: 'lawyer',
    storefront: { unlocked_template_ids: [], template_purchases: [] },
  };

  assert.equal(userHasStorefrontTemplateAccess(agentProfile, 'agent-classic'), true);
  assert.equal(userHasStorefrontTemplateAccess(canceledAgent, 'agent-classic'), false);
  assert.equal(userHasStorefrontTemplateAccess(lawyerProfile, 'agent-classic'), false);
  assert.equal(userHasStorefrontTemplateAccess(lawyerProfile, 'lawyer-newcomer'), true);
  assert.equal(userHasStorefrontTemplateAccess(lawyerProfile, 'lawyer-classic'), false);
  assert.equal(userHasStorefrontTemplateAccess(lawyerProfile, 'lawyer-investor'), false);

  const brokerProfile = {
    professional_type: 'mortgage_broker',
    storefront: { unlocked_template_ids: [], template_purchases: [] },
  };
  assert.equal(userHasStorefrontTemplateAccess(brokerProfile, 'mortgage_broker-renewal'), true);
  assert.equal(userHasStorefrontTemplateAccess(brokerProfile, 'mortgage_broker-classic'), false);
  assert.equal(userHasStorefrontTemplateAccess(brokerProfile, 'mortgage_broker-first-home'), false);
  assert.equal(userHasStorefrontTemplateAccess(brokerProfile, 'mortgage_broker-commercial'), false);
});

test('lawyer template tiers match free newcomer and paid investor classic first-home', () => {
  assert.deepEqual(
    [
      getStorefrontTemplateTier('lawyer-newcomer'),
      getStorefrontTemplateTier('lawyer-investor'),
      getStorefrontTemplateTier('lawyer-classic'),
      getStorefrontTemplateTier('lawyer-first-home-closing'),
    ].map((template) => ({
      id: template.template_id,
      tier: template.tier,
      amount: template.amount,
      interval: template.interval,
    })),
    [
      { id: 'lawyer-newcomer', tier: 'free', amount: 0, interval: 'month' },
      { id: 'lawyer-investor', tier: 'basic', amount: 2500, interval: 'month' },
      { id: 'lawyer-classic', tier: 'standard', amount: 7500, interval: 'month' },
      { id: 'lawyer-first-home-closing', tier: 'premium', amount: 9900, interval: 'month' },
    ],
  );
});

test('broker template tiers match free renewal and paid classic first-home commercial', () => {
  assert.deepEqual(
    [
      getStorefrontTemplateTier('mortgage_broker-renewal'),
      getStorefrontTemplateTier('mortgage_broker-classic'),
      getStorefrontTemplateTier('mortgage_broker-first-home'),
      getStorefrontTemplateTier('mortgage_broker-commercial'),
    ].map((template) => ({
      id: template.template_id,
      tier: template.tier,
      amount: template.amount,
      interval: template.interval,
    })),
    [
      { id: 'mortgage_broker-renewal', tier: 'free', amount: 0, interval: 'month' },
      { id: 'mortgage_broker-classic', tier: 'basic', amount: 2500, interval: 'month' },
      { id: 'mortgage_broker-first-home', tier: 'standard', amount: 7500, interval: 'month' },
      { id: 'mortgage_broker-commercial', tier: 'premium', amount: 9900, interval: 'month' },
    ],
  );
});

test('broker entitlements unlock free renewal and lock paid templates without subscription', () => {
  const entitlements = serializeStorefrontTemplateEntitlements({
    professional_type: 'mortgage_broker',
    storefront: {
      template_purchases: [{
        template_id: 'mortgage_broker-classic',
        stripe_subscription_id: 'sub_broker',
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_end: new Date('2026-09-30T00:00:00.000Z'),
      }],
    },
  });
  const renewal = entitlements.templates.find((item) => item.template_id === 'mortgage_broker-renewal');
  const classic = entitlements.templates.find((item) => item.template_id === 'mortgage_broker-classic');
  const firstHome = entitlements.templates.find((item) => item.template_id === 'mortgage_broker-first-home');
  const commercial = entitlements.templates.find((item) => item.template_id === 'mortgage_broker-commercial');

  assert.equal(renewal.unlocked, true);
  assert.equal(renewal.display_amount, 'Free');
  assert.equal(classic.unlocked, true);
  assert.equal(classic.display_amount, '$25/mo');
  assert.equal(firstHome.unlocked, false);
  assert.equal(firstHome.display_amount, '$75/mo');
  assert.equal(commercial.unlocked, false);
  assert.equal(commercial.display_amount, '$99/mo');
});

test('entitlements display monthly pricing and unlock only active subscriptions', () => {
  const entitlements = serializeStorefrontTemplateEntitlements({
    professional_type: 'lawyer',
    storefront: {
      template_purchases: [{
        template_id: 'lawyer-investor',
        stripe_subscription_id: 'sub_lawyer',
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_end: new Date('2026-09-30T00:00:00.000Z'),
      }],
    },
  });
  const investor = entitlements.templates.find((item) => item.template_id === 'lawyer-investor');
  const classic = entitlements.templates.find((item) => item.template_id === 'lawyer-classic');
  const newcomer = entitlements.templates.find((item) => item.template_id === 'lawyer-newcomer');

  assert.equal(investor.unlocked, true);
  assert.equal(investor.display_amount, '$25/mo');
  assert.equal(investor.subscription?.manageable, true);
  assert.equal(investor.subscription?.legacy_lifetime, false);
  assert.equal(investor.subscription?.cancel_at_period_end, false);
  assert.equal(classic.unlocked, false);
  assert.equal(classic.display_amount, '$75/mo');
  assert.equal(newcomer.unlocked, true);
  assert.equal(newcomer.display_amount, 'Free');
});

test('canceled template subscriptions expose non-manageable locked entitlements', () => {
  const entitlements = serializeStorefrontTemplateEntitlements({
    professional_type: 'agent',
    storefront: {
      template_purchases: [{
        template_id: 'agent-classic',
        stripe_subscription_id: 'sub_agent',
        subscription_status: 'canceled',
        cancel_at_period_end: false,
      }],
    },
  });
  const classic = entitlements.templates.find((item) => item.template_id === 'agent-classic');
  assert.equal(classic.unlocked, false);
  assert.equal(classic.subscription?.manageable, false);
  assert.equal(classic.subscription?.status, 'canceled');
});

test('template checkout reuses an existing open session instead of creating another charge path', () => {
  const openSession = {
    id: 'cs_open',
    status: 'open',
    payment_status: 'unpaid',
    url: 'https://checkout.stripe.test/open',
    metadata: {
      purchase_type: 'storefront_template',
      user_id: 'user-1',
      template_id: 'agent-classic',
    },
  };
  const unrelatedSession = {
    ...openSession,
    id: 'cs_other',
    metadata: { ...openSession.metadata, template_id: 'agent-first-home' },
  };

  const result = selectReusableStorefrontTemplateCheckout(
    [unrelatedSession, openSession],
    'user-1',
    'agent-classic',
  );

  assert.equal(result.open?.id, 'cs_open');
  assert.equal(result.paid, null);
});

test('template checkout reconciles a completed paid session before opening another session', () => {
  const paidSession = paidTemplateSession({ status: 'complete' });
  const result = selectReusableStorefrontTemplateCheckout(
    [paidSession],
    'user-1',
    'agent-classic',
  );

  assert.equal(result.paid?.id, 'cs_test_template');
  assert.equal(result.open, null);
});

test('checkout-only template purchases stay accessible through the current monthly period', () => {
  const inPeriod = {
    professional_type: 'agent',
    storefront: {
      template_purchases: [{
        template_id: 'agent-classic',
        stripe_checkout_session_id: 'cs_monthly',
        stripe_subscription_id: '',
        purchased_at: new Date(),
      }],
    },
  };
  const expired = {
    professional_type: 'agent',
    storefront: {
      template_purchases: [{
        template_id: 'agent-classic',
        stripe_checkout_session_id: 'cs_expired',
        stripe_subscription_id: '',
        purchased_at: new Date('2024-01-01T00:00:00.000Z'),
      }],
    },
  };
  assert.equal(userHasStorefrontTemplateAccess(inPeriod, 'agent-classic'), true);
  assert.equal(userHasStorefrontTemplateAccess(expired, 'agent-classic'), false);

  const entitlements = serializeStorefrontTemplateEntitlements(inPeriod);
  const classic = entitlements.templates.find((item) => item.template_id === 'agent-classic');
  assert.equal(classic.subscription?.legacy_lifetime, false);
  assert.equal(classic.subscription?.status, 'active');
  assert.equal(classic.subscription?.billing_interval, 'month');
  assert.equal(classic.subscription?.manageable, false);
  assert.equal(Boolean(classic.subscription?.current_period_end), true);
  const renewsAt = new Date(classic.subscription.current_period_end);
  const purchaseDay = new Date(inPeriod.storefront.template_purchases[0].purchased_at);
  assert.equal(renewsAt.getMonth() !== purchaseDay.getMonth() || renewsAt.getFullYear() !== purchaseDay.getFullYear(), true);
});

test('same-day period end is treated as the next monthly cycle', () => {
  const purchasedAt = new Date('2026-09-18T10:00:00.000Z');
  const entitlements = serializeStorefrontTemplateEntitlements({
    professional_type: 'agent',
    storefront: {
      template_purchases: [{
        template_id: 'agent-seller-expert',
        stripe_subscription_id: 'sub_seller',
        stripe_checkout_session_id: 'cs_seller',
        subscription_status: 'active',
        purchased_at: purchasedAt,
        current_period_end: purchasedAt,
      }],
    },
  });
  const seller = entitlements.templates.find((item) => item.template_id === 'agent-seller-expert');
  assert.equal(seller.unlocked, true);
  const renewsAt = new Date(seller.subscription.current_period_end);
  assert.equal(renewsAt.getUTCFullYear(), 2026);
  assert.equal(renewsAt.getUTCMonth(), 9);
  assert.equal(renewsAt.getUTCDate(), 18);
});

test('storefront template metadata is detected from purchase_type or subscription_type', async () => {
  const { isStorefrontTemplateStripeMetadata } = await import('../services/billing/storefrontTemplates/unlock.js');
  assert.equal(isStorefrontTemplateStripeMetadata({ purchase_type: 'storefront_template' }), true);
  assert.equal(isStorefrontTemplateStripeMetadata({ subscription_type: 'storefront_template' }), true);
  assert.equal(isStorefrontTemplateStripeMetadata({ subscription_type: 'professional' }), false);
});

test('template period end reads Stripe item dates when subscription root has none', async () => {
  const { getStripeSubscriptionPeriodEnd } = await import('../services/billing/subscriptionShared.js');
  const end = getStripeSubscriptionPeriodEnd({
    items: {
      data: [{ current_period_end: 1780000000 }],
    },
  });
  assert.equal(end instanceof Date, true);
  assert.equal(end.getTime(), 1780000000 * 1000);
});
