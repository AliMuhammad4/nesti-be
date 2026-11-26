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
  listPublicClientPlans,
  getClientPaymentMethods,
  createClientCardUpdateSession,
  confirmClientCardUpdate,
} from '../controllers/clientController.js';
import {
  requireClientFeature,
  requireClientRole,
} from '../middleware/clientSubscriptionAccess.js';
import { CLIENT_FEATURE } from '../services/client/plans.js';

router.get('/subscription/plans', listPublicClientPlans);
router.get('/profile/me', protect, getClientProfile);
router.get('/inquiries', protect, requireClientFeature(CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS), getClientInquiries);
router.get('/recommendations', protect, requireClientFeature(CLIENT_FEATURE.PROPERTY_MATCHING), getClientRecommendations);
router.post('/agent-inquiry/property-images', protect, requireClientFeature(CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS), uploadPropertyImages.array('images', 8), uploadClientAgentInquiryPropertyImages);
router.post('/professionals/:professionalId/agent-inquiry', protect, requireClientFeature(CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS), submitClientAgentInquiryFromProfile);
router.post('/professionals/:professionalId/lawyer-inquiry', protect, requireClientFeature(CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS), submitClientLawyerInquiryFromProfile);
router.post('/professionals/:professionalId/mortgage-broker-inquiry', protect, requireClientFeature(CLIENT_FEATURE.PROFESSIONAL_CONNECTIONS), submitClientMortgageBrokerInquiryFromProfile);
router.post('/profile', protect, requireClientRole, upsertClientProfile);
router.put('/profile', protect, requireClientRole, upsertClientProfile);
router.put('/settings', protect, requireClientRole, updateClientSettings);

router.post('/subscription/checkout', protect, requireClientRole, createClientSubscriptionCheckout);
router.get('/subscription/me', protect, requireClientRole, getClientSubscription);
router.get('/subscription/invoices', protect, requireClientRole, getClientSubscriptionInvoices);
router.get('/subscription/payment-methods', protect, requireClientRole, getClientPaymentMethods);
router.post('/subscription/payment-method/update-session', protect, requireClientRole, createClientCardUpdateSession);
router.post('/subscription/payment-method/confirm', protect, requireClientRole, confirmClientCardUpdate);
router.post('/subscription/cancel', protect, requireClientRole, cancelClientSubscriptionEndpoint);
router.post('/subscription/resume', protect, requireClientRole, resumeClientSubscriptionEndpoint);
router.post('/subscription/change-plan', protect, requireClientRole, changeClientSubscriptionPlanEndpoint);

export default router;
