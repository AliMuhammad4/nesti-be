export const BILLING_PLANS = {
  basic: {
    plan_key: 'basic',
    name: 'Basic',
    amount: 20000,
    annual_amount: 192000,
    display_amount: '$200',
    annual_display_amount: '$1,920',
    currency: 'usd',
    interval: 'month',
    placement_priority: 5,
  },
  standard: {
    plan_key: 'standard',
    name: 'Standard',
    amount: 30000,
    annual_amount: 288000,
    display_amount: '$300',
    annual_display_amount: '$2,880',
    currency: 'usd',
    interval: 'month',
    placement_priority: 10,
  },
  enterprise: {
    plan_key: 'enterprise',
    name: 'Enterprise',
    amount: 60000,
    annual_amount: 576000,
    display_amount: '$600',
    annual_display_amount: '$5,760',
    currency: 'usd',
    interval: 'month',
    placement_priority: 20,
  },
};

/** Legacy Stripe price ids from older checkouts. New checkout uses custom price_data. */
const LEGACY_STRIPE_PRICE_ENV = Object.freeze({
  basic: 'STRIPE_PRICE_BASIC',
  standard: 'STRIPE_PRICE_STANDARD',
  enterprise: 'STRIPE_PRICE_ENTERPRISE',
});

export function getPlan(planKey) {
  return BILLING_PLANS[String(planKey || '').trim().toLowerCase()] || null;
}

export function getPlanByPriceId(priceId) {
  const normalizedPriceId = String(priceId || '').trim();
  if (!normalizedPriceId) return null;
  for (const [planKey, envName] of Object.entries(LEGACY_STRIPE_PRICE_ENV)) {
    if (String(process.env[envName] || '').trim() === normalizedPriceId) {
      return getPlan(planKey);
    }
  }
  return null;
}

const PLAN_TIER_ORDER = {
  basic: 1,
  standard: 2,
  enterprise: 3,
};

export function getPlanTier(planKey) {
  return PLAN_TIER_ORDER[String(planKey || '').trim().toLowerCase()] || 0;
}

export function getPlacementPriority(planKey) {
  const plan = getPlan(planKey);
  return plan?.placement_priority || 0;
}

function serializeFallbackPlan(plan) {
  return {
    plan_key: plan.plan_key,
    name: plan.name,
    amount: plan.amount,
    annual_amount: plan.annual_amount,
    display_amount: plan.display_amount,
    annual_display_amount: plan.annual_display_amount,
    currency: plan.currency,
    interval: plan.interval,
    stripe_price_configured: true,
  };
}

export function publicBillingPlans() {
  return Object.values(BILLING_PLANS).map(serializeFallbackPlan);
}

export async function publicBillingPlansFromStripe() {
  return publicBillingPlans();
}
