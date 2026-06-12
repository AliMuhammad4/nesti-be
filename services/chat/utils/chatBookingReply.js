/** User message signals they want to schedule / gave availability. */
export function userSignalsBookingIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(morning|afternoon|evening|tonight|tomorrow|weekend)\b/.test(t) ||
    /\b(viewing|appointment|schedule|scheduling|book|booking|meet|meeting|call)\b/.test(t) ||
    /\b(share|show|send)\b.*\b(time|times|slot|slots|link)\b/.test(t) ||
    /\b(time|times|slot|slots|link)\b.*\b(share|show|send)\b/.test(t) ||
    /\bavailable\b.*\b(time|times|slot|slots|appointment|viewing)\b/.test(t) ||
    /\b(time|times|slot|slots|appointment|viewing)\b.*\bavailable\b/.test(t)
  );
}

export function replyAlreadyHasBookingLink(reply, calendlyUrl = '') {
  const raw = String(reply || '');
  const url = String(calendlyUrl || '').trim();
  if (url && raw.includes(url)) return true;
  return /\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/.test(raw);
}

/**
 * Append a Markdown Calendly link when the assistant promised scheduling but omitted the URL.
 */
export function appendCalendlyBookingLink(reply, calendlyUrl, { userMessage = '' } = {}) {
  const url = String(calendlyUrl || '').trim();
  if (!url) return String(reply || '');
  const raw = String(reply || '').trim();
  if (!raw || replyAlreadyHasBookingLink(raw, url)) return raw;

  const shouldAttach = userSignalsBookingIntent(userMessage);
  if (!shouldAttach) return raw;

  const label = 'Book an appointment';
  return `${raw}\n\n[${label}](${url})`;
}
