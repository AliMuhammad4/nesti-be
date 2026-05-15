/** Pipeline stages that mean a meeting/showing is booked (Calendly may still be `not_booked` until linked). */
export const MATCH_STATUSES_MEETING_BOOKED = ['consult_booked', 'showing_booked'];

export function resolveAppointmentStatus(matchStatus, calendlyBookingStatus) {
  const c = String(calendlyBookingStatus || '').trim().toLowerCase();
  if (c === 'booked' || c === 'canceled') return c;
  const m = String(matchStatus || '').trim().toLowerCase();
  if (MATCH_STATUSES_MEETING_BOOKED.includes(m)) return 'booked';
  return 'not_booked';
}
