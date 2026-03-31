import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
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

router.post('/professional/guidance', protect, getGuidance);
router.get('/lead/insights/:conversation_id', protect, getInsights);
router.get('/lead/questionnaire/:type', protect, getQuestionnaireHandler);
router.post(
  '/lead/score-questionnaire',
  protect,
  validateBody(passthrough),
  scoreQuestionnaireHandler
);
router.get('/lead/toggle-automation/:conversation_id', protect, toggleAutomationHandler);
router.post('/lead/toggle-automation/:conversation_id', protect, toggleAutomationHandler);

export default router;
