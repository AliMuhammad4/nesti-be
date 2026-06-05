import express from 'express';
const router = express.Router();
import { validateBody } from '../middleware/validate.js';
import { passthrough } from '../schemas/common.js';

const smsWebhook = async (req, res) => {
  console.log('SMS webhook received');
  res.json({ success: true });
};

const whatsappWebhook = async (req, res) => {
  console.log('WhatsApp webhook received');
  res.json({ success: true });
};
router.post('/sms', validateBody(passthrough), smsWebhook);
router.post('/whatsapp', validateBody(passthrough), whatsappWebhook);

export default router;
