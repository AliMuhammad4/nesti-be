import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import NurtureLog from '../../models/NurtureLog.js';
import LeadKpiEvent from '../../models/LeadKpiEvent.js';
import WorkspaceAppointment from '../../models/WorkspaceAppointment.js';
import {
  resolveAppointmentStatus,
  MATCH_STATUSES_MEETING_BOOKED,
} from '../../utils/resolveAppointmentStatus.js';
import {
  buildCalendarBookingRow,
  firstValidDate,
  parseValidDate,
  sortBookingsByStartDesc,
} from './calendarBookingDisplay.js';

const KPI_APPOINTMENT_BOOKED = 'appointment_booked';
const KPI_BOOKING_LOOKBACK_MS = 366 * 24 * 60 * 60 * 1000;
const LEAD_FIELDS = '_id lead_profile_id conversation_id match_status compatibility_factors lead_type';
const PROFILE_FIELDS = 'identity intent property.property_type';
const CONV_FIELDS = 'calendly_booking_status calendly_booking_at intent';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function toOidArray(ids) {
  return ids.map((id) => new mongoose.Types.ObjectId(String(id)));
}

function collectIds(docs, key) {
  const set = new Set();
  for (const d of docs) {
    const v = d[key];
    if (v) set.add(String(v));
  }
  return [...set];
}

async function loadProfileAndConvMaps(profileIds, convIds) {
  const [profiles, conversations] = await Promise.all([
    profileIds.length
      ? LeadProfile.find({ _id: { $in: toOidArray(profileIds) } }).select(PROFILE_FIELDS).lean()
      : [],
    convIds.length
      ? ChatConversation.find({ _id: { $in: toOidArray(convIds) } }).select(CONV_FIELDS).lean()
      : [],
  ]);
  return {
    profileMap: new Map(profiles.map((p) => [String(p._id), p])),
    convMap: new Map(conversations.map((c) => [String(c._id), c])),
  };
}

// ─── Primary: WorkspaceAppointment collection ─────────────────────────────────

async function listCollectionAppointments(uid) {
  const apptDocs = await WorkspaceAppointment.find({ user_id: uid, status: 'booked' })
    .sort({ scheduled_start: -1, recorded_at: -1 })
    .limit(500)
    .lean();

  if (!apptDocs.length) return { rows: [], coveredMatchIds: new Set() };

  const matchIds = collectIds(apptDocs, 'lead_match_id');
  const leads = matchIds.length
    ? await LeadMatch.find({ _id: { $in: toOidArray(matchIds) } }).select(LEAD_FIELDS).lean()
    : [];
  const leadMap = new Map(leads.map((l) => [String(l._id), l]));

  const profileIds = new Set(collectIds(apptDocs, 'lead_profile_id'));
  const convIds = new Set(collectIds(apptDocs, 'conversation_id'));
  for (const l of leads) {
    if (l.lead_profile_id) profileIds.add(String(l.lead_profile_id));
    if (l.conversation_id) convIds.add(String(l.conversation_id));
  }

  const { profileMap, convMap } = await loadProfileAndConvMaps([...profileIds], [...convIds]);

  const rows = [];
  const coveredMatchIds = new Set();

  for (const a of apptDocs) {
    const lm = a.lead_match_id ? String(a.lead_match_id) : null;
    if (!lm) continue;
    coveredMatchIds.add(lm);

    const lead = leadMap.get(lm);
    const convId = String(a.conversation_id || lead?.conversation_id || '');
    const conv = convId ? convMap.get(convId) : null;

    const profileId = String(a.lead_profile_id || lead?.lead_profile_id || '');
    const profile = profileId ? profileMap.get(profileId) : null;

    rows.push(
      buildCalendarBookingRow({
        leadMatchId: lm,
        conversationId: convId || null,
        matchStatus: lead?.match_status || 'consult_booked',
        startsAt: firstValidDate(a.scheduled_start, a.recorded_at),
        profile,
        conv,
        calFromLead: lead?.compatibility_factors?.calendly,
        inviteeEmailFallback: a.invitee_email,
        workspaceAppointment: a,
      }),
    );
  }

  return { rows, coveredMatchIds };
}

// ─── Legacy: old bookings without WorkspaceAppointment docs ───────────────────

