import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalCallRecording from '../../models/ProfessionalCallRecording.js';
import ProfessionalCallTranscriptSegment from '../../models/ProfessionalCallTranscriptSegment.js';
import ProfessionalCallMinutes from '../../models/ProfessionalCallMinutes.js';
import VoiceAgentSuggestion from '../../models/VoiceAgentSuggestion.js';
import { ok, fail } from './adminCommon.js';
import { adminHasPermission, ADMIN_PERMISSION as P } from '../../constants/adminPermissions.js';
import { startAdminVoiceCall, stopAdminVoiceCall } from '../proChat/twilioVoiceService.js';
import { normalizeE164 } from '../proChat/voicePhone.js';
import { createPrivateRecordingReadUrl } from '../media/r2Client.js';
import { recordAdminAudit } from './adminAuditService.js';
import { decideVoiceSuggestion } from './adminVoiceActionService.js';

function canRead(user, targetType) {
  return adminHasPermission(user, targetType === 'client' ? P.CLIENTS_READ : P.LEADS_READ);
}

function serializeCall(call) {
  return {
    id: String(call._id),
    provider: call.provider,
    status: call.status,
    target_type: call.voice_target_type,
    target_id: call.voice_target_id,
    to: call.voice_to_phone,
    recording_status: call.recording_status,
    recording_count: call.recording_count || 0,
    transcription_status: call.transcription_status,
    transcription_error_message: call.transcription_error_message || '',
    recording_last_error: call.recording_last_error || '',
    minutes_status: call.minutes_status,
    started_at: call.started_at,
    ended_at: call.ended_at,
    createdAt: call.createdAt,
  };
}

function voiceTargetType(value) {
  if (value === 'client' || value === 'sales' || value === 'lead') return value;
  return '';
}

export async function adminStartVoiceCallService(body, actorUser) {
  const targetType = voiceTargetType(body?.target_type);
  if (!targetType) return fail(400, 'Invalid voice target');
  if (!/^[a-f0-9]{24}$/i.test(String(body?.target_id || ''))) return fail(400, 'Invalid voice target');
  if (body?.to_phone && !normalizeE164(body.to_phone)) return fail(400, 'A valid phone number is required');
  const needed = targetType === 'client' ? P.CLIENTS_WRITE : P.LEADS_WRITE;
  if (!adminHasPermission(actorUser, needed)) return fail(403, 'Missing write permission');
  return startAdminVoiceCall({
    actorUser,
    targetType,
    targetId: body?.target_id,
    toPhone: body?.to_phone,
    transcriptionConsent: body?.transcription_consent,
  });
}

export async function adminStopVoiceCallService(callId, actorUser) {
  const call = await ProfessionalCall.findById(callId).select('voice_target_type').lean();
  if (!call) return fail(404, 'Voice call not found');
  const needed = call.voice_target_type === 'client' ? P.CLIENTS_WRITE : P.LEADS_WRITE;
  if (!adminHasPermission(actorUser, needed)) return fail(403, 'Missing write permission');
  return stopAdminVoiceCall({ actorUser, callId });
}

export async function adminListVoiceCallsService(query, actorUser) {
  const targetType = query.target_type === 'client' || query.target_type === 'sales' ? query.target_type : 'lead';
  if (!canRead(actorUser, targetType)) return fail(403, 'Missing read permission');
  const filter = { provider: 'twilio', voice_target_type: targetType };
  if (query.target_id) filter.voice_target_id = String(query.target_id);
  const items = await ProfessionalCall.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  return ok({ items: items.map(serializeCall) });
}

export async function adminListCallRecordingsService(callId, actorUser) {
  const call = await ProfessionalCall.findById(callId).lean();
  if (!call) return fail(404, 'Voice call not found');
  if (!canRead(actorUser, call.voice_target_type)) return fail(403, 'Missing read permission');
  const items = await ProfessionalCallRecording.find({ call_id: callId, deleted_at: null })
    .sort({ createdAt: -1 })
    .lean();
  return ok({
    items: items.map((row) => ({
      id: String(row._id),
      recording_sid: row.recording_sid,
      duration_seconds: row.duration_seconds,
      ingest_status: row.ingest_status,
      bytes: row.bytes,
      checksum_sha256: row.checksum_sha256,
      legal_hold: row.legal_hold,
      createdAt: row.createdAt,
    })),
  });
}

export async function adminRecordingPlaybackService(recordingId, actorUser) {
  const recording = await ProfessionalCallRecording.findById(recordingId).lean();
  if (!recording || recording.ingest_status !== 'ready' || !recording.r2_key) {
    return fail(404, 'Recording is not ready');
  }
  const call = await ProfessionalCall.findById(recording.call_id).lean();
  if (!call || !canRead(actorUser, call.voice_target_type)) return fail(403, 'Missing read permission');
  const url = await createPrivateRecordingReadUrl(recording.r2_key, { expiresIn: 10 * 60 });
  if (!url) return fail(503, 'Signed playback is unavailable');
  await recordAdminAudit({
    actorUserId: actorUser?._id,
    action: 'voice.recording.playback',
    targetType: 'ProfessionalCallRecording',
    targetId: recordingId,
    meta: { call_id: String(call._id) },
  });
  return ok({ url, expires_in: 600 });
}

export async function adminCallTranscriptService(callId, actorUser) {
  const call = await ProfessionalCall.findById(callId).lean();
  if (!call) return fail(404, 'Voice call not found');
  if (!canRead(actorUser, call.voice_target_type)) return fail(403, 'Missing read permission');
  const segments = await ProfessionalCallTranscriptSegment.find({ call_id: callId, final: true })
    .sort({ createdAt: 1 })
    .lean();
  const minutes = await ProfessionalCallMinutes.findOne({ call_id: callId }).lean();
  return ok({
    call: serializeCall(call),
    segments: segments.map((row) => ({
      id: String(row._id),
      speaker_name: row.speaker_name,
      text: row.text,
      provider: row.provider,
      createdAt: row.createdAt,
    })),
    minutes: minutes?.status === 'ready' ? minutes.summary : '',
  });
}

export async function adminListVoiceSuggestionsService(callId, actorUser) {
  const call = await ProfessionalCall.findById(callId).lean();
  if (!call) return fail(404, 'Voice call not found');
  if (!canRead(actorUser, call.voice_target_type)) return fail(403, 'Missing read permission');
  const items = await VoiceAgentSuggestion.find({ call_id: callId }).sort({ createdAt: -1 }).lean();
  return ok({
    items: items.map((row) => ({
      id: String(row._id),
      action: row.action,
      payload: row.payload,
      confidence: row.confidence,
      rationale: row.rationale,
      status: row.status,
    })),
  });
}

export async function adminDecideVoiceSuggestionService(suggestionId, body, actorUser) {
  return decideVoiceSuggestion({
    suggestionId,
    actorUser,
    decision: body?.decision,
  });
}
