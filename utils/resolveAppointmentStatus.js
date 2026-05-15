/** Pipeline stages that mean a meeting/showing is booked (Calendly may still be `not_booked` until linked). */
export const MATCH_STATUSES_MEETING_BOOKED = ['consult_booked', 'showing_booked'];

function parseDateSafe(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isPastAppointmentDate(value, nowMs = Date.now()) {
  const d = parseDateSafe(value);
  if (!d) return false;
  return d.getTime() < nowMs;
}

export function resolveAppointmentStatus(matchStatus, calendlyBookingStatus, appointmentDate = null) {
  const c = String(calendlyBookingStatus || '').trim().toLowerCase();
  if (c === 'canceled') return c;
  if (c === 'booked') {
    return isPastAppointmentDate(appointmentDate) ? 'not_booked' : 'booked';
  }
  const m = String(matchStatus || '').trim().toLowerCase();
  if (MATCH_STATUSES_MEETING_BOOKED.includes(m)) {
    return isPastAppointmentDate(appointmentDate) ? 'not_booked' : 'booked';
  }
  return 'not_booked';
}
