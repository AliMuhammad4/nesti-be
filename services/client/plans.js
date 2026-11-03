const CLIENT_PLAN_LIST = {
  essential: {
    plan_key: 'client_essential',
    tier: 'essential',
    name: 'Essential',
    amount: 2999,
    annual_amount: 28790,
    display_amount: '$29.99',
    annual_display_amount: '$287.90',
    currency: 'usd',
    interval: 'month',
    features: [
      '24/7 RAVI AI Real Estate Assistant',
      'Real estate questions and guidance',
      'Personalized client dashboard',
      'Property goal tracking',
      'Professional discovery and matching',
    ],
  },
  plus: {
    plan_key: 'client_plus',
    tier: 'plus',
    name: 'Plus',
    amount: 4999,
    annual_amount: 47990,
    display_amount: '$49.99',
    annual_display_amount: '$479.90',
    currency: 'usd',
    interval: 'month',
    features: [
      'Everything in Essential',
      'Personalized AI real estate planning',
      'Budget and affordability tools',
      'Savings goal tracking',
      'Buyer, seller, and investor planning tools',
    ],
  },
  premium: {
    plan_key: 'client_premium',
    tier: 'premium',
    name: 'Premium',
    amount: 12900,
    annual_amount: 123840,
    display_amount: '$129',
    annual_display_amount: '$1,238.40',
    currency: 'usd',
    interval: 'month',
    features: [
      'Everything in Plus',
      'Property comparison assistance',
      'Investment scenario calculators',
      'Priority AI assistance',
      'Closing milestone tracking',
    ],
  },
};

const TIER_ALIAS = {
  essential: 'essential',
  basic: 'essential',
  plus: 'plus',
  standard: 'plus',
  premium: 'premium',
  pro: 'premium',
};

export const CLIENT_PLANS = CLIENT_PLAN_LIST;

export function canonicalClientTier(tier) {
  return TIER_ALIAS[String(tier || '').trim().toLowerCase()] || '';
}

export function getClientPlan(tier) {
  const key = canonicalClientTier(tier);
  return key ? CLIENT_PLAN_LIST[key] : null;
}

export function publicClientPlans() {
  return Object.values(CLIENT_PLAN_LIST).map((plan) => ({
    plan_key: plan.plan_key,
    tier: plan.tier,
    name: plan.name,
    amount: plan.amount,
    annual_amount: plan.annual_amount,
    display_amount: plan.display_amount,
    annual_display_amount: plan.annual_display_amount,
    currency: plan.currency,
    interval: plan.interval,
    features: plan.features,
    stripe_price_configured: true,
  }));
}
