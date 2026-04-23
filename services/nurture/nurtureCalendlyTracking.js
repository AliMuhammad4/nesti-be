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
    if (!u.searchParams.get('utm_content')) u.searchParams.set('utm_content', raw);
    if (!u.searchParams.get('utm_source')) u.searchParams.set('utm_source', 'nesti_nurture');
    return u.toString();
  } catch {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}utm_content=${encodeURIComponent(raw)}&utm_source=${encodeURIComponent('nesti_nurture')}`;
  }
}
