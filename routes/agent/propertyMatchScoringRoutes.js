import express from 'express';
import {
  protect,
  ensureAgent,
  requireCompleteProfessionalProfile,
} from '../../middleware/authMiddleware.js';
import { requireFeature } from '../../middleware/subscriptionAccess.js';
import { FEATURES } from '../../services/billing/entitlements.js';
import {
  getMyPropertyMatchScoring,
  putMyPropertyMatchScoring,
} from '../../controllers/agent/propertyMatchScoringController.js';

const router = express.Router();

router.get(
  '/',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgent,
  requireFeature(FEATURES.LEADS_SCORING),
  getMyPropertyMatchScoring,
);
router.put(
  '/',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgent,
  requireFeature(FEATURES.LEADS_SCORING),
  putMyPropertyMatchScoring,
);

export default router;
