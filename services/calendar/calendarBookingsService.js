import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import {
  resolveAppointmentStatus,
  MATCH_STATUSES_MEETING_BOOKED,
} from '../../utils/resolveAppointmentStatus.js';

/**
 * Booked appointments derived from LeadMatch + ChatConversation (Calendly webhooks / pipeline).
 * `starts_at` is `calendly_booking_at` on the conversation (time Nesti recorded the booking), not
 * necessarily the meeting’s scheduled start unless we extend webhook storage later.
 */
export async function listBookedAppointmentsForUser(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));

  const bookedConvIds = await ChatConversation.find({
    user_id: uid,
    calendly_booking_status: 'booked',
  })
    .distinct('_id');

  const leads = await LeadMatch.find({
    user_id: uid,
    $or: [
      ...(bookedConvIds.length ? [{ conversation_id: { $in: bookedConvIds } }] : []),
      { match_status: { $in: MATCH_STATUSES_MEETING_BOOKED } },
    ],
  })
    .select('_id lead_profile_id conversation_id match_status compatibility_factors lead_type updatedAt')
    .sort({ updatedAt: -1 })
    .limit(300)
    .lean();

  const seen = new Set();
  const uniqueLeads = [];
  for (const lead of leads) {
    const k = String(lead._id);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueLeads.push(lead);
  }

  const convIds = [
    ...new Set(uniqueLeads.map((l) => l.conversation_id).filter(Boolean).map(String)),
  ];
  const profileIds = [
    ...new Set(uniqueLeads.map((l) => l.lead_profile_id).filter(Boolean).map(String)),
  ];

  const [conversations, profiles] = await Promise.all([
    convIds.length
      ? ChatConversation.find({ _id: { $in: convIds } })
          .select('calendly_booking_status calendly_booking_at intent')
          .lean()
      : [],
    profileIds.length
      ? LeadProfile.find({ _id: { $in: profileIds } })
          .select('identity intent property.property_type')
          .lean()
      : [],
  ]);

  const convMap = new Map(conversations.map((c) => [String(c._id), c]));
  const profileMap = new Map(profiles.map((p) => [String(p._id), p]));

  const bookings = [];
  for (const lead of uniqueLeads) {
    const conv = lead.conversation_id ? convMap.get(String(lead.conversation_id)) : null;
    const appt = resolveAppointmentStatus(lead.match_status, conv?.calendly_booking_status);
    if (appt !== 'booked') continue;
    if (conv?.calendly_booking_status === 'canceled') continue;

    const cal = lead.compatibility_factors?.calendly;
    if (cal?.calendly_canceled) continue;

    const profile = lead.lead_profile_id ? profileMap.get(String(lead.lead_profile_id)) : null;
    const identity = profile?.identity || {};
    const propertyType =
      profile?.property?.property_type != null && String(profile.property.property_type).trim()
        ? String(profile.property.property_type).trim()
        : null;
    const intent =
      profile?.intent != null && String(profile.intent).trim()
        ? String(profile.intent).trim()
        : conv?.intent != null && String(conv.intent).trim()
          ? String(conv.intent).trim()
          : null;
    const startsAt = conv?.calendly_booking_at || null;
    const title =
      lead.match_status === 'showing_booked'
        ? 'Showing booked'
        : lead.match_status === 'consult_booked'
          ? 'Consultation booked'
          : 'Appointment booked';

    const cancelableViaCalendly = Boolean(
      cal?.calendly_event_uri || cal?.calendly_invitee_uri,
    );

    bookings.push({
      lead_match_id: String(lead._id),
      conversation_id: lead.conversation_id ? String(lead.conversation_id) : null,
      starts_at: startsAt ? startsAt.toISOString() : null,
      title,
      match_status: lead.match_status,
      cancelable_via_calendly: cancelableViaCalendly,
      contact: {
        full_name: identity.full_name || null,
        email: identity.email || identity.canonical_email || null,
      },
      property_type: propertyType,
      intent,
    });
  }

  bookings.sort((a, b) => {
    const ta = a.starts_at ? new Date(a.starts_at).getTime() : 0;
    const tb = b.starts_at ? new Date(b.starts_at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return String(b.lead_match_id).localeCompare(String(a.lead_match_id));
  });

  return bookings;
}
