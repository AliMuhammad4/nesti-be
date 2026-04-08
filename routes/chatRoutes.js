import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { handleChat, handlePropertyMatches, scorePreview } from '../controllers/chatController.js';
import { getChatAnalyticsSummary, getChatAnalyticsFunnel } from '../controllers/chatAnalyticsController.js';
import {
  chatBodySchema,
  propertyMatchesSchema,
  scorePreviewSchema,
  referralCreateBodySchema,
  referralUpdateBodySchema,
  nurtureSendBodySchema,
  calculatorSchema,
} from '../schemas/chatRouteSchemas.js';

const stub = (req, res) => res.json({ success: true, message: 'Not implemented yet' });

router.post('/', validateBody(chatBodySchema), handleChat);
router.post('/property-matches', validateBody(propertyMatchesSchema), handlePropertyMatches);
router.post('/score-preview', validateBody(scorePreviewSchema), scorePreview);
router.get('/conversations', protect, stub);
router.get('/conversations/:id/messages', protect, stub);
router.get('/analytics/summary', protect, getChatAnalyticsSummary);
router.get('/analytics/funnel', protect, getChatAnalyticsFunnel);
router.post('/referrals', protect, validateBody(referralCreateBodySchema), stub);
router.get('/referrals', protect, stub);
router.patch('/referrals/:id', protect, validateBody(referralUpdateBodySchema), stub);
router.post('/nurture/send', protect, validateBody(nurtureSendBodySchema), stub);
router.get('/nurture/logs', protect, stub);
router.post('/calculators/mortgage', validateBody(calculatorSchema), stub);
router.post('/calculators/closing', validateBody(calculatorSchema), stub);
router.get('/calculators/runs', protect, stub);

export default router;
