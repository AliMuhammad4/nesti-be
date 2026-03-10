import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';

const connectCalendar = async (req, res) => {
  res.json({ success: true, authUrl: 'http://oauth.url' });
};

const callbackCalendar = async (req, res) => {
  res.json({ success: true, message: 'Calendar connected successfully' });
};

const getCalendarStatus = async (req, res) => {
  res.json({ success: true, status: [] });
};

const getBookings = async (req, res) => {
  res.json({ success: true, bookings: [] });
};

const disconnectCalendar = async (req, res) => {
  res.json({ success: true, message: 'Calendar disconnected' });
};

router.get('/connect/:provider', protect, connectCalendar);
router.get('/callback/:provider', callbackCalendar);
router.get('/status', protect, getCalendarStatus);
router.get('/bookings', protect, getBookings);
router.delete('/disconnect/:provider', protect, disconnectCalendar);

export default router;
