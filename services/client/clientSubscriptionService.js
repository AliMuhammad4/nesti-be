import ClientSubscription from '../../models/ClientSubscription.js';
import User from '../../models/User.js';
import { getClientPlan } from './plans.js';
import { getStripeClient } from '../billing/stripeClient.js';

// Cache for dynamically created prices
const priceCache = new Map();

async function getOrCreateStripePrice(stripe, plan) {
  const cacheKey = `client_${plan.tier}`;
  
  if (priceCache.has(cacheKey)) {
    return priceCache.get(cacheKey);
  }

  try {
    const productName = `Nesti Client ${plan.name}`;
    
    const products = await stripe.products.search({
      query: `name:'${productName}'`,
      limit: 1,
    });

    let product;
    if (products.data.length > 0) {
      product = products.data[0];
    } else {
      product = await stripe.products.create({
        name: productName,
        description: `${plan.name} tier client subscription`,
        metadata: {
          subscription_type: 'client',
          tier: plan.tier,
        },
      });
    }

    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 1,
    });

    let price;
    if (prices.data.length > 0) {
      price = prices.data[0];
    } else {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.amount,
        currency: plan.currency,
        recurring: {
          interval: plan.interval,
        },
        metadata: {
          subscription_type: 'client',
          tier: plan.tier,
        },
      });
    }

    priceCache.set(cacheKey, price.id);
    return price.id;
  } catch (error) {
    console.error('Error creating/fetching Stripe price:', error);
    throw new Error('Failed to prepare subscription price');
  }
}

export async function createClientCheckoutSession(userId, tier) {
  const plan = getClientPlan(tier);
  if (!plan) {
    throw new Error(`Invalid client tier: ${tier}`);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const existingSubscription = await ClientSubscription.findOne({ user_id: userId });
  if (existingSubscription && existingSubscription.status === 'active') {
    throw new Error('User already has an active client subscription');
  }

  const stripe = getStripeClient();
  
  const priceId = await getOrCreateStripePrice(stripe, plan);
  
  let customerId = existingSubscription?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: {
        user_id: String(userId),
        subscription_type: 'client',
      },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${process.env.FRONTEND_URL}/client-dashboard?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/client-dashboard?canceled=true`,
    metadata: {
      user_id: String(userId),
      subscription_type: 'client',
      tier,
    },
    subscription_data: {
      metadata: {
        user_id: String(userId),
        subscription_type: 'client',
        tier,
      },
    },
  });

  return {
    sessionId: session.id,
    sessionUrl: session.url,
  };
}

export async function getClientSubscriptionForUser(userId) {
  return ClientSubscription.findOne({ user_id: userId }).lean();
}

export async function syncClientStripeSubscription(stripeSubscription) {
  const userId = stripeSubscription.metadata?.user_id;
  if (!userId) {
    console.error('No user_id in stripe subscription metadata');
    return null;
  }

  const tier = stripeSubscription.metadata?.tier;
  if (!tier) {
    console.error('No tier in stripe subscription metadata');
    return null;
  }

  const priceId = stripeSubscription.items?.data?.[0]?.price?.id || '';

  const updateData = {
    user_id: userId,
    tier,
    stripe_subscription_id: stripeSubscription.id,
    stripe_customer_id: stripeSubscription.customer,
    stripe_price_id: priceId,
    status: stripeSubscription.status,
    current_period_start: new Date(stripeSubscription.current_period_start * 1000),
    current_period_end: new Date(stripeSubscription.current_period_end * 1000),
    cancel_at_period_end: stripeSubscription.cancel_at_period_end || false,
    last_synced_at: new Date(),
    last_stripe_event_id: stripeSubscription.latest_invoice || '',
  };

  const clientSubscription = await ClientSubscription.findOneAndUpdate(
    { user_id: userId },
    updateData,
    { upsert: true, new: true }
  );

  return clientSubscription;
}

export async function cancelClientSubscription(userId) {
  const clientSubscription = await ClientSubscription.findOne({ user_id: userId });
  if (!clientSubscription) {
    throw new Error('No client subscription found');
  }

  if (!clientSubscription.stripe_subscription_id) {
    throw new Error('No Stripe subscription ID found');
  }

  const stripe = getStripeClient();
  await stripe.subscriptions.update(clientSubscription.stripe_subscription_id, {
    cancel_at_period_end: true,
  });

  clientSubscription.cancel_at_period_end = true;
  await clientSubscription.save();

  return clientSubscription;
}
