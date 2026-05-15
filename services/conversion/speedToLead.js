import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
const MS_PER_MIN = 60_000;
function minutesBetween(from, to = Date.now()) {
  if (!from) return null;
  const a = from instanceof Date ? from.getTime() : new Date(from).getTime();
  if (!Number.isFinite(a)) return null;
  return Math.max(0, Math.round((to - a) / MS_PER_MIN));
}
export function recommendedFirstResponseMinutes(grade, appointmentStatus) {
  if (appointmentStatus === 'booked') return 240;
  if (grade === 'hot') return 5;
  if (grade === 'warm') return 30;
  if (grade === 'cold') return 240;
  return 120;
}
export function outreachUrgency(grade, appointmentStatus, minutesSinceVisitorActivity) {
  if (appointmentStatus === 'booked') return 'standard';
  if (grade === 'hot' && minutesSinceVisitorActivity != null && minutesSinceVisitorActivity <= 15) {
    return 'immediate';
  }
  if (grade === 'hot' || grade === 'warm') return 'same_day';
  return 'standard';
}
function pickLastVisitorActivity(leadMatch, conversation) {
  const li = conversation?.last_interaction_at;
  if (li) return li;
  return leadMatch?.createdAt || null;
}
export function computeSpeedToLead({ leadMatch, conversation }) {
  const grade = String(leadMatch?.lead_type || '').split('_')[0] || 'cold';
  const appointmentStatus = resolveAppointmentStatus(
    leadMatch?.match_status,
    conversation?.calendly_booking_status,
  );
  const lastVisitorAt = pickLastVisitorActivity(leadMatch, conversation);
  const minutesSinceVisitor = minutesBetween(lastVisitorAt);
  const slaMinutes = recommendedFirstResponseMinutes(grade, appointmentStatus);
  const urgency = outreachUrgency(grade, appointmentStatus, minutesSinceVisitor);
  let booking_focus = null;
  if (appointmentStatus === 'not_booked' && (grade === 'hot' || grade === 'warm')) {
    booking_focus = 'Offer specific times or a short calendar link while intent is high.';
  } else if (appointmentStatus === 'booked') {
    booking_focus = 'Confirm details and set expectations before the meeting.';
  }
  return {
    lead_created_at: leadMatch?.createdAt || null,
    first_contact_at: leadMatch?.first_contact_at || null,
    last_contact_at: leadMatch?.last_contact_at || null,
    last_visitor_activity_at: lastVisitorAt,
    minutes_since_visitor_activity: minutesSinceVisitor,
    recommended_first_response_minutes: slaMinutes,
    urgency,
    within_sla: minutesSinceVisitor == null ? null : minutesSinceVisitor <= slaMinutes,
    booking_goal: {
      appointment_status: appointmentStatus,
      suggested_focus: booking_focus,
    },
  };
}
