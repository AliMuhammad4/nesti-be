function nearOptionsToken(word) {
  if (word.length < 5) return false;
  return word.includes('ption') || word.includes('opti') || word.includes('avail');
}

/** "ptions" / "avaialable" still count when the visitor is asking to see listings. */
function asksToSeeOptionsDespiteTypos(text) {
  const t = String(text || '').toLowerCase();
  const tokens = t.split(/[^a-z]+/).filter(Boolean);
  if (!tokens.some(nearOptionsToken)) return false;
  return /\b(show|see|view|want|need|give|list|find)\b/.test(t);
}

/** Preference forks like "other options" / other markets — not a request for listing cards. */
function isSoftOtherOptionsPreference(text) {
  const t = String(text || '').toLowerCase();
  if (!/\bother options\b/.test(t)) return false;
  return !/\b(show|see|view|listings?|properties|homes?|houses?|available)\b/.test(t);
}

/** Visitor asked to see available options (relaxed inventory) in chat. */
export function isAvailableOptionsRequestMessage(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  // "other options" in a preference discussion is not a listings request by itself.
  if (isSoftOtherOptionsPreference(t)) return false;
  if (asksToSeeOptionsDespiteTypos(t)) return true;
  if (/\bavailable\s+(property\s+|investment\s+)?options?\b/.test(t)) return true;
  // "investment options/listings" alone can be a listings ask; bare "investment properties" is intake talk.
  if (/\b(property|investment)\s+options?\b/.test(t)) return true;
  if (
    /\binvestment\s+(properties|listings|options)\b/.test(t)
    && /\b(show|see|view|get|give|list|find|fetch|display|bring|available)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(show|see|view|get|give|list|find|fetch|display|bring)\b.*\boptions?\b/.test(t)) {
    return true;
  }
  if (/\boptions?\b.*\b(show|again|more|please|now|back|available)\b/.test(t)) {
    return true;
  }
  if (/\b(show|see)\s+me\b.*\boptions?\b/.test(t)) {
    return true;
  }
  // Require an intentional listings ask — city/area alone with "looking for options" is intake talk.
  if (
    /\b(looking for|want|need)\b.*\b(available |investment )?(options|listings|properties)\b/.test(t)
    && /\b(show|see|view|available)\b/.test(t)
  ) {
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

/** Assistant just asked whether the visitor wants to see available listing/investment option cards. */
export function assistantOfferedAvailableOptions(text) {
  const r = String(text || '').toLowerCase();
  // Ignore soft conversation forks like "explore other options" / "discuss preferences".
  if (
    /\b(discuss|talk|chat)\b.*\b(preferences?|details?)\b/.test(r)
    || /\bexplore other options\b/.test(r)
    || /\bother options\b/.test(r) && !/\b(see|show|available|listings?|properties|homes?|houses?|investment)\b/.test(r)
  ) {
    return false;
  }
  return (
    /\bwould you like\b.*\b(to see|see|show)\b.*\b(available )?(investment )?(options|listings|properties|matches|homes|houses)\b/.test(r)
    || /\bwould you like to see\b.*\b(available )?(investment )?(options|listings|properties|matches|homes|houses)\b/.test(r)
    || /\blike to see\b.*\b(available )?(investment )?(options|listings|properties|matches|homes|houses)\b/.test(r)
    || /\b(show|see)\b.*\bavailable (investment )?options\b/.test(r)
    || /\bavailable (investment )?options\b[^.?!]*\?/.test(r)
    || /\binterested in seeing\b.*\b(available )?(investment )?(options|listings|properties|matches|homes|houses)\b/.test(r)
    || /\b(want|shall|should|can)\b.*\b(show|see)\b.*\b(available )?(investment )?(options|listings|properties|matches|homes|houses)\b/.test(r)

    || /\binvestment (options|properties|listings)\b[^.?!]*\?/.test(r)
    // Localized forced/model offers (French/Spanish/CJK/Arabic/Indic), not English-only phrasing.
    || /souhaitez-vous\s+voir\s+les\s+options/i.test(text)
    || /options\s+disponibles/i.test(text) && /[?？]\s*$/.test(String(text || '').trim())
    || /opciones\s+(disponibles|de\s+inversi[oó]n)/i.test(text) && /[?？]\s*$/.test(String(text || '').trim())
    || /(房源选项|投資選項|投资选项|樓盤選項|选项|選項|خيارات|विकल्प|ਵਿਕਲਪ|விருப்ப)/i.test(text) && /[?？؟]\s*$/.test(String(text || '').trim())
  );
}

/** True when any prior assistant turn already offered available options. */
export function historyOfferedAvailableOptions(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((message) => message?.role === 'assistant')
    .some((message) => assistantOfferedAvailableOptions(message?.content));
}

/** Assistant reply points at option cards, including a short sentence followed by a question. */
export function assistantAnnouncingOptionCards(text) {
  const r = String(text || '').toLowerCase();
  return (
    /\bhere are\b.*\b(your )?(available )?(options|matches|listings|homes|houses|properties)\b/.test(r) ||
    /\b(your )?(available )?(options|matches|listings|homes|houses|properties)\b.*\bbelow\b/.test(r)
  );
}

/** Visitor declined listing/option cards (or said they are not interested in shown matches). */
export function isAvailableOptionsDeclineMessage(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (
    /\b(not interested|no thanks|no thank you|don't want|dont want|do not want|don't need|dont need|pass on|skip)\b/.test(t)
    && /\b(options?|listings?|properties|matches?|homes?|houses?|those|them|these)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(don't|dont|do not|not)\b.*\b(go with|want|like|need)\b.*\b(those|these|them|options?|listings?|properties|matches?)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(hold off|skip|without)\b.*\b(listings?|options?|properties|matches?)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

export function isAvailableOptionsConsentMessage(text, { afterOptionsOffer = false } = {}) {
  if (isAvailableOptionsDeclineMessage(text)) return false;
  if (isAvailableOptionsRequestMessage(text) || isPropertyMatchesRequestMessage(text)) {
    return true;
  }
  if (!afterOptionsOffer) return false;

  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  // "yes, looking for other options in Lahore" continues intake — not card consent.
  if (isSoftOtherOptionsPreference(t)) return false;
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
    /\b(yes|yeah|sure|ok|okay|please)\b.*\b(show|see|them)\b/.test(t) ||
    /\b(yes|yeah|sure|ok|okay|please)\b.*\b(available |investment )?(options|listings|properties)\b/.test(t) ||
    /\b(show|see)\s+(me\s+)?(the\s+)?(options|them)\b/.test(t) ||
    /\bi'?d\s+like\s+to\s+see\b/.test(t) ||
    /\b(let'?s|please)\s+see\b/.test(t)
  );
}

export function shouldRefetchPropertyMatchesForMessage(text, {
  afterOptionsOffer = false,
  previousAssistantReply = '',
} = {}) {
  if (isAvailableOptionsDeclineMessage(text)) return false;
  const offered = afterOptionsOffer || assistantOfferedAvailableOptions(previousAssistantReply);
  return (
    isAvailableOptionsRequestMessage(text) ||
    isPropertyMatchesRequestMessage(text) ||
    isAvailableOptionsConsentMessage(text, { afterOptionsOffer: offered })
  );
}

/** True when visitor already declined options/matches earlier in the thread. */
export function historyDeclinedAvailableOptions(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((message) => message?.role === 'user')
    .some((message) => isAvailableOptionsDeclineMessage(message?.content));
}
