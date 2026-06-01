/** Visitor asked to see listing matches again (chat widget fetches /property-matches separately). */
export function isPropertyMatchesRequestMessage(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;

  if (/\bmatching\s+propert/.test(t)) return true;
  if (/\bproperty\s+matches?\b/.test(t)) return true;
  if (/\b(show|see|view|send|get|give|list|find|fetch|display|bring)\b.*\b(matches?|listings?|homes?|houses?)\b/.test(t)) {
    return true;
  }
  if (/\b(matches?|listings?|homes?|houses?)\b.*\b(show|again|more|please|now|back)\b/.test(t)) {
    return true;
  }
  if (/\b(show|see)\s+me\s+(the\s+)?(properties|listings?|matches?|options|homes?)\b/.test(t)) {
    return true;
  }
  return false;
}
