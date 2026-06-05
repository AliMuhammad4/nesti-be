export const BILLING_PLANS = {
  basic: {
    plan_key: 'basic',
    name: 'Basic',
    amount: 15000,
    display_amount: '$150',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_BASIC',
  },
  standard: {
    plan_key: 'standard',
    name: 'Standard',
    amount: 30000,
    display_amount: '$300',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_STANDARD',
  },
  enterprise: {
    plan_key: 'enterprise',
    name: 'Enterprise',
    amount: 60000,
    display_amount: '$600',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_ENTERPRISE',
  },
};

export function getPlan(planKey) {
  return BILLING_PLANS[String(planKey || '').trim().toLowerCase()] || null;
}

export function getPlanByPriceId(priceId) {
  const normalizedPriceId = String(priceId || '').trim();
  if (!normalizedPriceId) return null;
  return Object.values(BILLING_PLANS).find(
    (plan) => String(process.env[plan.stripe_price_id_env] || '').trim() === normalizedPriceId,
  ) || null;
}

export function getStripePriceId(planKey) {
  const plan = getPlan(planKey);
  if (!plan) return '';
  return String(process.env[plan.stripe_price_id_env] || '').trim();
}

const PLAN_TIER_ORDER = {
  basic: 1,
  standard: 2,
  enterprise: 3,
};

export function getPlanTier(planKey) {
  return PLAN_TIER_ORDER[String(planKey || '').trim().toLowerCase()] || 0;
}

export function publicBillingPlans() {
  return Object.values(BILLING_PLANS).map((plan) => ({
    plan_key: plan.plan_key,
    name: plan.name,
    amount: plan.amount,
    display_amount: plan.display_amount,
    currency: plan.currency,
    interval: plan.interval,
    stripe_price_configured: Boolean(getStripePriceId(plan.plan_key)),
  }));
}
