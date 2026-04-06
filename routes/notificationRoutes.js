import express from 'express';
import { protect, ensureAgentOrMortgageBroker } from '../middleware/authMiddleware.js';
import {
  getNotificationsForUser,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notifications/notificationService.js';
const router = express.Router();
router.get('/unread-count', protect, ensureAgentOrMortgageBroker, async (req, res) => {
  try {
    const count = await getUnreadNotificationCount(req.user._id);
    res.json({ success: true, unread_count: count });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Server error' });
  }
});
router.get('/', protect, ensureAgentOrMortgageBroker, async (req, res) => {
  try {
    const limit = req.query.limit;
    const offset = req.query.offset;
    const unread_only = ['1', 'true', 'yes'].includes(String(req.query.unread_only ?? '').toLowerCase());
    const result = await getNotificationsForUser(req.user._id, { limit, offset, unread_only });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Server error' });
  }
});
router.patch('/read-all', protect, ensureAgentOrMortgageBroker, async (req, res) => {
  try {
    const result = await markAllNotificationsRead(req.user._id);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Server error' });
  }
});
router.patch('/:id/read', protect, ensureAgentOrMortgageBroker, async (req, res) => {
  try {
    const updated = await markNotificationRead(req.user._id, req.params.id);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.json({ success: true, notification: updated });
  } catch (e) {
    if (e.name === 'BSONError' || e.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid notification id' });
    }
    res.status(500).json({ success: false, message: e.message || 'Server error' });
  }
});
export default router;
