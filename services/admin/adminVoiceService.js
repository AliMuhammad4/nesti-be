import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalCallRecording from '../../models/ProfessionalCallRecording.js';
import ProfessionalCallTranscriptSegment from '../../models/ProfessionalCallTranscriptSegment.js';
import ProfessionalCallMinutes from '../../models/ProfessionalCallMinutes.js';
import VoiceAgentSuggestion from '../../models/VoiceAgentSuggestion.js';
import { ok, fail } from './adminCommon.js';
import { adminHasPermission, ADMIN_PERMISSION as P } from '../../constants/adminPermissions.js';
import { startAdminVoiceCall, startAdminVoicePreview, startAdminLiveKitVoice, sendAdminVoicePreviewTurn, stopAdminVoiceCall } from '../proChat/twilioVoiceService.js';
import { normalizeE164 } from '../proChat/voicePhone.js';
import { createPrivateRecordingReadUrl, isPrivateRecordingsConfigured, uploadPrivateRecordingBuffer } from '../media/r2Client.js';
import VoiceAgentSalesSetting from '../../models/VoiceAgentSalesSetting.js';
import { allowedVoice, bargeIn, responseEagerness, salesSettingsView, silenceSeconds, speechSpeed } from '../proChat/voiceSalesBrief.js';
import { storeBrowserCallRecording } from '../proChat/recordingIngestionService.js';
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
    checkout_url: call.voice_checkout_url || '',
    voice_outcome: call.voice_outcome || '',
    voice_outcome_plan: call.voice_outcome_plan || '',
    voice_outcome_note: call.voice_outcome_note || '',
    voice_outcome_at: call.voice_outcome_at || null,
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
    voice: body?.voice,
  });
}

export async function adminStartVoicePreviewService(body, actorUser) {
  const targetType = voiceTargetType(body?.target_type);
  if (!targetType) return fail(400, 'Invalid voice target');
  if (!/^[a-f0-9]{24}$/i.test(String(body?.target_id || ''))) return fail(400, 'Invalid voice target');
  const needed = targetType === 'client' ? P.CLIENTS_WRITE : P.LEADS_WRITE;
  if (!adminHasPermission(actorUser, needed)) return fail(403, 'Missing write permission');
  return startAdminVoicePreview({ actorUser, targetType, targetId: body?.target_id });
}

export async function adminStartLiveKitVoiceService(body, actorUser) {
  const targetType = voiceTargetType(body?.target_type);
  if (!targetType) return fail(400, 'Invalid voice target');
  if (!/^[a-f0-9]{24}$/i.test(String(body?.target_id || ''))) return fail(400, 'Invalid voice target');
  const needed = targetType === 'client' ? P.CLIENTS_WRITE : P.LEADS_WRITE;
  if (!adminHasPermission(actorUser, needed)) return fail(403, 'Missing write permission');
  return startAdminLiveKitVoice({ actorUser, targetType, targetId: body?.target_id, voice: body?.voice });
}

export async function adminVoicePreviewTurnService(callId, body, actorUser) {
  const call = await ProfessionalCall.findById(callId).select('voice_target_type').lean();
  if (!call) return fail(404, 'Voice call not found');
  const needed = call.voice_target_type === 'client' ? P.CLIENTS_WRITE : P.LEADS_WRITE;
  if (!adminHasPermission(actorUser, needed)) return fail(403, 'Missing write permission');
  return sendAdminVoicePreviewTurn({ callId, text: body?.text });
}

export async function adminStoreCallRecordingService(callId, file, body, actorUser) {
  const call = await ProfessionalCall.findById(callId).select('voice_target_type').lean();
  if (!call) return fail(404, 'Voice call not found');
  const needed = call.voice_target_type === 'client' ? P.CLIENTS_WRITE : P.LEADS_WRITE;
  if (!adminHasPermission(actorUser, needed)) return fail(403, 'Missing write permission');
  if (!file?.buffer?.length) return fail(400, 'Recording file is missing');
  try {
    await storeBrowserCallRecording({
      callId,
      buffer: file.buffer,
      durationSeconds: Number(body?.duration_seconds) || 0,
    });
  } catch (error) {
    await ProfessionalCall.updateOne(
      { _id: callId },
      { $set: { recording_status: 'failed', recording_last_error: error?.message || 'Recording upload failed' } },
    );
    return fail(503, error?.message || 'Recording could not be saved');
  }
  return ok({ saved: true });
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
  const filter = { provider: { $in: ['twilio', 'preview', 'livekit'] }, voice_target_type: targetType };
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
  const listed = await Promise.all(items.map(async (row) => {
    const ready = row.ingest_status === 'ready' && row.r2_key;
    const url = ready
      ? await createPrivateRecordingReadUrl(row.r2_key, {
          expiresIn: 10 * 60,
          contentType: row.mime_type || 'audio/mpeg',
        })
      : '';
    return {
      id: String(row._id),
      recording_sid: row.recording_sid,
      duration_seconds: row.duration_seconds,
      ingest_status: row.ingest_status,
      bytes: row.bytes,
      checksum_sha256: row.checksum_sha256,
      legal_hold: row.legal_hold,
      createdAt: row.createdAt,
      url: url || '',
      expires_in: url ? 600 : 0,
    };
  }));
  return ok({ items: listed });
}

