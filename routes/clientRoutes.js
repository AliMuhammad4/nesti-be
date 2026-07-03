import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import {
  getClientProfile,
  getClientInquiries,
  getClientRecommendations,
  upsertClientProfile,
  updateClientSettings,
  createClientSubscriptionCheckout,
  getClientSubscription,
  getClientSubscriptionInvoices,
  cancelClientSubscriptionEndpoint,
  changeClientSubscriptionPlanEndpoint,
  resumeClientSubscriptionEndpoint,
} from '../controllers/clientController.js';

router.get('/profile/me', protect, getClientProfile);
router.get('/inquiries', protect, getClientInquiries);
router.get('/recommendations', protect, getClientRecommendations);
router.post('/profile', protect, upsertClientProfile);
router.put('/profile', protect, upsertClientProfile);
router.put('/settings', protect, updateClientSettings);

router.post('/subscription/checkout', protect, createClientSubscriptionCheckout);
router.get('/subscription/me', protect, getClientSubscription);
router.get('/subscription/invoices', protect, getClientSubscriptionInvoices);
router.post('/subscription/cancel', protect, cancelClientSubscriptionEndpoint);
router.post('/subscription/resume', protect, resumeClientSubscriptionEndpoint);
router.post('/subscription/change-plan', protect, changeClientSubscriptionPlanEndpoint);

export default router;
