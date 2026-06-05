import express from 'express';
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import { passthrough } from '../schemas/common.js';
import { FEATURES } from '../services/billing/entitlements.js';
import {
  analyzeLeadInsights,
  getGuidance,
  getInsights,
  getQuestionnaireHandler,
  scoreQuestionnaireHandler,
  toggleAutomationHandler,
} from '../controllers/aiController.js';

const router = express.Router();

router.post('/professional/guidance', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.ASSISTANT_PROFESSIONAL), getGuidance);
router.post('/lead/:lead_id/insights/analyze', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.LEADS_INSIGHTS_ADVANCED), analyzeLeadInsights);
router.get('/lead/insights/:conversation_id', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.LEADS_INSIGHTS_ADVANCED), getInsights);
router.get('/lead/questionnaire/:type', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.LEADS_QUESTIONNAIRES), getQuestionnaireHandler);
router.post(
  '/lead/score-questionnaire',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_SCORING),
  validateBody(passthrough),
  scoreQuestionnaireHandler
);
router.get(
  '/lead/toggle-automation/:conversation_id',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  toggleAutomationHandler
);
router.post(
  '/lead/toggle-automation/:conversation_id',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  toggleAutomationHandler
);

export default router;
