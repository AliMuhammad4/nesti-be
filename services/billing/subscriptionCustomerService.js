import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import Subscription from '../../models/Subscription.js';
import { getPlan } from './plans.js';
import { getStripeClient } from './stripeClient.js';
import { isStripeResourceMissing } from './subscriptionShared.js';

function buildStripeCustomerDetails(user, profile, planKey) {
  const fullName =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    || String(profile?.full_name || '').trim()
    || undefined;
  const company = String(profile?.company_name || '').trim();
  const role = String(profile?.professional_type || user.role || '').trim();
  const planName = planKey ? getPlan(planKey)?.name : '';
  const descriptionParts = ['Nesti'];
  if (planName) descriptionParts.push(planName);
  if (company) descriptionParts.push(company);
  else if (role) descriptionParts.push(role);

  return {
    email: user.email,
    name: fullName,
    description: descriptionParts.join(' · '),
    metadata: {
      user_id: String(user._id),
      ...(company ? { company_name: company } : {}),
      ...(role ? { professional_type: role } : {}),
      ...(planKey ? { plan_key: String(planKey) } : {}),
    },
  };
}

export async function ensureStripeCustomerForUser(user, subscription, options = {}) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id })
    .select('company_name professional_type full_name')
    .lean();
  const customerDetails = buildStripeCustomerDetails(user, profile, options.planKey);
  const stripe = getStripeClient();
  if (subscription?.stripe_customer_id) {
    try {
      await stripe.customers.update(subscription.stripe_customer_id, customerDetails);
      return subscription.stripe_customer_id;
    } catch (error) {
      if (!isStripeResourceMissing(error)) throw error;
    }
  }
  const customer = await stripe.customers.create(customerDetails);
  await Subscription.updateOne(
    { user_id: user._id },
    { $set: { stripe_customer_id: customer.id, last_synced_at: new Date() } },
    { upsert: true },
  );
  return customer.id;
}
