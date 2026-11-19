import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStorefrontTemplateTier,
  selectReusableStorefrontTemplateCheckout,
  serializePaidTemplateSubscriptions,
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

test('specialty templates added in the latest catalog are paid and role-scoped', () => {
  assert.deepEqual(
    [
      'agent-newcomer',
      'agent-commercial',
      'agent-premium-estate',
      'agent-neighborhood',
      'agent-realest-prime',
      'agent-realest-path',
      'mortgage_broker-investor',
      'mortgage_broker-newcomer',
      'mortgage_broker-clarity',
      'mortgage_broker-beacon',
      'mortgage_broker-ember',
      'mortgage_broker-spotlight',
      'mortgage_broker-aurora',
      'lawyer-commercial',
      'lawyer-seller-refinance',
    ].map((templateId) => {
      const template = getStorefrontTemplateTier(templateId);
      return {
        id: template?.template_id,
        tier: template?.tier,
        amount: template?.amount,
        professional_type: template?.professional_type,
      };
    }),
    [
      { id: 'agent-newcomer', tier: 'standard', amount: 7500, professional_type: 'agent' },
      { id: 'agent-commercial', tier: 'premium', amount: 9900, professional_type: 'agent' },
      { id: 'agent-premium-estate', tier: 'premium', amount: 9900, professional_type: 'agent' },
      { id: 'agent-neighborhood', tier: 'premium', amount: 9900, professional_type: 'agent' },
      { id: 'agent-realest-prime', tier: 'premium', amount: 9900, professional_type: 'agent' },
      { id: 'agent-realest-path', tier: 'premium', amount: 9900, professional_type: 'agent' },
      { id: 'mortgage_broker-investor', tier: 'standard', amount: 7500, professional_type: 'mortgage_broker' },
      { id: 'mortgage_broker-newcomer', tier: 'standard', amount: 7500, professional_type: 'mortgage_broker' },
      { id: 'mortgage_broker-clarity', tier: 'standard', amount: 7500, professional_type: 'mortgage_broker' },
      { id: 'mortgage_broker-beacon', tier: 'standard', amount: 7500, professional_type: 'mortgage_broker' },
      { id: 'mortgage_broker-ember', tier: 'standard', amount: 7500, professional_type: 'mortgage_broker' },
      { id: 'mortgage_broker-spotlight', tier: 'standard', amount: 7500, professional_type: 'mortgage_broker' },
      { id: 'mortgage_broker-aurora', tier: 'standard', amount: 7500, professional_type: 'mortgage_broker' },
      { id: 'lawyer-commercial', tier: 'premium', amount: 9900, professional_type: 'lawyer' },
      { id: 'lawyer-seller-refinance', tier: 'standard', amount: 7500, professional_type: 'lawyer' },
    ],
  );
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
        current_period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
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
        current_period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
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

test('overdue template subscriptions stay on the billing list without access', () => {
  const profile = {
    professional_type: 'agent',
    storefront: {
      template_purchases: [{
        template_id: 'agent-classic',
        stripe_subscription_id: 'sub_overdue',
        stripe_invoice_id: 'in_overdue',
        subscription_status: 'past_due',
        current_period_end: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        purchased_at: new Date(),
      }],
    },
  };
  assert.equal(userHasStorefrontTemplateAccess(profile, 'agent-classic'), false);
  const [row] = serializePaidTemplateSubscriptions(profile);
  assert.equal(row.template_id, 'agent-classic');
  assert.equal(row.status, 'past_due');
  assert.equal(row.manageable, false);
  assert.equal(row.stripe_subscription_id, 'sub_overdue');
  assert.equal(row.stripe_invoice_id, 'in_overdue');
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

test('checkout-only template purchases do not grant access without a subscription id', () => {
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
  assert.equal(userHasStorefrontTemplateAccess(inPeriod, 'agent-classic'), false);
  assert.equal(userHasStorefrontTemplateAccess(expired, 'agent-classic'), false);

  const entitlements = serializeStorefrontTemplateEntitlements(inPeriod);
  const classic = entitlements.templates.find((item) => item.template_id === 'agent-classic');
  assert.equal(classic.unlocked, false);
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
  const purchasedAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
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
  const expected = new Date(purchasedAt);
  expected.setMonth(expected.getMonth() + 1);
  const renewsAt = new Date(seller.subscription.current_period_end);
  assert.equal(renewsAt.getUTCFullYear(), expected.getUTCFullYear());
  assert.equal(renewsAt.getUTCMonth(), expected.getUTCMonth());
  assert.equal(renewsAt.getUTCDate(), expected.getUTCDate());
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

test('template access ends immediately on past_due and when the period has ended', async () => {
  const { templatePurchaseGrantsAccess } = await import('../services/billing/storefrontTemplates/access.js');
  const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 60 * 1000);
  assert.equal(templatePurchaseGrantsAccess({
    stripe_subscription_id: 'sub_1',
    subscription_status: 'active',
    current_period_end: future,
    purchased_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  }), true);
  assert.equal(templatePurchaseGrantsAccess({
    stripe_subscription_id: 'sub_1',
    subscription_status: 'past_due',
    current_period_end: future,
    purchased_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  }), false);
  assert.equal(templatePurchaseGrantsAccess({
    stripe_subscription_id: 'sub_1',
    subscription_status: 'active',
    current_period_end: past,
    purchased_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  }), false);
  assert.equal(templatePurchaseGrantsAccess({
    stripe_checkout_session_id: 'cs_only',
    subscription_status: 'active',
    current_period_end: future,
  }), false);
});

test('past_due and unpaid template purchases are refreshed from Stripe even when the period is still open', async () => {
  const { purchaseNeedsStripe } = await import('../services/billing/storefrontTemplates/refresh.js');
  const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const justSynced = new Date();
  const base = {
    template_id: 'agent-classic',
    stripe_subscription_id: 'sub_1',
    current_period_end: future,
    last_synced_at: justSynced,
  };
  assert.equal(purchaseNeedsStripe({ ...base, subscription_status: 'active' }), false);
  assert.equal(purchaseNeedsStripe({ ...base, subscription_status: 'past_due' }), true);
  assert.equal(purchaseNeedsStripe({ ...base, subscription_status: 'unpaid' }), true);
});

test('template checkout is blocked for incomplete or active Stripe subscriptions of the same template only', async () => {
  const { isBlockingStorefrontTemplateStripeSubscription } = await import('../services/billing/storefrontTemplates/checkout.js');
  const incompleteSame = {
    id: 'sub_incomplete',
    status: 'incomplete',
    metadata: { purchase_type: 'storefront_template', template_id: 'agent-classic' },
  };
  const activeOther = {
    id: 'sub_other',
    status: 'active',
    metadata: { purchase_type: 'storefront_template', template_id: 'agent-modern' },
  };
  const professional = {
    id: 'sub_pro',
    status: 'active',
    metadata: { subscription_type: 'professional' },
  };
  assert.equal(isBlockingStorefrontTemplateStripeSubscription(incompleteSame, 'agent-classic'), true);
  assert.equal(isBlockingStorefrontTemplateStripeSubscription(activeOther, 'agent-classic'), false);
  assert.equal(isBlockingStorefrontTemplateStripeSubscription(professional, 'agent-classic'), false);
});

test('cancels leftover incomplete subscriptions for that template only and issues a new idempotency key', async () => {
  const { cancelIncompleteStripeSubscriptions, buildCheckoutIdempotencyKey } = await import('../services/billing/subscriptionShared.js');
  const { isStorefrontTemplateStripeSubscription } = await import('../services/billing/storefrontTemplates/checkout.js');
  const canceled = [];
  const stripe = {
    subscriptions: {
      list: async () => ({
        data: [
          { id: 'sub_same', status: 'incomplete', metadata: { purchase_type: 'storefront_template', template_id: 'agent-classic' } },
          { id: 'sub_other', status: 'incomplete', metadata: { purchase_type: 'storefront_template', template_id: 'agent-modern' } },
          { id: 'sub_pro', status: 'incomplete', metadata: { subscription_type: 'professional' } },
        ],
      }),
      cancel: async (id) => {
        canceled.push(id);
        return { id, status: 'canceled' };
      },
    },
  };
  const cancelledIds = await cancelIncompleteStripeSubscriptions(
    stripe,
    'cus_123',
    (sub) => isStorefrontTemplateStripeSubscription(sub, 'agent-classic'),
  );
  assert.deepEqual(canceled, ['sub_same']);
  assert.deepEqual(cancelledIds, ['sub_same']);

  const now = 1888888 * 15 * 60 * 1000;
  const before = buildCheckoutIdempotencyKey({
    kind: 'storefront-template',
    userId: 'user1',
    planKey: 'agent-classic',
    billingPeriod: 'month',
    now,
  });
  const after = buildCheckoutIdempotencyKey({
    kind: 'storefront-template',
    userId: 'user1',
    planKey: 'agent-classic',
    billingPeriod: 'month',
    now,
    leftoverSubscriptionIds: cancelledIds,
  });
  assert.notEqual(before, after);
  assert.match(after, /sub_same$/);
});

test('older template events do not replace a newer status or period end', async () => {
  const { templateStripeSnapshotIsStale, invoiceIsStorefrontTemplate } = await import('../services/billing/storefrontTemplates/unlock.js');
  const existing = {
    subscription_status: 'active',
    current_period_end: new Date('2026-12-01T00:00:00.000Z'),
    stripe_last_event_created: 200,
  };
  assert.equal(templateStripeSnapshotIsStale(existing, {
    status: 'past_due',
    current_period_end: Math.floor(new Date('2026-12-01T00:00:00.000Z').getTime() / 1000),
  }, { eventCreated: 100 }), true);
  assert.equal(templateStripeSnapshotIsStale(existing, {
    status: 'canceled',
    current_period_end: Math.floor(new Date('2026-06-01T00:00:00.000Z').getTime() / 1000),
  }, { eventCreated: 250 }), false);
  assert.equal(templateStripeSnapshotIsStale({
    current_period_end: new Date('2026-12-01T00:00:00.000Z'),
    stripe_last_event_created: 0,
  }, {
    status: 'active',
    current_period_end: Math.floor(new Date('2026-08-01T00:00:00.000Z').getTime() / 1000),
  }, {}), true);
  assert.equal(invoiceIsStorefrontTemplate({
    lines: { data: [{ metadata: { purchase_type: 'storefront_template', template_id: 'agent-classic' } }] },
  }), true);
  assert.equal(invoiceIsStorefrontTemplate({ metadata: { subscription_type: 'professional' } }), false);
});

test('a missing incomplete subscription still shares the checkout idempotency key', async () => {
  const { cancelIncompleteStripeSubscriptions, buildCheckoutIdempotencyKey } = await import('../services/billing/subscriptionShared.js');
  const stripe = {
    subscriptions: {
      list: async () => ({
        data: [{ id: 'sub_gone', status: 'incomplete', metadata: { subscription_type: 'professional' } }],
      }),
      cancel: async () => {
        const error = new Error('No such subscription');
        error.code = 'resource_missing';
        throw error;
      },
    },
  };
  const { isStripeResourceMissing } = await import('../services/billing/subscriptionShared.js');
  assert.equal(isStripeResourceMissing({ code: 'resource_missing' }), true);
  const listedIds = await cancelIncompleteStripeSubscriptions(
    stripe,
    'cus_123',
    (sub) => String(sub.metadata?.subscription_type || '') === 'professional',
  );
  assert.deepEqual(listedIds, ['sub_gone']);
  const key = buildCheckoutIdempotencyKey({
    kind: 'professional-checkout',
    userId: 'user1',
    planKey: 'pro',
    billingPeriod: 'month',
    now: 1888888 * 15 * 60 * 1000,
    leftoverSubscriptionIds: listedIds,
  });
  assert.match(key, /sub_gone$/);
});
