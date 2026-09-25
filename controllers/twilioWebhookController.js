import ProfessionalCall from '../models/ProfessionalCall.js';
import { verifyTwilioSignature, publicWebhookUrl } from '../services/proChat/twilioSignature.js';
import { buildVoiceTwiml, mapTwilioStatus, shouldAdvanceCallStatus, terminalVoiceUpdate } from '../services/proChat/twilioVoiceService.js';
import { handleVoiceGather } from '../services/proChat/voiceAgentTurnService.js';
import { enqueueRecordingFromWebhook } from '../services/proChat/recordingIngestionService.js';
import { ingestFinalTranscriptSegment } from '../services/proChat/transcriptSegmentService.js';
import logger from '../utils/logger.js';

function reject(res) {
  return res.status(403).type('text/plain').send('Invalid Twilio signature');
}

function authorized(req) {
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!authToken) return false;
  const signature = req.get('x-twilio-signature');
  const url = publicWebhookUrl(req, req.originalUrl);
  return verifyTwilioSignature({ authToken, signature, url, params: req.body || {} });
}

export async function twilioVoiceWebhook(req, res) {
  if (!authorized(req)) return reject(res);
  const call = await matchingCall(req.query.callId, req.body?.CallSid);
  const callId = call ? String(call._id) : String(req.query.callId || '');
  const twiml = buildVoiceTwiml({
    callId,
    say: call?.voice_target_type === 'sales'
      ? 'Hello, this is Maya from Nesti. This call may be recorded. I will explain the tools that match your work, then recommend one subscription. What are you hoping to use Nesti for?'
      : 'Hello, this is Maya from Nesti. This call may be recorded. How can I help?',
  });
  return res.type('text/xml').send(twiml);
}

export async function twilioGatherWebhook(req, res) {
  if (!authorized(req)) return reject(res);
  const call = await matchingCall(req.query.callId, req.body?.CallSid);
  const callId = call ? String(call._id) : '';
  const turn = await handleVoiceGather({
    callId,
    speechResult: req.body?.SpeechResult,
  });
  return res.type('text/xml').send(buildVoiceTwiml({ callId, say: turn.say, done: turn.done }));
}

async function matchingCall(callId, callSid) {
  if (!callId) return null;
  const call = await ProfessionalCall.findById(callId);
  if (!call || call.provider !== 'twilio') return null;
  const sid = String(callSid || '').trim();
  if (sid && call.provider_call_sid && sid !== call.provider_call_sid) return null;
  return call;
}

export async function twilioStatusWebhook(req, res) {
  if (!authorized(req)) return reject(res);
  const call = await matchingCall(req.query.callId, req.body?.CallSid);
  const next = mapTwilioStatus(req.body?.CallStatus);
  if (call && next && shouldAdvanceCallStatus(call.status, next)) {
    if (next === 'ended') {
      Object.assign(call, terminalVoiceUpdate(call));
    } else {
      call.status = next;
      if (next === 'active' && !call.started_at) {
        call.started_at = new Date();
        call.transcription_started_at = call.transcription_started_at || new Date();
        call.transcription_status = 'active';
      }
    }
    await call.save();
  }
  return res.json({ success: true });
}

export async function twilioRecordingWebhook(req, res) {
  if (!authorized(req)) return reject(res);
  const call = await matchingCall(req.query.callId, req.body?.CallSid);
  if (req.body?.RecordingStatus === 'completed' && call) {
    try {
      await enqueueRecordingFromWebhook({ callId: call._id, body: req.body });
    } catch (error) {
      logger.warn('Recording enqueue failed', { message: error?.message });
      return res.status(500).json({ success: false });
    }
  }
  return res.json({ success: true });
}

export async function twilioTranscriptionWebhook(req, res) {
  if (!authorized(req)) return reject(res);
  const callId = String(req.query.callId || req.body?.callId || '');
  const transcript = String(req.body?.TranscriptionText || req.body?.transcript || '').trim();
  if (callId && transcript) {
    await ingestFinalTranscriptSegment({
      callId,
      segmentId: String(req.body?.TranscriptionSid || `tx-${Date.now()}`),
      speakerUserId: 'caller',
      speakerName: 'Caller',
      text: transcript,
      provider: 'twilio',
      providerEventId: String(req.body?.TranscriptionSid || ''),
      model: 'twilio-transcription',
    });
  }
  return res.json({ success: true });
}
