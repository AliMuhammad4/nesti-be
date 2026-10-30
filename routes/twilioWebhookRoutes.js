import express from 'express';
import {
  twilioGatherWebhook,
  twilioRecordingWebhook,
  twilioStatusWebhook,
  twilioTranscriptionWebhook,
  twilioVoiceWebhook,
} from '../controllers/twilioWebhookController.js';

const router = express.Router();

router.post('/voice', twilioVoiceWebhook);
router.post('/gather', twilioGatherWebhook);
router.post('/status', twilioStatusWebhook);
router.post('/recording', twilioRecordingWebhook);
router.post('/transcription', twilioTranscriptionWebhook);

export default router;
