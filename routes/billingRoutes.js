import express from 'express';
const router = express.Router();
import { protect, optionalAuth, evaluateCredentialAccess } from '../middleware/authMiddleware.js';
import { isProfessionalRole } from '../constants/roles.js';
import { validateBody } from '../middleware/validate.js';
import { enterpriseInquiryCreateSchema } from '../schemas/opsSchemas.js';
import {
  cancelSubscriptionSchema,
  changePlanSchema,
  checkoutSessionSchema,
  resumeSubscriptionSchema,
  storefrontTemplateCheckoutConfirmSchema,
  storefrontTemplateCheckoutSessionSchema,
  storefrontTemplateSubscriptionActionSchema,
} from '../schemas/billingSchemas.js';
import { getStripeClient } from '../services/billing/stripeClient.js';
import { publicBillingPlans, publicBillingPlansFromStripe } from '../services/billing/plans.js';
import {
  cancelSubscriptionForUser,
  changeSubscriptionPlanForUser,
  createCheckoutSessionForUser,
  getSubscriptionPresentationForUser,
  listPaidInvoicesForUser,
  resumeSubscriptionForUser,
  serializeSubscription,
} from '../services/billing/subscriptionService.js';
import {
  confirmCardUpdateForUser,
  createCardUpdateSessionForUser,
  listPaymentMethodsForUser,
} from '../services/billing/paymentMethodService.js';
import {
  cancelStorefrontTemplateSubscriptionForUser,
  confirmStorefrontTemplateCheckoutSession,
  createStorefrontTemplateCheckoutSession,
  getStorefrontTemplateEntitlementsForUser,
  resumeStorefrontTemplateSubscriptionForUser,
} from '../services/billing/storefrontTemplatePurchases.js';

async function requireCredentialApproved(req, res) {
  const denied = await evaluateCredentialAccess(req);
  if (!denied) return true;
  res.status(denied.status).json(denied.body);
  return false;
}

function requireProfessionalRole(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!isProfessionalRole(req.user.role)) {
    return res.status(403).json({
      success: false,
      code: 'PROFESSIONAL_ROLE_REQUIRED',
      message: 'This billing action is only available for professional accounts.',
    });
  }
  return next();
}

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
    if (!(await requireCredentialApproved(req, res))) return;
    const result = await createCheckoutSessionForUser(req.user, req.body.plan_key, req.body.billing_period);
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

const getStorefrontTemplateEntitlements = async (req, res) => {
  try {
    const result = await getStorefrontTemplateEntitlementsForUser(req.user._id);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, ...result.entitlements });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err?.message || 'Unable to load storefront template access.',
    });
  }
};

const createStorefrontTemplateCheckout = async (req, res) => {
  try {
    if (!(await requireCredentialApproved(req, res))) return;
    const result = await createStorefrontTemplateCheckoutSession(req.user, req.body.template_id);
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      free: Boolean(result.free),
      alreadyUnlocked: Boolean(result.alreadyUnlocked),
      template: result.template,
      url: result.session?.url || '',
      sessionId: result.session?.id || '',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err?.message || 'Unable to create template checkout session.',
    });
  }
};

const confirmStorefrontTemplateCheckout = async (req, res) => {
  try {
    const result = await confirmStorefrontTemplateCheckoutSession(
      req.user,
      req.body.session_id,
      req.body.template_id,
    );
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    return res.json({
      success: true,
      template: result.template,
      ...result.entitlements,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message || 'Unable to confirm template checkout.',
    });
  }
};

const cancelStorefrontTemplateSubscription = async (req, res) => {
  try {
    const result = await cancelStorefrontTemplateSubscriptionForUser(
      req.user,
      req.body.template_id,
      req.body.reason,
    );
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    return res.json({
      success: true,
      template: result.template,
      alreadyCanceled: Boolean(result.alreadyCanceled),
      alreadyScheduled: Boolean(result.alreadyScheduled),
      ...result.entitlements,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message || 'Unable to cancel template subscription.',
    });
  }
};

