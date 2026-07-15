import { isValidObjectId } from 'mongoose';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalCallMinutes from '../../models/ProfessionalCallMinutes.js';
import ProfessionalCallTranscriptSegment from '../../models/ProfessionalCallTranscriptSegment.js';
import {
  sanitizeArtifactErrorMessage,
  serializeCallArtifactStatus,
} from './callArtifactFields.js';

const MAX_PAGE_SIZE = 200;

function text(value) {
  return String(value || '').trim();
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function authorizedCall(currentUserId, callId) {
  const normalizedCallId = text(callId);
  if (!isValidObjectId(normalizedCallId)) {
    return {
      error: { status: 400, body: { success: false, message: 'Invalid call record id' } },
    };
  }
  const call = await ProfessionalCall.findOne({
    _id: normalizedCallId,
    participant_ids: text(currentUserId),
  }).lean();
  if (!call) {
    return {
      error: { status: 404, body: { success: false, message: 'Call record not found' } },
    };
  }
  return { call };
}

function artifactStatus(call) {
  return serializeCallArtifactStatus(call);
}

function serializeSegment(segment) {
  return {
    id: text(segment._id),
    segment_id: text(segment.segment_id),
    speaker_user_id: text(segment.speaker_user_id),
    speaker_name: text(segment.speaker_name) || 'Participant',
    text: segment.text,
    language: text(segment.language),
    start_time_ms: Number(segment.start_time_ms || 0),
    end_time_ms: Number(segment.end_time_ms || 0),
    confidence:
      segment.confidence == null || !Number.isFinite(Number(segment.confidence))
        ? null
        : Number(segment.confidence),
    created_at: segment.createdAt || null,
  };
}

function serializeMinutes(minutes) {
  if (!minutes) return null;
  return {
    summary: minutes.summary || '',
    topics: minutes.topics || [],
    decisions: minutes.decisions || [],
    action_items: minutes.action_items || [],
    follow_ups: minutes.follow_ups || [],
    model: minutes.model || '',
    prompt_version: minutes.prompt_version || '',
    transcript_segment_count: minutes.transcript_segment_count || 0,
    transcript_character_count: minutes.transcript_character_count || 0,
    chunk_count: minutes.chunk_count || 0,
    ready_at: minutes.ready_at || null,
  };
}

export async function getCallArtifactStatus({ currentUserId, callId }) {
  const auth = await authorizedCall(currentUserId, callId);
  if (auth.error) return auth.error;
  const storedCount = Number(auth.call.transcript_segment_count || 0);
  const segmentCount =
    storedCount > 0
      ? storedCount
      : await ProfessionalCallTranscriptSegment.countDocuments({
          call_id: auth.call._id,
          final: true,
        });
  return {
    status: 200,
    body: {
      success: true,
      artifacts: {
        ...artifactStatus(auth.call),
        transcript_segment_count: segmentCount,
      },
    },
  };
}

export async function getCallTranscript({ currentUserId, callId, page, limit }) {
  const auth = await authorizedCall(currentUserId, callId);
  if (auth.error) return auth.error;
  const pageNumber = positiveInt(page, 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, positiveInt(limit, 100));
  const filter = { call_id: auth.call._id, final: true };
  const [segments, total] = await Promise.all([
    ProfessionalCallTranscriptSegment.find(filter)
      .sort({ start_time_ms: 1, _id: 1 })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    ProfessionalCallTranscriptSegment.countDocuments(filter),
  ]);
  return {
    status: 200,
    body: {
      success: true,
      artifacts: artifactStatus(auth.call),
      segments: segments.map(serializeSegment),
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    },
  };
}

export async function getCallMinutes({ currentUserId, callId }) {
  const auth = await authorizedCall(currentUserId, callId);
  if (auth.error) return auth.error;
  const minutes = await ProfessionalCallMinutes.findOne({ call_id: auth.call._id }).lean();
  return {
    status: 200,
    body: {
      success: true,
      artifacts: artifactStatus(auth.call),
      minutes: minutes?.status === 'ready' ? serializeMinutes(minutes) : null,
      processing: minutes
        ? {
            status: minutes.status,
            attempts: minutes.attempts || 0,
            last_error: sanitizeArtifactErrorMessage(minutes.last_error || '', ''),
            next_attempt_at: minutes.next_attempt_at || null,
          }
        : null,
    },
  };
}
