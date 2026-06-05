import Stripe from 'stripe';

let stripe;

export function getStripeClient() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (!stripe) {
    const apiVersion = String(process.env.STRIPE_API_VERSION || Stripe.API_VERSION).trim();
    stripe = new Stripe(secretKey, { apiVersion });
  }
  return stripe;
}
