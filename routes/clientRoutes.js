import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import { uploadPropertyImages } from '../middleware/uploadPropertyImages.js';
import {
  getClientProfile,
  getClientInquiries,
  getClientRecommendations,
  submitClientAgentInquiryFromProfile,
  submitClientLawyerInquiryFromProfile,
  submitClientMortgageBrokerInquiryFromProfile,
  uploadClientAgentInquiryPropertyImages,
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
router.post('/agent-inquiry/property-images', protect, uploadPropertyImages.array('images', 8), uploadClientAgentInquiryPropertyImages);
router.post('/professionals/:professionalId/agent-inquiry', protect, submitClientAgentInquiryFromProfile);
router.post('/professionals/:professionalId/lawyer-inquiry', protect, submitClientLawyerInquiryFromProfile);
router.post('/professionals/:professionalId/mortgage-broker-inquiry', protect, submitClientMortgageBrokerInquiryFromProfile);
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
