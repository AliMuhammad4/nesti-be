import mongoose from 'mongoose';

/**
 * Append Nesti tracking params so Calendly webhooks can resolve `conversation_id` from utm_content.
 * Calendly passes tracking through to the invitee payload when present on the scheduling URL.
 */
export function withNestiNurtureCalendlyTracking(calendlyUrl, conversationId) {
  const base = calendlyUrl != null ? String(calendlyUrl).trim() : '';
  if (!base) return '';
  let raw = conversationId;
  if (raw && mongoose.Types.ObjectId.isValid(String(raw))) {
    raw = String(raw);
  } else {
    return base;
  }
  try {
    const u = new URL(base);
    // Always overwrite tracking so reused/shared Calendly URLs cannot leak stale
    // utm_content and incorrectly map webhook bookings to another user's thread.
    u.searchParams.set('utm_content', raw);
    u.searchParams.set('utm_source', 'nesti_nurture');
    return u.toString();
  } catch {
    const [urlOnly, queryString] = base.split('?');
    const params = new URLSearchParams(queryString || '');
    params.set('utm_content', raw);
    params.set('utm_source', 'nesti_nurture');
    const qs = params.toString();
    return qs ? `${urlOnly}?${qs}` : urlOnly;
  }
}
