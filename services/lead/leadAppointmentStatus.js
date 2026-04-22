import LeadMatch from '../../models/LeadMatch.js';
import ChatConversation from '../../models/ChatConversation.js';
import {
  resolveAppointmentStatus,
  MATCH_STATUSES_MEETING_BOOKED,
} from '../../utils/resolveAppointmentStatus.js';

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

  if (a === 'booked') {
    const bookedConvIds = await ChatConversation.find({
      user_id: uid,
      calendly_booking_status: 'booked',
    }).distinct('_id');
    return {
      $or: [
        { match_status: { $in: MATCH_STATUSES_MEETING_BOOKED } },
        { conversation_id: { $in: bookedConvIds } },
      ],
    };
  }

  if (a === 'canceled') {
    const canceledConvIds = await ChatConversation.find({
      user_id: uid,
      calendly_booking_status: 'canceled',
    }).distinct('_id');
    return { conversation_id: { $in: canceledConvIds } };
  }

  if (a === 'not_booked') {
    const bookedConvIds = await ChatConversation.find({
      user_id: uid,
      calendly_booking_status: 'booked',
    }).distinct('_id');
    const canceledConvIds = await ChatConversation.find({
      user_id: uid,
      calendly_booking_status: 'canceled',
    }).distinct('_id');
    const exclude = [...bookedConvIds, ...canceledConvIds];
    return {
      $and: [
        { match_status: { $nin: MATCH_STATUSES_MEETING_BOOKED } },
        {
          $or: [
            { conversation_id: null },
            { conversation_id: { $exists: false } },
            { conversation_id: { $nin: exclude } },
          ],
        },
      ],
    };
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
    .select('lead_profile_id match_status conversation_id')
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
    const st = resolveAppointmentStatus(m.match_status, convo.calendly_booking_status);
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