export async function adminRecordingPlaybackService(recordingId, actorUser) {
  const recording = await ProfessionalCallRecording.findById(recordingId).lean();
  if (!recording || recording.ingest_status !== 'ready' || !recording.r2_key) {
    return fail(404, 'Recording is not ready');
  }
  const call = await ProfessionalCall.findById(recording.call_id).lean();
  if (!call || !canRead(actorUser, call.voice_target_type)) return fail(403, 'Missing read permission');
  const url = await createPrivateRecordingReadUrl(recording.r2_key, {
    expiresIn: 10 * 60,
    contentType: recording.mime_type || 'audio/mpeg',
  });
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
    minutes: minutes?.status === 'ready'
      ? {
          summary: minutes.summary || '',
          topics: minutes.topics || [],
          decisions: minutes.decisions || [],
          action_items: minutes.action_items || [],
          follow_ups: minutes.follow_ups || [],
        }
      : null,
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

function canEditSalesSettings(user) {
  return adminHasPermission(user, P.CLIENTS_WRITE) || adminHasPermission(user, P.LEADS_WRITE);
}

function clip(value, max = 3000) {
  return String(value || '').trim().slice(0, max);
}

export async function adminGetSalesSettingsService(actorUser) {
  if (!canEditSalesSettings(actorUser) && !adminHasPermission(actorUser, P.CLIENTS_READ) && !adminHasPermission(actorUser, P.LEADS_READ)) {
    return fail(403, 'Missing read permission');
  }
  const doc = await VoiceAgentSalesSetting.findOne({ key: 'sales' }).lean();
  return ok(salesSettingsView(doc));
}

export async function adminSaveSalesSettingsService(body, actorUser) {
  if (!canEditSalesSettings(actorUser)) return fail(403, 'Missing write permission');
  const voice = allowedVoice(body?.voice, 'marin');
  const doc = await VoiceAgentSalesSetting.findOneAndUpdate(
    { key: 'sales' },
    {
      $set: {
        voice,
        speech_speed: speechSpeed(body?.speech_speed),
        vad_eagerness: responseEagerness(body?.vad_eagerness),
        barge_in: bargeIn(body?.barge_in),
        silence_seconds: silenceSeconds(body?.silence_seconds),
        client_services: clip(body?.client_services),
        agent_services: clip(body?.agent_services),
        broker_services: clip(body?.broker_services),
        lawyer_services: clip(body?.lawyer_services),
      },
      $setOnInsert: { key: 'sales' },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  return ok(salesSettingsView(doc));
}

async function cloneUploadedVoice(buffer, mime, previousId) {
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) return { id: '', error: 'Recording saved. The test call keeps the built-in voice until a cloned voice is connected.' };
  if (previousId) {
    await fetch(`https://api.elevenlabs.io/v1/voices/${previousId}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': key },
    }).catch(() => {});
  }
  const body = new FormData();
  body.append('name', 'Nesti Ravi');
  body.append('files', new Blob([buffer], { type: mime || 'audio/webm' }), 'ravi-voice.webm');
  const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.voice_id) {
    return { id: '', error: payload?.detail?.message || payload?.detail || 'The voice sample could not be cloned.' };
  }
  return { id: String(payload.voice_id), error: '' };
}

export async function adminSaveSalesVoiceSampleService(file, actorUser) {
  if (!canEditSalesSettings(actorUser)) return fail(403, 'Missing write permission');
  if (!file?.buffer?.length) return fail(400, 'Voice sample is missing');
  if (!isPrivateRecordingsConfigured()) return fail(503, 'Voice storage is not configured');
  const uploaded = await uploadPrivateRecordingBuffer(file.buffer, {
    key: `voice-agent/ravi-sample-${Date.now()}.webm`,
    mimeType: file.mimetype || 'audio/webm',
  });
  const current = await VoiceAgentSalesSetting.findOne({ key: 'sales' }).lean();
  const cloned = await cloneUploadedVoice(file.buffer, file.mimetype, current?.clone_voice_id);
  const doc = await VoiceAgentSalesSetting.findOneAndUpdate(
    { key: 'sales' },
    {
      $set: {
        sample_key: uploaded.key,
        clone_voice_id: cloned.id,
        clone_error: typeof cloned.error === 'string' ? cloned.error : 'The voice sample could not be cloned.',
      },
      $setOnInsert: { key: 'sales', voice: 'marin' },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  return ok(salesSettingsView(doc));
}
