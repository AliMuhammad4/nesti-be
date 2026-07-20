export const BILLING_PLANS = {
  basic: {
    plan_key: 'basic',
    name: 'Basic',
    amount: 15000,
    display_amount: '$150',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_BASIC',
    placement_priority: 5,
  },
  standard: {
    plan_key: 'standard',
    name: 'Standard',
    amount: 30000,
    display_amount: '$300',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_STANDARD',
    placement_priority: 10,
  },
  enterprise: {
    plan_key: 'enterprise',
    name: 'Enterprise',
    amount: 60000,
    display_amount: '$600',
    currency: 'usd',
    interval: 'month',
    stripe_price_id_env: 'STRIPE_PRICE_ENTERPRISE',
    placement_priority: 20,
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

export function getPlacementPriority(planKey) {
  const plan = getPlan(planKey);
  return plan?.placement_priority || 0;
}

function formatStripeAmount(amount, currency = 'usd') {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return '';
  const normalizedCurrency = String(currency || 'usd').trim().toUpperCase() || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: value % 100 === 0 ? 0 : 2,
    }).format(value / 100);
  } catch {
    return `${normalizedCurrency} ${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}`;
  }
}

function serializeFallbackPlan(plan) {
  return {
    plan_key: plan.plan_key,
    name: plan.name,
    amount: plan.amount,
    display_amount: plan.display_amount,
    currency: plan.currency,
    interval: plan.interval,
    stripe_price_configured: Boolean(getStripePriceId(plan.plan_key)),
  };
}

function intervalFromStripePrice(price) {
  return String(price?.recurring?.interval || '').trim() || String(price?.type || '').trim() || 'month';
}

function productNameFromStripePrice(price, fallback) {
  const product = price?.product && typeof price.product === 'object' ? price.product : null;
  return String(product?.name || fallback || '').trim() || fallback;
}

function serializeStripePlan(plan, price) {
  const amount = price?.unit_amount ?? price?.unit_amount_decimal;
  const numericAmount = Number(amount);
  const currency = String(price?.currency || plan.currency || 'usd').trim().toLowerCase() || 'usd';
  const priceIsUsable = Number.isFinite(numericAmount) && numericAmount >= 0;
  return {
    plan_key: plan.plan_key,
    name: productNameFromStripePrice(price, plan.name),
    amount: priceIsUsable ? numericAmount : plan.amount,
    display_amount: priceIsUsable ? formatStripeAmount(numericAmount, currency) : plan.display_amount,
    currency,
    interval: intervalFromStripePrice(price),
    stripe_price_configured: true,
    stripe_price_id: String(price?.id || getStripePriceId(plan.plan_key)).trim(),
    stripe_product_id:
      typeof price?.product === 'string'
        ? price.product
        : String(price?.product?.id || '').trim() || null,
  };
}

export function publicBillingPlans() {
  return Object.values(BILLING_PLANS).map(serializeFallbackPlan);
}

export async function publicBillingPlansFromStripe(stripe) {
  const planRows = await Promise.all(
    Object.values(BILLING_PLANS).map(async (plan) => {
      const priceId = getStripePriceId(plan.plan_key);
      if (!priceId) return serializeFallbackPlan(plan);
      try {
        const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
        return serializeStripePlan(plan, price);
      } catch {
        return serializeFallbackPlan(plan);
      }
    }),
  );
  return planRows;
}
