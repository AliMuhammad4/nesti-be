const API_BASE = 'https://api.calendly.com';

/**
 * Cancels a scheduled event via POST /scheduled_events/{uuid}/cancellation.
 *
 * OAuth: Calendly apps must include permission to cancel events (often listed as
 * scheduled_events:write / equivalent in the Calendly developer UI). If cancel returns 403,
 * update the OAuth app scopes and have users reconnect Calendly in Nesti.
 *
 * Group / multi-invitee events: Calendly may restrict canceling a single invitee; errors from
 * the API are surfaced to the client.
 *
 * @param {string | null | undefined} uri
 * @returns {string | null} scheduled_events segment (UUID or slug)
 */
export function extractScheduledEventUuidFromCalendlyUri(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const m = String(uri).match(/scheduled_events\/([^/?#]+)/i);
  return m ? m[1] : null;
}

async function fetchInviteeResource(accessToken, inviteeUri) {
  const res = await fetch(inviteeUri, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  try {
    const data = await res.json();
    return data?.resource || null;
  } catch {
    return null;
  }
}

/**
 * Cancel a 1:1 (or whole) scheduled event via Calendly API v2.
 * @param {string} accessToken
 * @param {object} storedCal - `compatibility_factors.calendly` from invitee.created webhook
 * @param {string} [reason]
 */
export async function cancelCalendlyScheduledEvent(accessToken, storedCal, reason) {
  const r = String(reason || 'Canceled from Nesti').trim().slice(0, 500) || 'Canceled from Nesti';
  const cal = storedCal && typeof storedCal === 'object' ? storedCal : {};

  let eventUuid = extractScheduledEventUuidFromCalendlyUri(cal.calendly_event_uri);
  if (!eventUuid && cal.calendly_invitee_uri) {
    const resource = await fetchInviteeResource(accessToken, cal.calendly_invitee_uri);
    const eventRef = resource?.event;
    const eventUri = typeof eventRef === 'string' ? eventRef : eventRef?.uri || null;
    eventUuid = extractScheduledEventUuidFromCalendlyUri(eventUri || '');
  }

  if (!eventUuid) {
    throw new Error(
      'No Calendly event reference stored for this booking. Reconnect Calendly or cancel the meeting in Calendly.'
    );
  }

  const url = `${API_BASE}/scheduled_events/${encodeURIComponent(eventUuid)}/cancellation`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: r }),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 500);
    try {
      const j = JSON.parse(text);
      msg = j?.message || j?.title || j?.details?.[0]?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(`Calendly cancel failed (${res.status}): ${msg}`);
  }
  return { ok: true };
}
