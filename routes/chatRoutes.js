import express from 'express';
const router = express.Router();
import { protect, ensureAgentOrMortgageBroker } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { handleChat, handlePropertyMatches, scorePreview } from '../controllers/chatController.js';
import {
  getChatAnalyticsSummary,
  getChatAnalyticsFunnel,
  getLeadKpiTimeline,
} from '../controllers/chatAnalyticsController.js';
import {
  chatBodySchema,
  propertyMatchesSchema,
  scorePreviewSchema,
  referralCreateBodySchema,
  referralUpdateBodySchema,
  nurtureDraftBodySchema,
  nurtureRefineBodySchema,
  nurtureSendBodySchema,
  calculatorSchema,
} from '../schemas/chatRouteSchemas.js';
import {
  postNurtureDraft,
  postNurtureRefine,
  postNurtureSend,
  getNurtureLogs,
} from '../controllers/nurtureController.js';

const stub = (req, res) => res.json({ success: true, message: 'Not implemented yet' });

router.post('/', validateBody(chatBodySchema), handleChat);
router.post('/property-matches', validateBody(propertyMatchesSchema), handlePropertyMatches);
router.post('/score-preview', validateBody(scorePreviewSchema), scorePreview);
router.get('/conversations', protect, stub);
router.get('/conversations/:id/messages', protect, stub);
router.get('/analytics/summary', protect, ensureAgentOrMortgageBroker, getChatAnalyticsSummary);
router.get('/analytics/funnel', protect, ensureAgentOrMortgageBroker, getChatAnalyticsFunnel);
router.get(
  '/analytics/lead/:lead_match_id/events',
  protect,
  ensureAgentOrMortgageBroker,
  getLeadKpiTimeline,
);
router.post('/referrals', protect, validateBody(referralCreateBodySchema), stub);
router.get('/referrals', protect, stub);
router.patch('/referrals/:id', protect, validateBody(referralUpdateBodySchema), stub);
router.post(
  '/nurture/draft',
  protect,
  ensureAgentOrMortgageBroker,
  validateBody(nurtureDraftBodySchema),
  postNurtureDraft,
);
router.post(
  '/nurture/refine',
  protect,
  ensureAgentOrMortgageBroker,
  validateBody(nurtureRefineBodySchema),
  postNurtureRefine,
);
router.post(
  '/nurture/send',
  protect,
  ensureAgentOrMortgageBroker,
  validateBody(nurtureSendBodySchema),
  postNurtureSend,
);
router.get('/nurture/logs', protect, ensureAgentOrMortgageBroker, getNurtureLogs);
router.post('/calculators/mortgage', validateBody(calculatorSchema), stub);
router.post('/calculators/closing', validateBody(calculatorSchema), stub);
router.get('/calculators/runs', protect, stub);

export default router;
