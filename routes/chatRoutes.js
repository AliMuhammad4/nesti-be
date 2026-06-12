import express from 'express';
const router = express.Router();
import {
  protect,
  ensureAgentOrMortgageBroker,
  requireCompleteProfessionalProfile,
} from '../middleware/authMiddleware.js';
import { requireAnyFeature, requireFeature } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import { FEATURES } from '../services/billing/entitlements.js';
import {
  handleChat,
  handlePropertyMatches,
  getSessionMessages,
  selectPropertyMatch,
  scorePreview,
  clearChatSession,
} from '../controllers/chatController.js';
import { postPropertyImagesUpload } from '../controllers/chatPropertyImageController.js';
import { uploadPropertyImages } from '../middleware/uploadPropertyImages.js';
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
  sessionMessagesSchema,
  selectPropertyMatchSchema,
  scorePreviewSchema,
  nurtureDraftBodySchema,
  nurtureRefineBodySchema,
  nurtureSendBodySchema,
  nurturePreviewBodySchema,
  bulkNurtureDraftJobSchema,
  bulkNurtureDraftItemUpdateSchema,
  bulkNurtureSendJobSchema,
  calculatorSchema,
} from '../schemas/chatRouteSchemas.js';
import {
  postNurtureDraft,
  postNurtureRefine,
  postNurtureSend,
  postNurturePreview,
  getNurtureLogs,
} from '../controllers/nurtureController.js';
import {
  clearBulkNurtureDraftJob,
  getBulkNurtureJob,
  getLatestBulkNurtureJob,
  pauseBulkNurtureDraftJob,
  resumeBulkNurtureDraftJob,
  startBulkNurtureDraftJob,
  startBulkNurtureSendJob,
  updateBulkNurtureDraftItem,
} from '../controllers/nurtureBulkController.js';
const stub = (req, res) => res.json({ success: true, message: 'Not implemented yet' });

router.post('/', validateBody(chatBodySchema), handleChat);
router.post('/property-images', uploadPropertyImages.array('images', 8), postPropertyImagesUpload);
router.delete('/clear/:id', clearChatSession);
router.post('/session-messages', validateBody(sessionMessagesSchema), getSessionMessages);
router.post('/property-matches', validateBody(propertyMatchesSchema), handlePropertyMatches);
router.post('/property-matches/select', validateBody(selectPropertyMatchSchema), selectPropertyMatch);
router.post('/score-preview', validateBody(scorePreviewSchema), scorePreview);
router.get('/conversations', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), stub);
router.get('/conversations/:id/messages', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CRM_BASIC_LIST), stub);
router.get(
  '/analytics/summary',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.DASHBOARD_ANALYTICS),
  ensureAgentOrMortgageBroker,
  getChatAnalyticsSummary
);
router.get(
  '/analytics/funnel',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.WORKSPACE_ANALYTICS_PAGE),
  ensureAgentOrMortgageBroker,
  getChatAnalyticsFunnel
);
router.get(
  '/analytics/timeseries',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.DASHBOARD_ANALYTICS),
  ensureAgentOrMortgageBroker,
  getChatAnalyticsTimeseries
);
router.get(
  '/analytics/lead-trends',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.REPORTS_AI_MONTHLY),
  ensureAgentOrMortgageBroker,
  getChatAnalyticsLeadTrends
);
router.get(
  '/analytics/lead/:lead_match_id/events',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.REPORTS_AI_MONTHLY),
  ensureAgentOrMortgageBroker,
  getLeadKpiTimeline,
);
router.post(
  '/nurture/draft',
  protect,
  requireCompleteProfessionalProfile,
  requireAnyFeature(FEATURES.CRM_FOLLOWUP_MANUAL, FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  validateBody(nurtureDraftBodySchema),
  postNurtureDraft,
);
router.post(
  '/nurture/refine',
  protect,
  requireCompleteProfessionalProfile,
  requireAnyFeature(FEATURES.CRM_FOLLOWUP_MANUAL, FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  validateBody(nurtureRefineBodySchema),
  postNurtureRefine,
);
router.post(
  '/nurture/preview',
  protect,
  requireCompleteProfessionalProfile,
  requireAnyFeature(FEATURES.CRM_FOLLOWUP_MANUAL, FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  validateBody(nurturePreviewBodySchema),
  postNurturePreview,
);
router.post(
  '/nurture/send',
  protect,
  requireCompleteProfessionalProfile,
  requireAnyFeature(FEATURES.CRM_FOLLOWUP_MANUAL, FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  validateBody(nurtureSendBodySchema),
  postNurtureSend,
);
router.get(
  '/nurture/logs',
  protect,
  requireCompleteProfessionalProfile,
  requireAnyFeature(FEATURES.CRM_FOLLOWUP_MANUAL, FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  getNurtureLogs
);
router.post(
  '/nurture/bulk/draft-jobs',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  validateBody(bulkNurtureDraftJobSchema),
  startBulkNurtureDraftJob,
);
router.post(
  '/nurture/bulk/send-jobs',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  validateBody(bulkNurtureSendJobSchema),
  startBulkNurtureSendJob,
);
router.get(
  '/nurture/bulk/jobs/latest',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  getLatestBulkNurtureJob,
);
router.delete(
  '/nurture/bulk/jobs/:jobId/drafts',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  clearBulkNurtureDraftJob,
);
router.post(
  '/nurture/bulk/jobs/:jobId/pause',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  pauseBulkNurtureDraftJob,
);
router.post(
  '/nurture/bulk/jobs/:jobId/resume',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  resumeBulkNurtureDraftJob,
);
router.patch(
  '/nurture/bulk/jobs/:jobId/items/:itemId',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  validateBody(bulkNurtureDraftItemUpdateSchema),
  updateBulkNurtureDraftItem,
);
router.get(
  '/nurture/bulk/jobs/:jobId',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.LEADS_FOLLOWUP_AUTOMATED),
  ensureAgentOrMortgageBroker,
  getBulkNurtureJob,
);
router.post('/calculators/mortgage', validateBody(calculatorSchema), stub);
router.post('/calculators/closing', validateBody(calculatorSchema), stub);
router.get('/calculators/runs', protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.ASSISTANT_PROFESSIONAL), stub);

export default router;
