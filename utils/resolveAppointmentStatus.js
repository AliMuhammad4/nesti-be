export function resolveAppointmentStatus(matchStatus, calendlyBookingStatus) {
  const c = String(calendlyBookingStatus || '').trim().toLowerCase();
  if (c === 'booked' || c === 'canceled') return c;
  const m = String(matchStatus || '').trim().toLowerCase();
  if (m === 'consult_booked') return 'booked';
  if (m === 'nurturing') return 'canceled';
  return 'not_booked';
}
