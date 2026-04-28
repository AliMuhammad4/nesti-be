import express from 'express';
const router = express.Router();
import {
  protect,
  ensureAgentOrMortgageBroker,
  requireCompleteProfessionalProfile,
} from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { handleChat, handlePropertyMatches, scorePreview, clearChatSession } from '../controllers/chatController.js';
import {
  getChatAnalyticsSummary,
  getChatAnalyticsFunnel,
  getChatAnalyticsTimeseries,
  getChatAnalyticsLeadTrends,
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
router.delete('/clear/:id', clearChatSession);
router.post('/property-matches', validateBody(propertyMatchesSchema), handlePropertyMatches);
router.post('/score-preview', validateBody(scorePreviewSchema), scorePreview);
router.get('/conversations', protect, requireCompleteProfessionalProfile, stub);
router.get('/conversations/:id/messages', protect, requireCompleteProfessionalProfile, stub);
router.get(
  '/analytics/summary',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  getChatAnalyticsSummary
);
router.get(
  '/analytics/funnel',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  getChatAnalyticsFunnel
);
router.get(
  '/analytics/timeseries',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  getChatAnalyticsTimeseries
);
router.get(
  '/analytics/lead-trends',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  getChatAnalyticsLeadTrends
);
router.get(
  '/analytics/lead/:lead_match_id/events',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  getLeadKpiTimeline,
);
router.post(
  '/referrals',
  protect,
  requireCompleteProfessionalProfile,
  validateBody(referralCreateBodySchema),
  stub
);
router.get('/referrals', protect, requireCompleteProfessionalProfile, stub);
router.patch(
  '/referrals/:id',
  protect,
  requireCompleteProfessionalProfile,
  validateBody(referralUpdateBodySchema),
  stub
);
router.post(
  '/nurture/draft',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  validateBody(nurtureDraftBodySchema),
  postNurtureDraft,
);
router.post(
  '/nurture/refine',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  validateBody(nurtureRefineBodySchema),
  postNurtureRefine,
);
router.post(
  '/nurture/send',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  validateBody(nurtureSendBodySchema),
  postNurtureSend,
);
router.get(
  '/nurture/logs',
  protect,
  requireCompleteProfessionalProfile,
  ensureAgentOrMortgageBroker,
  getNurtureLogs
);
router.post('/calculators/mortgage', validateBody(calculatorSchema), stub);
router.post('/calculators/closing', validateBody(calculatorSchema), stub);
router.get('/calculators/runs', protect, requireCompleteProfessionalProfile, stub);

export default router;
