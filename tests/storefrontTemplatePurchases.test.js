import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectReusableStorefrontTemplateCheckout,
  userHasStorefrontTemplateAccess,
  validateStorefrontTemplateCheckoutSession,
} from '../services/billing/storefrontTemplatePurchases.js';

function paidTemplateSession(overrides = {}) {
  return {
    id: 'cs_test_template',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 2500,
    currency: 'usd',
    metadata: {
      purchase_type: 'storefront_template',
      user_id: 'user-1',
      template_id: 'agent-classic',
    },
    ...overrides,
  };
}

test('template checkout confirmation accepts a matching paid Stripe session', () => {
  const result = validateStorefrontTemplateCheckoutSession(paidTemplateSession(), {
    userId: 'user-1',
    templateId: 'agent-classic',
  });

  assert.equal(result.ok, true);
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

test('template access enforces the professional type for paid and free templates', () => {
  const agentProfile = {
    professional_type: 'agent',
    storefront: { unlocked_template_ids: ['agent-classic'] },
  };
  const lawyerProfile = {
    professional_type: 'lawyer',
    storefront: { unlocked_template_ids: [] },
  };

  assert.equal(userHasStorefrontTemplateAccess(agentProfile, 'agent-classic'), true);
  assert.equal(userHasStorefrontTemplateAccess(lawyerProfile, 'agent-classic'), false);
  assert.equal(userHasStorefrontTemplateAccess(lawyerProfile, 'lawyer-classic'), true);
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
