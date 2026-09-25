import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalCallTranscriptSegment from '../../models/ProfessionalCallTranscriptSegment.js';
import { refineTranscriptSegmentText, resolveSegmentLanguage } from './transcriptTextCleaning.js';

const DEFAULT_SEGMENT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

function text(value) {
  return String(value || '').trim();
}

async function resolveSegmentDeleteAt(callId) {
  const call = await ProfessionalCall.findById(callId).select('delete_at ended_at').lean();
  if (call?.delete_at) return new Date(call.delete_at);
  const base = call?.ended_at ? new Date(call.ended_at).getTime() : Date.now();
  return new Date(base + DEFAULT_SEGMENT_RETENTION_MS);
}

export function callRelativeTranscriptTimes(
  alternative,
  timestampOffsetMs = 0,
  { nowMs = Date.now(), callStartedAtMs = null } = {},
) {
  const altStartSec = Number(alternative?.startTime || 0);
  const altEndSec = Number(alternative?.endTime || 0);
  const hasProviderTiming =
    Number.isFinite(altStartSec) &&
    Number.isFinite(altEndSec) &&
    (altStartSec > 0 || altEndSec > 0);

  if (!hasProviderTiming) {
    const callStart = Number(callStartedAtMs);
    if (Number.isFinite(callStart) && callStart > 0) {
      const elapsed = Math.max(0, Math.round(Number(nowMs) - callStart));
      return { startTimeMs: elapsed, endTimeMs: elapsed };
    }
    const offset = Math.max(0, Math.round(Number(timestampOffsetMs || 0)));
    return { startTimeMs: offset, endTimeMs: offset };
  }

  const offset = Math.max(0, Math.round(Number(timestampOffsetMs || 0)));
  const startTimeMs = offset + Math.max(0, Math.round(altStartSec * 1000));
  const endTimeMs = Math.max(
    startTimeMs,
    offset + Math.max(0, Math.round(altEndSec * 1000)),
  );
  return { startTimeMs, endTimeMs };
}

export async function ingestFinalTranscriptSegment({
  callId,
  segmentId,
  speakerUserId,
  speakerName,
  trackSid = '',
  text: rawText,
  language = '',
  startTimeMs,
  endTimeMs,
  confidence = null,
  provider = 'openai',
  providerEventId = '',
  model,
}) {
  const finalText = refineTranscriptSegmentText(rawText);
  if (!finalText || !callId || !segmentId) return false;
  const deleteAt = await resolveSegmentDeleteAt(callId);
  const eventKey = text(providerEventId);
  const result = await ProfessionalCallTranscriptSegment.updateOne(
    eventKey
      ? { call_id: callId, provider_event_id: eventKey }
      : { call_id: callId, segment_id: segmentId },
    {
      $setOnInsert: {
        call_id: callId,
        segment_id: segmentId,
        speaker_user_id: text(speakerUserId) || 'speaker',
        speaker_name: text(speakerName) || 'Participant',
        track_sid: text(trackSid),
        text: finalText,
        language: text(language),
        start_time_ms: Math.max(0, Number(startTimeMs) || 0),
        end_time_ms: Math.max(0, Number(endTimeMs) || 0),
        confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
        provider: text(provider) || 'openai',
        provider_event_id: eventKey,
        model: text(model) || 'unknown',
        final: true,
        delete_at: deleteAt,
      },
    },
    { upsert: true },
  );
  if (result.upsertedCount) {
    await ProfessionalCall.updateOne(
      { _id: callId },
      {
        $inc: { transcript_segment_count: 1 },
        $set: { transcript_updated_at: new Date() },
      },
    );
    await ProfessionalCall.updateOne(
      {
        _id: callId,
        status: { $in: ['ended', 'expired'] },
        transcription_status: { $in: ['completed', 'disabled'] },
        minutes_status: { $ne: 'ready' },
      },
      {
        $set: {
          transcription_status: 'completed',
          transcription_error_code: '',
          transcription_error_message: '',
          minutes_status: 'pending',
        },
      },
    );
  }
  return Boolean(result.upsertedCount || result.matchedCount);
}

export async function persistFinalTranscriptSegment({
  callId,
  segmentId,
  participant,
  publication,
  alternative,
  model,
  timestampOffsetMs = 0,
  callStartedAtMs = null,
  nowMs = Date.now(),
}) {
  const { startTimeMs, endTimeMs } = callRelativeTranscriptTimes(
    alternative,
    timestampOffsetMs,
    { nowMs, callStartedAtMs },
  );
  return ingestFinalTranscriptSegment({
    callId,
    segmentId,
    speakerUserId: participant.identity,
    speakerName: text(participant.name) || 'Participant',
    trackSid: text(publication.sid),
    text: alternative?.text,
    language: resolveSegmentLanguage(alternative),
    startTimeMs,
    endTimeMs,
    confidence: alternative?.confidence,
    provider: 'openai',
    model,
  });
}
