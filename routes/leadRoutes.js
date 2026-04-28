import express from 'express';
const router = express.Router();
import {
  protect,
  ensureAgentOrMortgageBroker,
  ensureAgentPropertyMatches,
  requireCompleteProfessionalProfile,
} from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { leadAgentPatchSchema } from '../schemas/leadSchemas.js';
import {
  deleteLeadById,
  getLeadById,
  getLeadConversation,
  getLeadsByProfileId,
  getLeadProfiles,
  getLeadProfileById,
  getLeads,
  getLeadPropertyMatches,
  recordLeadView,
  updateLeadMatch,
} from '../services/lead/leadService.js';

router.get('/', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, getLeads);
router.get('/profiles', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, getLeadProfiles);
router.get('/profiles/:profileId', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, getLeadProfileById);
router.get('/profiles/:profileId/leads', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, getLeadsByProfileId);
router.get(
  '/:id/property-matches',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentPropertyMatches,
  getLeadPropertyMatches,
);
router.post('/:id/view', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, recordLeadView);
router.patch('/:id', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, validateBody(leadAgentPatchSchema), updateLeadMatch);
router.get('/:id', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, getLeadById);
router.get('/:id/conversation', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, getLeadConversation);
router.delete('/:id', protect, requireCompleteProfessionalProfile, ensureAgentOrMortgageBroker, deleteLeadById);

export default router;
