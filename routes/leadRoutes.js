import express from 'express';
const router = express.Router();
import {
  protect,
  ensureAgentOrMortgageBroker,
  ensureAgentPropertyMatches,
  requireCompleteProfessionalProfile,
} from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import { FEATURES } from '../services/billing/entitlements.js';
import { leadAgentPatchSchema, leadConversationMessageSchema } from '../schemas/leadSchemas.js';
import {
  deleteLeadById,
  getLeadById,
  getLeadConversation,
  getLeadInquiredProperty,
  getLeadsByProfileId,
  getLeadProfiles,
  getLeadProfileById,
  getLeads,
  getLeadPropertyMatches,
  postLeadConversationMessage,
  recordLeadView,
  updateLeadMatch,
} from '../services/lead/leadService.js';

router.get('/', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), ensureAgentOrMortgageBroker, getLeads);
router.get('/profiles', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), ensureAgentOrMortgageBroker, getLeadProfiles);
router.get('/profiles/:profileId', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), ensureAgentOrMortgageBroker, getLeadProfileById);
router.get('/profiles/:profileId/leads', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), ensureAgentOrMortgageBroker, getLeadsByProfileId);
router.get('/:id/inquired-property', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), ensureAgentOrMortgageBroker, getLeadInquiredProperty);
router.get(
  '/:id/property-matches',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_INSIGHTS_ADVANCED),
  ensureAgentPropertyMatches,
  getLeadPropertyMatches,
);
router.post('/:id/view', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), ensureAgentOrMortgageBroker, recordLeadView);
router.patch('/:id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_STATUS), ensureAgentOrMortgageBroker, validateBody(leadAgentPatchSchema), updateLeadMatch);
router.get('/:id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), ensureAgentOrMortgageBroker, getLeadById);
router.get('/:id/conversation', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_LEAD_CONVERSATION), ensureAgentOrMortgageBroker, getLeadConversation);
router.post('/:id/conversation/message', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_LEAD_CONVERSATION), ensureAgentOrMortgageBroker, validateBody(leadConversationMessageSchema), postLeadConversationMessage);
router.delete('/:id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_STATUS), ensureAgentOrMortgageBroker, deleteLeadById);

export default router;
