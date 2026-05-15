import mongoose from 'mongoose';

/**
 * Append Nesti tracking params so Calendly webhooks can resolve `conversation_id` from utm_content.
 * Calendly passes tracking through to the invitee payload when present on the scheduling URL.
 */
export function withNestiNurtureCalendlyTracking(calendlyUrl, conversationIdOrOptions) {
  const base = calendlyUrl != null ? String(calendlyUrl).trim() : '';
  if (!base) return '';
  const options =
    conversationIdOrOptions && typeof conversationIdOrOptions === 'object'
      ? conversationIdOrOptions
      : { conversationId: conversationIdOrOptions };

  const convRaw = options?.conversationId;
  const ownerRaw = options?.ownerUserId;

  if (!convRaw || !mongoose.Types.ObjectId.isValid(String(convRaw))) return base;
  const conversationId = String(convRaw);

  const ownerUserId =
    ownerRaw && mongoose.Types.ObjectId.isValid(String(ownerRaw)) ? String(ownerRaw) : '';

  try {
    const u = new URL(base);
    // Always overwrite tracking so reused/shared Calendly URLs cannot leak stale
    // utm_content and incorrectly map webhook bookings to another user's thread.
    u.searchParams.set('utm_content', conversationId);
    u.searchParams.set('utm_source', 'nesti_nurture');
    if (ownerUserId) u.searchParams.set('utm_campaign', ownerUserId);
    return u.toString();
  } catch {
    const [urlOnly, queryString] = base.split('?');
    const params = new URLSearchParams(queryString || '');
    params.set('utm_content', conversationId);
    params.set('utm_source', 'nesti_nurture');
    if (ownerUserId) params.set('utm_campaign', ownerUserId);
    const qs = params.toString();
    return qs ? `${urlOnly}?${qs}` : urlOnly;
  }
}
