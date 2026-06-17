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

function assistantSignalsBookingReady(replyText) {
  const t = String(replyText || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\bplease choose a time\b/.test(t) ||
    /\bbook (a|an)\b.*\b(appointment|call|meeting)\b/.test(t) ||
    /\bshare\b.*\b(link|booking link|available (time|times|slot|slots))\b/.test(t) ||
    /\bavailable (time|times|slot|slots)\b.*\b(choose|book)\b/.test(t)
  );
}

function userProvidedAvailabilityOrAskedSlots(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(morning|afternoon|evening|anytime|tonight|tomorrow|weekend)\b/.test(t) ||
    /\b(available|availability)\b.*\b(time|times|slot|slots)\b/.test(t) ||
    /\b(time|times|slot|slots)\b.*\b(available|availability)\b/.test(t) ||
    /\b(share|show|send)\b.*\b(link|booking link|time|times|slot|slots)\b/.test(t)
  );
}

function replyStillCollectingContactPrefs(replyText) {
  const t = String(replyText || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\bpreferred\b.*\b(contact|contact method|reach)\b/.test(t) ||
    /\bbest time to (contact|reach)\b/.test(t)
  );
}

/**
 * Append a Markdown Calendly link when the assistant promised scheduling but omitted the URL.
 */
export function appendCalendlyBookingLink(
  reply,
  calendlyUrl,
  { userMessage = '' } = {},
) {
  const url = String(calendlyUrl || '').trim();
  if (!url) return String(reply || '');
  const raw = String(reply || '').trim();
  if (!raw || replyAlreadyHasBookingLink(raw, url)) return raw;

  if (replyStillCollectingContactPrefs(raw)) return raw;

  const shouldAttach =
    userProvidedAvailabilityOrAskedSlots(userMessage) ||
    userSignalsBookingIntent(userMessage) ||
    assistantSignalsBookingReady(raw);
  if (!shouldAttach) return raw;

  const label = 'Book an appointment';
  return `${raw}\n\n[${label}](${url})`;
}
