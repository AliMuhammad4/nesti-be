import express from 'express';
import {
  protect,
  ensureAgent,
  requireCompleteProfessionalProfile,
} from '../../middleware/authMiddleware.js';
import {
  getMyPropertyMatchScoring,
  putMyPropertyMatchScoring,
} from '../../controllers/agent/propertyMatchScoringController.js';

const router = express.Router();

router.get('/', protect, requireCompleteProfessionalProfile, ensureAgent, getMyPropertyMatchScoring);
router.put('/', protect, requireCompleteProfessionalProfile, ensureAgent, putMyPropertyMatchScoring);

export default router;
