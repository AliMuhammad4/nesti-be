export const CLIENT_PLANS = {
  basic: {
    plan_key: 'client_basic',
    tier: 'basic',
    name: 'Basic',
    amount: 999,
    display_amount: '$9.99',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_CLIENT_BASIC',
    features: [
      'Basic homeownership progress tracking',
      'Simple budget calculator',
      'Match with 5 professionals per month',
      'Email support',
    ],
  },
  standard: {
    plan_key: 'client_standard',
    tier: 'standard',
    name: 'Standard',
    amount: 2499,
    display_amount: '$24.99',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_CLIENT_STANDARD',
    features: [
      'Advanced progress tracking',
      'Detailed financial planning tools',
      'Match with 15 professionals per month',
      'Priority matching',
      'Chat support',
    ],
  },
  pro: {
    plan_key: 'client_pro',
    tier: 'pro',
    name: 'Pro',
    amount: 4999,
    display_amount: '$49.99',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_CLIENT_PRO',
    features: [
      'All Standard features',
      'Unlimited professional matching',
      'Premium priority matching',
      'Personalized recommendations',
      'Dedicated support',
      'Exclusive market insights',
    ],
  },
};

export function getClientPlan(tier) {
  return CLIENT_PLANS[String(tier || '').trim().toLowerCase()] || null;
}

export function getClientStripePriceId(tier) {
  const plan = getClientPlan(tier);
  if (!plan) return '';
  return String(process.env[plan.stripe_price_id_env] || '').trim();
}

export function publicClientPlans() {
  return Object.values(CLIENT_PLANS).map(plan => ({
    plan_key: plan.plan_key,
    tier: plan.tier,
    name: plan.name,
    amount: plan.amount,
    display_amount: plan.display_amount,
    currency: plan.currency,
    interval: plan.interval,
    features: plan.features,
    stripe_price_configured: Boolean(getClientStripePriceId(plan.tier)),
  }));
}
