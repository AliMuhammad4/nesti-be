import {
  clientFeaturesForTier,
  clientHasFeature,
  displayFeaturesForTier,
} from './entitlements.js';

export {
  CLIENT_FEATURE,
  CLIENT_FEATURE_LABELS,
  CLIENT_FEATURES_BY_TIER,
  clientFeaturesForTier,
  clientHasFeature,
  displayFeaturesForTier,
  featureLabel,
} from './entitlements.js';

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
    features: displayFeaturesForTier('essential'),
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
    features: displayFeaturesForTier('plus'),
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
    features: displayFeaturesForTier('premium'),
  },
};

const TIER_ALIAS = {
  essential: 'essential',
  basic: 'essential',
  client_basic: 'essential',
  client_essential: 'essential',
  plus: 'plus',
  standard: 'plus',
  client_standard: 'plus',
  client_plus: 'plus',
  premium: 'premium',
  pro: 'premium',
  client_pro: 'premium',
  client_premium: 'premium',
};

export const CLIENT_PLANS = CLIENT_PLAN_LIST;

export function canonicalClientTier(tier) {
  return TIER_ALIAS[String(tier || '').trim().toLowerCase()] || '';
}

export function isSameClientTier(left, right) {
  const a = canonicalClientTier(left);
  const b = canonicalClientTier(right);
  return Boolean(a && b && a === b);
}

export function getClientPlan(tier) {
  const key = canonicalClientTier(tier);
  if (!key) return null;
  const plan = CLIENT_PLAN_LIST[key];
  return plan ? { ...plan, features: displayFeaturesForTier(key), feature_keys: clientFeaturesForTier(key) } : null;
}

export function publicClientPlan(tier) {
  const plan = getClientPlan(tier);
  if (!plan) return null;
  return {
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
    feature_keys: plan.feature_keys,
    stripe_price_configured: true,
  };
}

export function publicClientPlans() {
  return Object.keys(CLIENT_PLAN_LIST).map((tier) => publicClientPlan(tier));
}

export function monthlyMrrCentsForClientSub({ tier, billing_period: billingPeriod } = {}) {
  const plan = getClientPlan(tier);
  if (!plan) return 0;
  const period = String(billingPeriod || 'month').trim().toLowerCase();
  if (period === 'year' || period === 'yearly' || period === 'annual' || period === 'annually') {
    return Math.round(Number(plan.annual_amount || 0) / 12);
  }
  return Number(plan.amount || 0);
}

/**
 * Recommend Essential, Plus, or Premium from the kind of help a visitor asked for.
 * Visible recommendation follows the pre-c27 client wording and assistance choices.
 */
export function recommendClientPlan({ assistance } = {}) {
  const normalizedAssistance = String(assistance || '').trim().toLowerCase();
  if (normalizedAssistance === 'analysis') return 'premium';
  if (normalizedAssistance === 'planning') return 'plus';
  return 'essential';
}

export function clientHasActiveFeature(tier, featureKey, isActive = true) {
  if (!isActive) return false;
  return clientHasFeature(canonicalClientTier(tier), featureKey);
}
