/**
 * Extract scheduled event start from Calendly webhook payloads (expanded resource shape).
 * Returns ISO string or null.
 */
function extractScheduledEventStartIso(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.scheduled_event?.start_time,
    typeof payload.scheduled_event === 'object' ? payload.scheduled_event?.start_time : null,
    typeof payload.event === 'object' ? payload.event?.start_time : null,
  ];
  for (const st of candidates) {
    if (st == null || String(st).trim() === '') continue;
    const d = new Date(String(st));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** Valid `Date` for upserts / DB, or null. */
export function extractScheduledEventStartDate(payload) {
  const iso = extractScheduledEventStartIso(payload);
  if (!iso) return null;
  return new Date(iso);
}
