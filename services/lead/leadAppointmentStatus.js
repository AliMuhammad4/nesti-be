import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import ChatConversation from '../../models/ChatConversation.js';
import WorkspaceAppointment from '../../models/WorkspaceAppointment.js';
import {
  resolveAppointmentStatus,
  MATCH_STATUSES_MEETING_BOOKED,
} from '../../utils/resolveAppointmentStatus.js';

function toOidArray(ids) {
  return [...new Set((ids || []).map((id) => String(id)).filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
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
    const wsRows = await WorkspaceAppointment.find({ user_id: uid, status: 'booked' })
      .select('lead_match_id conversation_id scheduled_start')
      .lean();
    const wsFuture = wsRows.filter((r) => {
      const d = r?.scheduled_start ? new Date(r.scheduled_start) : null;
      return d && !Number.isNaN(d.getTime()) && d.getTime() >= now.getTime();
    });
    const convOr = toOidArray([
      ...wsFuture.map((r) => r.conversation_id).filter(Boolean),
    ]);
    const leadOr = toOidArray(wsFuture.map((r) => r.lead_match_id).filter(Boolean));
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
    const wsBooked = await WorkspaceAppointment.find({ user_id: uid, status: 'booked' })
      .select('lead_match_id conversation_id scheduled_start')
      .lean();
    const wsFuture = wsBooked.filter((r) => {
      const d = r?.scheduled_start ? new Date(r.scheduled_start) : null;
      return d && !Number.isNaN(d.getTime()) && d.getTime() >= now.getTime();
    });
    const exclude = toOidArray([
      ...wsFuture.map((r) => r.conversation_id).filter(Boolean),
    ]);
    const excludeLeadIds = toOidArray(wsFuture.map((r) => r.lead_match_id).filter(Boolean));
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
  const ids = (profileIds || []).map((id) => String(id)).filter(Boolean);
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
