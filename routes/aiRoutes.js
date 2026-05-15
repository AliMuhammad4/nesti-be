import express from 'express';
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { passthrough } from '../schemas/common.js';
import {
  getGuidance,
  getInsights,
  getQuestionnaireHandler,
  scoreQuestionnaireHandler,
  toggleAutomationHandler,
} from '../controllers/aiController.js';

const router = express.Router();

router.post('/professional/guidance', protect, requireCompleteProfessionalProfile, getGuidance);
router.get('/lead/insights/:conversation_id', protect, requireCompleteProfessionalProfile, getInsights);
router.get('/lead/questionnaire/:type', protect, requireCompleteProfessionalProfile, getQuestionnaireHandler);
router.post(
  '/lead/score-questionnaire',
  protect,
  requireCompleteProfessionalProfile,
  validateBody(passthrough),
  scoreQuestionnaireHandler
);
router.get(
  '/lead/toggle-automation/:conversation_id',
  protect,
  requireCompleteProfessionalProfile,
  toggleAutomationHandler
);
router.post(
  '/lead/toggle-automation/:conversation_id',
  protect,
  requireCompleteProfessionalProfile,
  toggleAutomationHandler
);

export default router;
