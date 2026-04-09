import express from 'express';
const router = express.Router();
import { protect, ensureAgentOrMortgageBroker } from '../middleware/authMiddleware.js';
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
} from '../services/lead/leadService.js';

router.get('/', protect, ensureAgentOrMortgageBroker, getLeads);
router.get('/profiles', protect, ensureAgentOrMortgageBroker, getLeadProfiles);
router.get('/profiles/:profileId', protect, ensureAgentOrMortgageBroker, getLeadProfileById);
router.get('/profiles/:profileId/leads', protect, ensureAgentOrMortgageBroker, getLeadsByProfileId);
router.get('/:id/property-matches', protect, ensureAgentOrMortgageBroker, getLeadPropertyMatches);
router.post('/:id/view', protect, ensureAgentOrMortgageBroker, recordLeadView);
router.get('/:id', protect, ensureAgentOrMortgageBroker, getLeadById);
router.get('/:id/conversation', protect, ensureAgentOrMortgageBroker, getLeadConversation);
router.delete('/:id', protect, ensureAgentOrMortgageBroker, deleteLeadById);

export default router;