async function listLegacyBookedAppointments(uid) {
  const kpiSince = new Date(Date.now() - KPI_BOOKING_LOOKBACK_MS);

  const kpiBookedAgg = await LeadKpiEvent.aggregate([
    {
      $match: {
        user_id: uid,
        event_type: KPI_APPOINTMENT_BOOKED,
        occurred_at: { $gte: kpiSince },
        lead_match_id: { $ne: null },
      },
    },
    { $sort: { occurred_at: -1 } },
    { $group: { _id: '$lead_match_id', occurred_at: { $first: '$occurred_at' } } },
  ]);
  const kpiOccurredByMatch = new Map(
    kpiBookedAgg.map((r) => [String(r._id), r.occurred_at]),
  );
  const kpiMatchIds = kpiBookedAgg.map((r) => r._id).filter(Boolean);

  const bookedConvIds = await ChatConversation.find({
    user_id: uid,
    calendly_booking_status: 'booked',
  }).distinct('_id');

  const orClauses = [
    ...(bookedConvIds.length ? [{ conversation_id: { $in: bookedConvIds } }] : []),
    { match_status: { $in: MATCH_STATUSES_MEETING_BOOKED } },
    ...(kpiMatchIds.length ? [{ _id: { $in: kpiMatchIds } }] : []),
  ];

  const leads = await LeadMatch.find({ user_id: uid, $or: orClauses })
    .select(LEAD_FIELDS)
    .sort({ updatedAt: -1 })
    .limit(300)
    .lean();

  const seen = new Set();
  const uniqueLeads = leads.filter((l) => {
    const k = String(l._id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const convIds = collectIds(uniqueLeads, 'conversation_id');
  const profileIds = collectIds(uniqueLeads, 'lead_profile_id');
  const { profileMap, convMap } = await loadProfileAndConvMaps(profileIds, convIds);

  const matchIdsForNurture = uniqueLeads.map((l) => l._id).filter(Boolean);
  const nurtureLogRows = matchIdsForNurture.length
    ? await NurtureLog.find({
        user_id: uid,
        lead_match_id: { $in: matchIdsForNurture },
        meeting_booked: true,
        calendly_scheduled_start: { $ne: null },
      })
        .select('lead_match_id calendly_scheduled_start')
        .sort({ meeting_booked_at: -1 })
        .lean()
    : [];

  const nurtureStartByMatch = new Map();
  for (const row of nurtureLogRows) {
    const k = row.lead_match_id ? String(row.lead_match_id) : '';
    if (k && !nurtureStartByMatch.has(k)) nurtureStartByMatch.set(k, row.calendly_scheduled_start);
  }

  const bookings = [];
  for (const lead of uniqueLeads) {
    const conv = lead.conversation_id ? convMap.get(String(lead.conversation_id)) : null;
    const appt = resolveAppointmentStatus(lead.match_status, conv?.calendly_booking_status);
    const countedInKpi = kpiOccurredByMatch.has(String(lead._id));
    if (appt !== 'booked' && !countedInKpi) continue;
    if (conv?.calendly_booking_status === 'canceled') continue;

    const cal = lead.compatibility_factors?.calendly;
    if (cal?.calendly_canceled) continue;

    const profile = lead.lead_profile_id ? profileMap.get(String(lead.lead_profile_id)) : null;

    const startsAt = firstValidDate(
      conv?.calendly_booking_at,
      cal?.calendly_event_start,
      nurtureStartByMatch.get(String(lead._id)),
      countedInKpi ? kpiOccurredByMatch.get(String(lead._id)) : null,
    );

    bookings.push(
      buildCalendarBookingRow({
        leadMatchId: lead._id,
        conversationId: lead.conversation_id ? String(lead.conversation_id) : null,
        matchStatus: lead.match_status,
        startsAt,
        profile,
        conv,
        calFromLead: cal,
      }),
    );
  }

  return bookings;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Booked appointments for a user's calendar / dashboard.
 * Primary: `WorkspaceAppointment` collection.
 * Legacy fill-in: historical leads that don't yet have a stored document.
 */
export async function listBookedAppointmentsForUser(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));

  const { rows: collectionRows, coveredMatchIds } = await listCollectionAppointments(uid);
  const legacyRows = await listLegacyBookedAppointments(uid);
  const legacyFiltered = legacyRows.filter(
    (b) => b.lead_match_id && !coveredMatchIds.has(b.lead_match_id),
  );

  return sortBookingsByStartDesc([...collectionRows, ...legacyFiltered]);
}
