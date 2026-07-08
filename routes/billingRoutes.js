import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { enterpriseInquiryCreateSchema } from '../schemas/opsSchemas.js';
import { checkoutSessionSchema, cancelSubscriptionSchema, changePlanSchema, resumeSubscriptionSchema } from '../schemas/billingSchemas.js';
import Subscription from '../models/Subscription.js';
import { getStripeClient } from '../services/billing/stripeClient.js';
import { publicBillingPlans, publicBillingPlansFromStripe } from '../services/billing/plans.js';
import {
  cancelSubscriptionForUser,
  changeSubscriptionPlanForUser,
  createCheckoutSessionForUser,
  ensureStripeCustomerForUser,
  getOrCreateSubscriptionForUser,
  getSubscriptionPresentationForUser,
  listPaidInvoicesForUser,
  resumeSubscriptionForUser,
  serializeSubscription,
} from '../services/billing/subscriptionService.js';

const setupIntent = async (req, res) => {
  const subscription = await getOrCreateSubscriptionForUser(req.user);
  const customerId = await ensureStripeCustomerForUser(req.user, subscription);
  const intent = await getStripeClient().setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    metadata: { user_id: String(req.user._id) },
  });

  res.json({ success: true, clientSecret: intent.client_secret });
};

const listPlans = async (req, res) => {
  try {
    const plans = await publicBillingPlansFromStripe(getStripeClient());
    res.json({ success: true, plans });
  } catch {
    res.json({ success: true, plans: publicBillingPlans() });
  }
};

const createCheckoutSession = async (req, res) => {
  try {
    const result = await createCheckoutSessionForUser(req.user, req.body.plan_key);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      url: result.session.url,
      sessionId: result.session.id,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err?.message || 'Unable to create checkout session.',
    });
  }
};

const getCurrentSubscription = async (req, res) => {
  const refresh = ['1', 'true', 'yes'].includes(String(req.query?.refresh || '').trim().toLowerCase());
  const { raw: _raw, ...subscription } = await getSubscriptionPresentationForUser(req.user, { refreshFromStripe: refresh });
  res.json({ success: true, subscription });
};

const cancelCurrentSubscription = async (req, res) => {
  const result = await cancelSubscriptionForUser(req.user, req.body?.reason);
  if (!result.ok) {
    if (result.subscription) {
      return res.json({
        success: true,
        message: result.message,
        subscription: serializeSubscription(result.subscription),
        reset: true,
      });
    }
    return res.status(result.code || 400).json({ success: false, message: result.message });
  }
  res.json({ success: true, subscription: serializeSubscription(result.subscription) });
};

const resumeCurrentSubscription = async (req, res) => {
  const result = await resumeSubscriptionForUser(req.user);
  if (!result.ok) {
    if (result.subscription) {
      return res.json({
        success: true,
        message: result.message,
        subscription: serializeSubscription(result.subscription),
        reset: true,
      });
    }
    return res.status(result.code || 400).json({ success: false, message: result.message });
  }
  res.json({
    success: true,
    message: 'Subscription will continue renewing automatically.',
    subscription: serializeSubscription(result.subscription),
  });
};

const changeCurrentSubscriptionPlan = async (req, res) => {
  try {
    const result = await changeSubscriptionPlanForUser(req.user, req.body.plan_key);
    if (!result.ok) {
      if (result.subscription) {
        return res.json({
          success: true,
          message: result.message,
          subscription: serializeSubscription(result.subscription),
          reset: true,
        });
      }
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      message: result.changeType === 'revert_unpaid_upgrade'
        ? `Restored to ${result.planName}. The unpaid upgrade invoice was removed.`
        : result.changeType === 'downgrade'
          ? `${result.planName} will start on your next renewal date.`
          : `Upgraded to ${result.planName}. Stripe will invoice the prorated difference today.`,
      changeType: result.changeType,
      effectiveAt: result.effectiveAt || null,
      invoice: result.invoice || null,
      subscription: serializeSubscription(result.subscription),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err?.message || 'Unable to change subscription plan.',
    });
  }
};

const getBillingInvoices = async (req, res) => {
  try {
    const invoices = await listPaidInvoicesForUser(req.user);
    res.json({ success: true, invoices });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err?.message || 'Unable to load billing invoices.',
    });
  }
};

const getPaymentMethods = async (req, res) => {
  const subscription = await Subscription.findOne({ user_id: req.user._id }).lean();
  if (!subscription?.stripe_customer_id) {
    return res.json({ success: true, data: [] });
  }

  const methods = await getStripeClient().paymentMethods.list({
    customer: subscription.stripe_customer_id,
    type: 'card',
  });
  const paymentMethods = methods.data.map((method) => ({
    id: method.id,
    card: {
      brand: method.card?.brand || '',
      last4: method.card?.last4 || '',
      exp_month: method.card?.exp_month || null,
      exp_year: method.card?.exp_year || null,
    },
  }));
  res.json({ success: true, data: paymentMethods });
};

const handleEnterpriseInquiry = async (req, res) => {
  res.json({ success: true, message: 'Inquiry received' });
};

const getEnterpriseStatus = async (req, res) => {
  res.json({ success: true, status: 'pending', isSubscribed: false });
};

// Note: Stripe webhook is handled separately without protect middleware or JSON parsing
router.get('/plans', listPlans);
router.post('/setup-intent', protect, setupIntent);
router.post(
  '/checkout-session',
  protect,
  validateBody(checkoutSessionSchema),
  createCheckoutSession
);
router.get('/subscription/me', protect, getCurrentSubscription);
router.get('/invoices', protect, getBillingInvoices);
router.post(
  '/subscription/cancel',
  protect,
  validateBody(cancelSubscriptionSchema),
  cancelCurrentSubscription
);
router.post(
  '/subscription/resume',
  protect,
  validateBody(resumeSubscriptionSchema),
  resumeCurrentSubscription
);
router.post(
  '/subscription/change-plan',
  protect,
  validateBody(changePlanSchema),
  changeCurrentSubscriptionPlan
);
router.get('/payment-methods', protect, getPaymentMethods);
router.post(
  '/enterprise-inquiry',
  protect,
  validateBody(
    enterpriseInquiryCreateSchema.fork(['user_id'], (s) => s.optional())
  ),
  handleEnterpriseInquiry
);
router.get('/enterprise-status', protect, getEnterpriseStatus);

export default router;