const resumeStorefrontTemplateSubscription = async (req, res) => {
  try {
    const result = await resumeStorefrontTemplateSubscriptionForUser(
      req.user,
      req.body.template_id,
    );
    if (!result.ok) {
      return res.status(result.code || 400).json({ success: false, message: result.message });
    }
    return res.json({
      success: true,
      template: result.template,
      alreadyActive: Boolean(result.alreadyActive),
      ...result.entitlements,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message || 'Unable to resume template subscription.',
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
    return res.status(result.code || 400).json({
      success: false,
      message: result.message,
      ...(result.subscription
        ? {
            subscription: serializeSubscription(result.subscription),
            reset: true,
          }
        : {}),
    });
  }
  res.json({
    success: true,
    message: 'Subscription will continue renewing automatically.',
    subscription: serializeSubscription(result.subscription),
  });
};

const changeCurrentSubscriptionPlan = async (req, res) => {
  try {
    const result = await changeSubscriptionPlanForUser(req.user, req.body.plan_key, req.body.billing_period);
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
  try {
    const paymentMethods = await listPaymentMethodsForUser(req.user);
    res.json({ success: true, data: paymentMethods });
  } catch (err) {
    res.status(502).json({ success: false, message: err?.message || 'Unable to load payment methods.' });
  }
};

const createCardUpdateSession = async (req, res) => {
  try {
    const result = await createCardUpdateSessionForUser(req.user);
    if (!result.ok) return res.status(result.code || 400).json({ success: false, message: result.message });
    res.json({ success: true, url: result.url });
  } catch (err) {
    res.status(502).json({ success: false, message: err?.message || 'Unable to start the card update.' });
  }
};

const confirmCardUpdate = async (req, res) => {
  try {
    const result = await confirmCardUpdateForUser(req.user, req.body?.session_id);
    if (!result.ok) return res.status(result.code || 400).json({ success: false, message: result.message });
    res.json({ success: true, message: 'Your card on file was updated.' });
  } catch (err) {
    res.status(502).json({ success: false, message: err?.message || 'Unable to confirm the card update.' });
  }
};

const handleEnterpriseInquiry = async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || req.user?.email || '').trim().toLowerCase();
  const message = String(body.message || '').trim();
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }
  if (!message) {
    return res.status(400).json({ success: false, message: 'A message is required' });
  }
  const { createDirectAdminInquiry } = await import('../services/admin/directInquiryService.js');
  const inquiry = await createDirectAdminInquiry({
    ...body,
    email,
    full_name: body.full_name,
    interest_role: body.interest_role || req.user?.role || '',
  });
  if (!inquiry) {
    return res.status(400).json({ success: false, message: 'Could not save that request' });
  }
  res.json({ success: true, message: 'Inquiry received', id: String(inquiry._id) });
};

const getEnterpriseStatus = async (req, res) => {
  res.json({ success: true, status: 'pending', isSubscribed: false });
};

// Note: Stripe webhook is handled separately without protect middleware or JSON parsing
router.get('/plans', listPlans);
router.get('/storefront-templates', protect, requireProfessionalRole, getStorefrontTemplateEntitlements);
router.post(
  '/storefront-templates/checkout-session',
  protect,
  requireProfessionalRole,
  validateBody(storefrontTemplateCheckoutSessionSchema),
  createStorefrontTemplateCheckout
);
router.post(
  '/storefront-templates/checkout-session/confirm',
  protect,
  requireProfessionalRole,
  validateBody(storefrontTemplateCheckoutConfirmSchema),
  confirmStorefrontTemplateCheckout,
);
router.post(
  '/storefront-templates/cancel',
  protect,
  requireProfessionalRole,
  validateBody(storefrontTemplateSubscriptionActionSchema),
  cancelStorefrontTemplateSubscription,
);
router.post(
  '/storefront-templates/resume',
  protect,
  requireProfessionalRole,
  validateBody(storefrontTemplateSubscriptionActionSchema),
  resumeStorefrontTemplateSubscription,
);
router.post(
  '/checkout-session',
  protect,
  requireProfessionalRole,
  validateBody(checkoutSessionSchema),
  createCheckoutSession
);
router.get('/subscription/me', protect, requireProfessionalRole, getCurrentSubscription);
router.get('/invoices', protect, requireProfessionalRole, getBillingInvoices);
router.post(
  '/subscription/cancel',
  protect,
  requireProfessionalRole,
  validateBody(cancelSubscriptionSchema),
  cancelCurrentSubscription
);
router.post(
  '/subscription/resume',
  protect,
  requireProfessionalRole,
  validateBody(resumeSubscriptionSchema),
  resumeCurrentSubscription
);
router.post(
  '/subscription/change-plan',
  protect,
  requireProfessionalRole,
  validateBody(changePlanSchema),
  changeCurrentSubscriptionPlan
);
router.get('/payment-methods', protect, requireProfessionalRole, getPaymentMethods);
router.post('/payment-method/update-session', protect, requireProfessionalRole, createCardUpdateSession);
router.post('/payment-method/confirm', protect, requireProfessionalRole, confirmCardUpdate);
router.post(
  '/enterprise-inquiry',
  optionalAuth,
  validateBody(enterpriseInquiryCreateSchema),
  handleEnterpriseInquiry
);
router.get('/enterprise-status', protect, requireProfessionalRole, getEnterpriseStatus);

export default router;
