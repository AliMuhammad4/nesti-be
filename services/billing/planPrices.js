/** Server-owned recurring amounts. Checkout does not read a Stripe product catalog. */

export function normalizeBillingPeriod(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'year' || raw === 'annual' || raw === 'yearly') return 'year';
  return 'month';
}

export function chargeForPlan(plan, billingPeriod) {
  const period = normalizeBillingPeriod(billingPeriod);
  const monthly = Number(plan?.amount);
  const annual = Number(plan?.annual_amount);
  const amount = period === 'year' && Number.isFinite(annual) ? annual : monthly;
  return {
    billingPeriod: period,
    amount,
    interval: period === 'year' ? 'year' : 'month',
    currency: String(plan?.currency || 'usd').trim().toLowerCase() || 'usd',
  };
}

export function recurringPriceData({ name, amount, currency, interval, description }) {
  return {
    currency: currency || 'usd',
    unit_amount: amount,
    recurring: { interval: interval === 'year' ? 'year' : 'month' },
    product_data: {
      name,
      ...(description ? { description } : {}),
    },
  };
}

/** Stripe rejects a trial end that is less than about 48 hours away. */
export function trialEndUnix(trialEnd) {
  const end = trialEnd ? new Date(trialEnd) : null;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) return null;
  const minimum = Math.floor(Date.now() / 1000) + 48 * 60 * 60;
  return Math.max(Math.floor(end.getTime() / 1000), minimum);
}

export async function createRecurringPrice(stripe, { name, amount, currency, interval, metadata }) {
  return stripe.prices.create({
    currency: currency || 'usd',
    unit_amount: amount,
    recurring: { interval: interval === 'year' ? 'year' : 'month' },
    product_data: { name },
    metadata: metadata || {},
  });
}
