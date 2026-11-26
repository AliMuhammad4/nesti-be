import { extractScheduledEventStartDate } from '../calendlyPayloadUtils.js';

export function normalizeEmail(e) {
  if (!e || typeof e !== 'string') return null;
  return e.trim().toLowerCase() || null;
}

export function extractInviteeEmail(payload) {
  return normalizeEmail(payload?.email || payload?.invitee?.email);
}

function pickTrackingValue(tracking, field) {
  if (!tracking || typeof tracking !== 'object' || Array.isArray(tracking)) return null;
  const value = String(tracking[field] ?? '').trim();
  return value || null;
}

function pickTrackingFromArray(tracking, field) {
  if (!Array.isArray(tracking)) return null;
  const token = field.slice('utm_'.length);
  for (const item of tracking) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || item.field || '').toLowerCase();
    const value = String(item.value ?? item.answer ?? item.response ?? '').trim();
    if (value && (name.includes(field) || (name.includes('utm') && name.includes(token)))) {
      return value;
    }
  }
  return null;
}

/** Read one utm_* field from a Calendly payload, including tracking objects and Q&A arrays. */
export function extractTrackingField(payload, field) {
  const top = String(payload?.[field] ?? '').trim() || null;
  if (top) return top;
  const sources = [
    payload?.tracking,
    payload?.scheduled_event?.tracking,
    typeof payload?.event === 'object' ? payload.event?.tracking : null,
    payload?.invitee?.tracking,
  ];
  for (const source of sources) {
    const fromObject = pickTrackingValue(source, field);
    if (fromObject) return fromObject;
    const fromArray = pickTrackingFromArray(source, field);
    if (fromArray) return fromArray;
  }
  return null;
}

/** Same lookup order as the original webhook: payload, body.payload, body.resource, then the body. */
export function extractTrackingFromWebhook(body, payload, field) {
  return (
    extractTrackingField(payload, field) ||
    extractTrackingField(body?.payload, field) ||
    extractTrackingField(body?.resource, field) ||
    extractTrackingField(typeof body === 'object' ? body : null, field)
  );
}

export function extractCalendlyOwnerUri(payload) {
  const candidates = [
    payload?.scheduled_event?.created_by,
    payload?.scheduled_event?.creator,
    payload?.created_by,
    payload?.event_memberships?.[0]?.user,
    payload?.scheduled_event?.event_memberships?.[0]?.user,
  ];
  for (const candidate of candidates) {
    const value = candidate != null ? String(candidate).trim().toLowerCase() : null;
    if (value) return value;
  }
  return null;
}

export function isPublicProfileBookingTracking({ trackingSource, trackingUtm, ownerUserIdFromTracking }) {
  return (
    String(trackingSource || '').trim().toLowerCase() === 'nesti_public_profile' ||
    String(trackingUtm || '').trim().toLowerCase() === 'public_profile_consultation' ||
    Boolean(ownerUserIdFromTracking && !trackingUtm)
  );
}

export function calendlyMeta(eventName, payload) {
  const startDate = extractScheduledEventStartDate(payload);
  return {
    calendly_event:       eventName,
    calendly_updated_at:  new Date().toISOString(),
    calendly_invitee_uri: payload?.uri || null,
    calendly_event_uri:   typeof payload?.event === 'string' ? payload.event : payload?.event?.uri || null,
    ...(startDate ? { calendly_event_start: startDate.toISOString() } : {}),
  };
}

export function isNurtureTrackingSource(trackingSource) {
  const source = String(trackingSource || '').trim().toLowerCase();
  return source === 'nesti_nurture' || source.startsWith('nesti_nurture_');
}
