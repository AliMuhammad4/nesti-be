import express from 'express';
const router = express.Router();
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { enterpriseInquiryCreateSchema } from '../schemas/opsSchemas.js';

const setupIntent = async (req, res) => {
  res.json({ success: true, clientSecret: 'pi_secret_123' });
};

const handleSubscriptions = async (req, res) => {
  res.json({ success: true, message: 'Subscription handled' });
};

const getPaymentMethods = async (req, res) => {
  res.json({ success: true, paymentMethods: [] });
};

const handleEnterpriseInquiry = async (req, res) => {
  res.json({ success: true, message: 'Inquiry received' });
};

const getEnterpriseStatus = async (req, res) => {
  res.json({ success: true, status: 'pending' });
};

// Note: Stripe webhook is handled separately without protect middleware or JSON parsing
router.post('/setup-intent', protect, requireCompleteProfessionalProfile, setupIntent);
router.post('/subscriptions', protect, requireCompleteProfessionalProfile, handleSubscriptions);
router.get('/payment-methods', protect, requireCompleteProfessionalProfile, getPaymentMethods);
router.post(
  '/enterprise-inquiry',
  protect,
  requireCompleteProfessionalProfile,
  validateBody(
    enterpriseInquiryCreateSchema.fork(['user_id'], (s) => s.optional())
  ),
  handleEnterpriseInquiry
);
router.get('/enterprise-status', protect, requireCompleteProfessionalProfile, getEnterpriseStatus);

export default router;
