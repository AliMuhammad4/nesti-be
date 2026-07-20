import { isValidObjectId } from 'mongoose';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import User from '../../models/User.js';
import {
  participantConsentFields,
  redactCallArtifactsForViewer,
  serializeCallArtifacts,
  viewerCanAccessCallNotes,
} from './callArtifactFields.js';

const CALL_STATUSES = new Set([
  'preparing',
  'ringing',
  'connecting',
  'active',
  'declined',
  'ended',
  'expired',
  'unanswered',
]);
const CALL_TYPES = new Set(['voice', 'video']);
const MAX_PAGE_SIZE = 100;

function text(value) {
  return String(value || '').trim();
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function durationSeconds(call) {
  const startedAt = call.started_at ? new Date(call.started_at).getTime() : 0;
  if (!startedAt) return 0;
  const endedAt = call.ended_at ? new Date(call.ended_at).getTime() : Date.now();
  return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
}

function userSummary(user, fallbackId) {
  const id = text(user?._id || fallbackId);
  const fullName =
    [user?.first_name, user?.last_name].map(text).filter(Boolean).join(' ') ||
    text(user?.email) ||
    'Participant';
  return {
    id,
    full_name: fullName,
    role: text(user?.role),
    profile_image: text(user?.profile_image),
  };
}

function serializeCall(call, currentUserId, usersById, thread) {
  const uid = text(currentUserId);
  const direction = text(call.caller_id) === uid ? 'outgoing' : 'incoming';
  const storedStatus = text(call.status);
  const status =
    storedStatus === 'ended' && !call.started_at
      ? direction === 'outgoing'
        ? 'unanswered'
        : 'expired'
      : storedStatus;
  const participantIds = Array.isArray(call.participant_ids)
    ? call.participant_ids.map(text).filter(Boolean)
    : [];
  const consentByUserId = new Map(
    (call.participant_states || []).map((participant) => [
      text(participant.user_id),
      participantConsentFields(participant),
    ]),
  );
  const participants = participantIds.map((id) => ({
    ...userSummary(usersById.get(id), id),
    ...(consentByUserId.get(id) || participantConsentFields()),
  }));
  const callId = text(call._id);
  const canAccessNotes = viewerCanAccessCallNotes(call, uid);
  const myConsent = participants.find((participant) => participant.id === uid);
  return {
    id: callId,
    call_id: callId,
    thread_id: text(call.thread_id),
    room_name: text(call.room_name),
    call_type: text(call.call_type),
    status,
    direction,
    caller_id: text(call.caller_id),
    participants,
    other_participants: participants.filter((participant) => participant.id !== uid),
    thread: thread
      ? {
          id: text(thread._id),
          thread_type: text(thread.thread_type),
          title: text(thread.title),
        }
      : null,
    created_at: call.createdAt || null,
    invited_at: call.invited_at || null,
    connecting_at: call.connecting_at || null,
    started_at: call.started_at || null,
    ended_at: call.ended_at || null,
    ended_by_id: text(call.ended_by_id),
    duration_seconds: durationSeconds(call),
    viewer_transcription_consent:
      myConsent?.transcription_consent === true
        ? true
        : myConsent?.transcription_consent === false
          ? false
          : null,
    viewer_can_access_notes: canAccessNotes,
    artifacts: canAccessNotes
      ? serializeCallArtifacts(call)
      : redactCallArtifactsForViewer(call),
  };
}

async function enrichCalls(calls, currentUserId) {
  const userIds = [
    ...new Set(calls.flatMap((call) => call.participant_ids || []).map(text).filter(Boolean)),
  ];
  const threadIds = [...new Set(calls.map((call) => text(call.thread_id)).filter(isValidObjectId))];
  const [users, threads] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select('first_name last_name role profile_image')
          .lean()
      : [],
    threadIds.length
      ? ProfessionalChatThread.find({ _id: { $in: threadIds } })
          .select('thread_type title')
          .lean()
      : [],
  ]);
  const usersById = new Map(users.map((user) => [text(user._id), user]));
  const threadsById = new Map(threads.map((thread) => [text(thread._id), thread]));
  return calls.map((call) =>
    serializeCall(call, currentUserId, usersById, threadsById.get(text(call.thread_id))),
  );
}

function buildFilters({ currentUserId, status, callType, threadId, from, to }) {
  const filter = { participant_ids: text(currentUserId) };
  const normalizedStatus = text(status).toLowerCase();
  const normalizedType = text(callType).toLowerCase();
  const normalizedThreadId = text(threadId);
  if (normalizedStatus) {
    if (!CALL_STATUSES.has(normalizedStatus)) {
      return { error: { status: 400, body: { success: false, message: 'Invalid call status' } } };
    }
    if (normalizedStatus === 'ended') {
      filter.status = 'ended';
      filter.started_at = { $ne: null };
    } else if (normalizedStatus === 'expired') {
      filter.$or = [
        { status: 'expired' },
        {
          status: 'ended',
          started_at: null,
          caller_id: { $ne: text(currentUserId) },
        },
      ];
    } else if (normalizedStatus === 'unanswered') {
      filter.status = 'ended';
      filter.started_at = null;
      filter.caller_id = text(currentUserId);
    } else {
      filter.status = normalizedStatus;
    }
  }
  if (normalizedType) {
    if (!CALL_TYPES.has(normalizedType)) {
      return { error: { status: 400, body: { success: false, message: 'Invalid call type' } } };
    }
    filter.call_type = normalizedType;
  }
  if (normalizedThreadId) {
    if (!isValidObjectId(normalizedThreadId)) {
      return { error: { status: 400, body: { success: false, message: 'Invalid thread id' } } };
    }
    filter.thread_id = normalizedThreadId;
  }
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if ((from && !fromDate) || (to && !toDate)) {
    return { error: { status: 400, body: { success: false, message: 'Invalid date range' } } };
  }
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = fromDate;
    if (toDate) filter.createdAt.$lte = toDate;
  }
  return { filter };
}

export async function listCallRecords({
  currentUserId,
  page,
  limit,
  status,
  callType,
  threadId,
  from,
  to,
}) {
  const pageNumber = positiveInt(page, 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, positiveInt(limit, 20));
  const built = buildFilters({ currentUserId, status, callType, threadId, from, to });
  if (built.error) return built.error;
  const [calls, total] = await Promise.all([
    ProfessionalCall.find(built.filter)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    ProfessionalCall.countDocuments(built.filter),
  ]);
  const records = await enrichCalls(calls, currentUserId);
  return {
    status: 200,
    body: {
      success: true,
      records,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    },
  };
}

export async function getCallRecord({ currentUserId, callId }) {
  const normalizedCallId = text(callId);
  if (!isValidObjectId(normalizedCallId)) {
    return { status: 400, body: { success: false, message: 'Invalid call record id' } };
  }
  const call = await ProfessionalCall.findOne({
    _id: normalizedCallId,
    participant_ids: text(currentUserId),
  }).lean();
  if (!call) {
    return { status: 404, body: { success: false, message: 'Call record not found' } };
  }
  const [record] = await enrichCalls([call], currentUserId);
  return { status: 200, body: { success: true, record } };
}
