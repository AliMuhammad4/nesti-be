import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import ChatConversation from '../../models/ChatConversation.js';
import WorkspaceAppointment from '../../models/WorkspaceAppointment.js';
import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
import { normalizeProfileIdList } from './leadQueryUtils.js';

function toObjectIdList(ids) {
  return [...new Set((ids || []).map((id) => String(id)).filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

function isFutureScheduledStart(scheduledStart, now = new Date()) {
  const d = scheduledStart ? new Date(scheduledStart) : null;
  return d && !Number.isNaN(d.getTime()) && d.getTime() >= now.getTime();
}

async function fetchFutureBookedWorkspaceAppointments(userObjectId, now = new Date()) {
  const rows = await WorkspaceAppointment.find({ user_id: userObjectId, status: 'booked' })
    .select('lead_match_id conversation_id scheduled_start')
    .lean();
  return rows.filter((r) => isFutureScheduledStart(r?.scheduled_start, now));
}

/** Query values for GET /api/leads?appointment= */
export const LEAD_LIST_APPOINTMENT_QUERY = ['all', 'booked', 'canceled', 'not_booked'];

/**
 * Mongo fragment for leads list appointment filter (combined with $and on base match).
 * @param {import('mongoose').Types.ObjectId} userObjectId
 * @param {string} [appointment]
 * @returns {Promise<object|null>} filter object or null when no extra filter
 */
export async function buildAppointmentMongoFilter(userObjectId, appointment) {
  const a = String(appointment || 'all').trim().toLowerCase();
  if (!a || a === 'all' || !LEAD_LIST_APPOINTMENT_QUERY.includes(a)) return null;

  const uid = userObjectId;
  const now = new Date();

  if (a === 'booked') {
    /** Lawyer/embed paths can have WorkspaceAppointment before ChatConversation is synced. */
    const wsFuture = await fetchFutureBookedWorkspaceAppointments(uid, now);
    const convOr = toObjectIdList(wsFuture.map((r) => r.conversation_id).filter(Boolean));
    const leadOr = toObjectIdList(wsFuture.map((r) => r.lead_match_id).filter(Boolean));
    const orClause = [
      { 'compatibility_factors.calendly.calendly_event_start': { $gte: now } },
    ];
    if (convOr.length) orClause.push({ conversation_id: { $in: convOr } });
    if (leadOr.length) orClause.push({ _id: { $in: leadOr } });
    return { $or: orClause };
  }

  if (a === 'canceled') {
    const canceledConvIds = await ChatConversation.find({
      user_id: uid,
      calendly_booking_status: 'canceled',
    }).distinct('_id');
    return { conversation_id: { $in: canceledConvIds } };
  }

  if (a === 'not_booked') {
    const wsFuture = await fetchFutureBookedWorkspaceAppointments(uid, now);
    const exclude = toObjectIdList(wsFuture.map((r) => r.conversation_id).filter(Boolean));
    const excludeLeadIds = toObjectIdList(wsFuture.map((r) => r.lead_match_id).filter(Boolean));
    const andClauses = [
      {
        $or: [
          { 'compatibility_factors.calendly.calendly_event_start': { $exists: false } },
          { 'compatibility_factors.calendly.calendly_event_start': null },
          { 'compatibility_factors.calendly.calendly_event_start': { $lt: now } },
        ],
      },
      {
        $or: [
          { conversation_id: null },
          { conversation_id: { $exists: false } },
          { conversation_id: { $nin: exclude } },
        ],
      },
    ];
    if (excludeLeadIds.length) {
      andClauses.push({ _id: { $nin: excludeLeadIds } });
    }
    return { $and: andClauses };
  }

  return null;
}

export async function buildAppointmentStatusByProfileIds(userObjectId, profileIds) {
  const map = new Map();
  const ids = normalizeProfileIdList(profileIds);
  if (!ids.length) return map;
  const matches = await LeadMatch.find({
    user_id: userObjectId,
    lead_profile_id: { $in: ids },
  })
    .select('lead_profile_id match_status conversation_id compatibility_factors')
    .lean();
  const convoIds = [...new Set(matches.map((m) => m.conversation_id).filter(Boolean).map(String))];
  const conversations =
    convoIds.length > 0
      ? await ChatConversation.find({ _id: { $in: convoIds } })
          .select('calendly_booking_status')
          .lean()
      : [];
  const convoById = new Map(conversations.map((c) => [String(c._id), c]));
  const byProfile = new Map();
  for (const m of matches) {
    const pid = String(m.lead_profile_id);
    if (!pid) continue;
    const convo = convoById.get(String(m.conversation_id)) || {};
    const st = resolveAppointmentStatus(
      m.match_status,
      convo.calendly_booking_status,
      m?.compatibility_factors?.calendly?.calendly_event_start || null
    );
    if (!byProfile.has(pid)) byProfile.set(pid, []);
    byProfile.get(pid).push(st);
  }

  for (const pid of ids) {
    const statuses = byProfile.get(pid) || [];
    if (!statuses.length) {
      map.set(pid, 'not_booked');
      continue;
    }
    if (statuses.includes('booked')) map.set(pid, 'booked');
    else if (statuses.includes('canceled')) map.set(pid, 'canceled');
    else map.set(pid, 'not_booked');
  }

  return map;
}

export const LEAD_LIST_CONVERSATION_FIELDS =
  'calendly_booking_status calendly_event_start session_id';

/**
 * Single query for booked workspace appointments by lead_match_id and/or conversation_id.
 */
export async function fetchBookedWorkspaceAppointments(userId, leadMatchObjectIds, conversationObjectIds) {
  const leadIds = toObjectIdList(leadMatchObjectIds);
  const convoIds = toObjectIdList(conversationObjectIds);
  if (!leadIds.length && !convoIds.length) {
    return {
      bookedLeadIds: new Set(),
      bookedConvoIds: new Set(),
      startByLeadId: new Map(),
      startByConversationId: new Map(),
    };
  }
  const now = new Date();
  const orClauses = [];
  if (leadIds.length) orClauses.push({ lead_match_id: { $in: leadIds } });
  if (convoIds.length) orClauses.push({ conversation_id: { $in: convoIds } });
  const rows = await WorkspaceAppointment.find({
    user_id: userId,
    status: 'booked',
    scheduled_start: { $gte: now },
    $or: orClauses,
  })
    .select('lead_match_id conversation_id scheduled_start')
    .sort({ scheduled_start: 1, recorded_at: -1 })
    .lean();

  const bookedLeadIds = new Set();
  const bookedConvoIds = new Set();
  const startByLeadId = new Map();
  const startByConversationId = new Map();
  for (const r of rows) {
    if (r.lead_match_id) bookedLeadIds.add(String(r.lead_match_id));
    if (r.conversation_id) bookedConvoIds.add(String(r.conversation_id));
    const start = r?.scheduled_start ? new Date(r.scheduled_start) : null;
    if (!start || Number.isNaN(start.getTime())) continue;
    if (r.lead_match_id) {
      const k = String(r.lead_match_id);
      if (!startByLeadId.has(k)) startByLeadId.set(k, start.toISOString());
    }
    if (r.conversation_id) {
      const k = String(r.conversation_id);
      if (!startByConversationId.has(k)) startByConversationId.set(k, start.toISOString());
    }
  }
  return { bookedLeadIds, bookedConvoIds, startByLeadId, startByConversationId };
}

export function mergeConvoWithWorkspaceBooking(
  conversation,
  leadMatchId,
  leadConversationId,
  bookedLeadIdSet,
  bookedConversationIdSet,
  startByLeadId = new Map(),
  startByConversationId = new Map(),
) {
  const c = conversation && typeof conversation === 'object' ? conversation : {};
  const convoKey = c._id ? String(c._id) : leadConversationId ? String(leadConversationId) : null;
  const leadKey = leadMatchId ? String(leadMatchId) : null;
  const leadBooked = leadKey && bookedLeadIdSet.has(leadKey);
  const convoBooked = convoKey && bookedConversationIdSet.has(convoKey);
  const startsAt =
    (leadKey ? startByLeadId.get(leadKey) : null) ||
    (convoKey ? startByConversationId.get(convoKey) : null) ||
    null;
  const next = { ...c };
  if ((leadBooked || convoBooked) && !c.calendly_booking_status) {
    next.calendly_booking_status = 'booked';
  }
  if (startsAt && !next.calendly_event_start) {
    next.calendly_event_start = startsAt;
  }
  return next;
}
