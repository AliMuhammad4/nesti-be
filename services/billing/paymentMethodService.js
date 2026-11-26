import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import { USER_ROLE } from '../../constants/roles.js';
import { getStripeClient } from './stripeClient.js';
import { getBillingFrontendOrigin, isStripeResourceMissing } from './subscriptionShared.js';

/**
 * Card-on-file helpers for professional and client billing.
 *
 * The Stripe Customer Portal is not used. Updating a card goes through a
 * Stripe-hosted Checkout page in "setup" mode, so card details never touch
 * Nesti. Nothing is charged when the card is saved.
 */

function idOf(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : String(value.id || '');
}

/**
 * The user's own billing row: professionals use Subscription, clients use
 * ClientSubscription. Roles are fixed at signup, so this never crosses over.
 */
async function loadBillingAccount(user) {
  const isClient = String(user?.role || '') === USER_ROLE.CLIENT;
  const Model = isClient ? ClientSubscription : Subscription;
  const row = await Model.findOne({ user_id: user._id }).lean();
  return { row, returnPath: isClient ? '/client-dashboard/billing' : '/billing' };
}

function serializeCard(method, defaultId) {
  return {
    id: method.id,
    is_default: Boolean(defaultId) && method.id === defaultId,
    card: {
      brand: method.card?.brand || '',
      last4: method.card?.last4 || '',
      exp_month: method.card?.exp_month || null,
      exp_year: method.card?.exp_year || null,
    },
  };
}

async function resolveDefaultPaymentMethodId(stripe, subscription) {
  if (subscription?.stripe_subscription_id) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
      const fromSub = idOf(stripeSub?.default_payment_method);
      if (fromSub) return fromSub;
    } catch (err) {
      if (!isStripeResourceMissing(err)) throw err;
    }
  }
  try {
    const customer = await stripe.customers.retrieve(subscription.stripe_customer_id);
    return idOf(customer?.invoice_settings?.default_payment_method);
  } catch (err) {
    if (!isStripeResourceMissing(err)) throw err;
    return '';
  }
}

export async function listPaymentMethodsForUser(user) {
  const { row: subscription } = await loadBillingAccount(user);
  if (!subscription?.stripe_customer_id) return [];
  const stripe = getStripeClient();
  const methods = await stripe.paymentMethods.list({
    customer: subscription.stripe_customer_id,
    type: 'card',
  });
  const list = Array.isArray(methods?.data) ? methods.data : [];
  if (!list.length) return [];
  let defaultId = await resolveDefaultPaymentMethodId(stripe, subscription);
  // A single saved card is the one Stripe charges.
  if (!defaultId && list.length === 1) defaultId = list[0].id;
  return list
    .map((method) => serializeCard(method, defaultId))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

export async function createCardUpdateSessionForUser(user) {
  const { row: subscription, returnPath } = await loadBillingAccount(user);
  if (!subscription?.stripe_customer_id) {
    return { ok: false, code: 409, message: 'There is no billing account to update yet.' };
  }
  const origin = getBillingFrontendOrigin();
  const session = await getStripeClient().checkout.sessions.create({
    mode: 'setup',
    customer: subscription.stripe_customer_id,
    currency: 'usd',
    payment_method_types: ['card'],
    success_url: `${origin}${returnPath}?card_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${returnPath}?card=cancelled`,
    metadata: { user_id: String(user._id), purpose: 'card_update' },
  });
  return { ok: true, url: session.url };
}

export async function confirmCardUpdateForUser(user, sessionId) {
  const id = String(sessionId || '').trim();
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) {
    return { ok: false, code: 400, message: 'Invalid card update session.' };
  }
  const { row: subscription } = await loadBillingAccount(user);
  if (!subscription?.stripe_customer_id) {
    return { ok: false, code: 409, message: 'There is no billing account to update yet.' };
  }
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(id, { expand: ['setup_intent'] });
  if (
    !session
    || session.mode !== 'setup'
    || idOf(session.customer) !== subscription.stripe_customer_id
    || String(session.metadata?.user_id || '') !== String(user._id)
  ) {
    return { ok: false, code: 403, message: 'This card update does not belong to your account.' };
  }
  const setupIntent = typeof session.setup_intent === 'string'
    ? await stripe.setupIntents.retrieve(session.setup_intent)
    : session.setup_intent;
  if (setupIntent?.status !== 'succeeded') {
    return { ok: false, code: 409, message: 'The new card was not saved. Please try again.' };
  }
  const paymentMethodId = idOf(setupIntent.payment_method);
  if (!paymentMethodId) {
    return { ok: false, code: 409, message: 'The new card was not saved. Please try again.' };
  }

  await stripe.customers.update(subscription.stripe_customer_id, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  if (subscription.stripe_subscription_id) {
    try {
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        default_payment_method: paymentMethodId,
      });
    } catch (err) {
      if (!isStripeResourceMissing(err)) throw err;
    }
  }
  return { ok: true, payment_method_id: paymentMethodId };
}
