import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import { handleChat } from '../controllers/chatController.js';

const stub = (req, res) => res.json({ success: true, message: 'Not implemented yet' });

router.post('/', handleChat);
router.get('/conversations', protect, stub);
router.get('/conversations/:id/messages', protect, stub);
router.get('/analytics/summary', protect, stub);
router.get('/analytics/funnel', protect, stub);
router.post('/referrals', protect, stub);
router.get('/referrals', protect, stub);
router.patch('/referrals/:id', protect, stub);
router.post('/nurture/send', protect, stub);
router.get('/nurture/logs', protect, stub);
router.post('/calculators/mortgage', stub);
router.post('/calculators/closing', stub);
router.get('/calculators/runs', protect, stub);

export default router;
