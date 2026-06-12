/** Visitor asked to see available options (relaxed inventory) in chat. */
export function isAvailableOptionsRequestMessage(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (/\bavailable\s+(property\s+)?options?\b/.test(t)) return true;
  if (/\bproperty\s+options?\b/.test(t)) return true;
  if (/\b(show|see|view|get|give|list|find|fetch|display|bring)\b.*\boptions?\b/.test(t)) {
    return true;
  }
  if (/\boptions?\b.*\b(show|again|more|please|now|back|available)\b/.test(t)) {
    return true;
  }
  if (/\b(show|see)\s+me\b.*\boptions?\b/.test(t)) {
    return true;
  }
  return false;
}

/** Visitor asked to see property matches / listings (strict matching) in chat. */
export function isPropertyMatchesRequestMessage(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || isAvailableOptionsRequestMessage(t)) return false;

  if (/\bmatching\s+propert/.test(t)) return true;
  if (/\bproperty\s+matches?\b/.test(t)) return true;
  if (
    /\b(show|see|view|send|get|give|list|find|fetch|display|bring)\b.*\b(matches?|listings?|homes?|houses?|properties)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(matches?|listings?|homes?|houses?|properties)\b.*\b(show|again|more|please|now|back|available)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(show|see)\s+me\b.*\b(properties|listings?|matches?|homes?|houses?)\b/.test(t)) {
    return true;
  }
  return false;
}

export function isAvailableOptionsConsentMessage(text, { afterOptionsOffer = false } = {}) {
  if (isAvailableOptionsRequestMessage(text) || isPropertyMatchesRequestMessage(text)) {
    return true;
  }
  if (!afterOptionsOffer) return false;

  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  const exact = new Set([
    'yes',
    'y',
    'yep',
    'yeah',
    'sure',
    'ok',
    'okay',
    'please',
    'go ahead',
    'sounds good',
    'why not',
    'absolutely',
    'definitely',
  ]);
  if (exact.has(t)) return true;
  if (
    /^(yes|yeah|yep|sure|ok|okay|please|absolutely|definitely)(\s+(yes|sure|please|thanks?|thing))?$/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(sure|ok|okay)(\s+thing)?$/i.test(t)) return true;
  return (
    /\b(yes|yeah|sure|ok|okay|please)\b.*\b(show|see|options|them)\b/.test(t) ||
    /\b(show|see)\s+(me\s+)?(the\s+)?(options|them)\b/.test(t) ||
    /\bi'?d\s+like\s+to\s+see\b/.test(t) ||
    /\b(let'?s|please)\s+see\b/.test(t)
  );
}

export function shouldRefetchPropertyMatchesForMessage(text, { afterOptionsOffer = false } = {}) {
  return (
    isAvailableOptionsRequestMessage(text) ||
    isPropertyMatchesRequestMessage(text) ||
    isAvailableOptionsConsentMessage(text, { afterOptionsOffer })
  );
}
