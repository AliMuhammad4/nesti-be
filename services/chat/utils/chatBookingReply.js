import {
  BOOKING_COPY,
  DECLINE_WORDS_RE,
  DOCUMENT_WORDS_RE,
  MEETING_WORDS_RE,
  PAUSE_COPY,
  SHORT_DECLINE_RE,
} from '../../professionalAssistant/localizedReplyCopy.js';

/** Non-English meeting words come from the shared localized table. */
const MEETING_I18N = MEETING_WORDS_RE;
/** Sentence split: Latin / Arabic / Devanagari stops before a space, CJK stops with no space. */
const SENTENCE_SPLIT = /(?<=[.!?？؟।])\s+|(?<=[。！？])/;

/** User message signals they want to schedule / gave availability. */
export function userSignalsBookingIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  const meeting = /\b(viewing|appointment|apointment|schedule|scheduling|book|booking|meet|meting|meeting|call)\b/.test(t)
    || MEETING_I18N.test(t);
  const slots = (
    /\b(share|show|send)\b.*\b(time|times|slot|slots|link)\b/.test(t)
    || /\b(time|times|slot|slots|link)\b.*\b(share|show|send)\b/.test(t)
    || /\bavailable\b.*\b(time|times|slot|slots|appointment|viewing)\b/.test(t)
    || /\b(time|times|slot|slots|appointment|viewing)\b.*\bavailable\b/.test(t)
  );
  const shortAvailability = t.split(/\s+/).filter(Boolean).length <= 12
    && /\b(morning|afternoon|evening|tonight|tomorrow|weekend)\b/.test(t);
  return meeting || slots || shortAvailability;
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

export function visitorPausesDetails(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return userSignalsBookingIntent(t)
    || /\b(later|not now|do not want to tell|dont want to tell|don't want to tell|rather not|in (?:the |our )?meeting|when we meet)\b/.test(t)
    || SHORT_DECLINE_RE.test(t);
}

/**
 * Short "I don't have it (yet)" replies in the supported languages (asked document only; no file attached).
 * English, French, Spanish, Urdu / Hindi (incl. Roman Urdu), Punjabi, Tamil, Arabic, Mandarin.
 */
const NO_FILE_RE = new RegExp([
  "\\b(i\\s+)?(do\\s*n[o']?t|dont|don't|haven'?t|have\\s+not)\\s+(have|got|get)\\s+(it|one|that|this|them|any)(\\s+(yet|right now|now|with me|on me))?\\b",
  "\\b(i\\s+)?(do\\s*n[o']?t|dont|don't)\\s+have\\s+(a|an|my|the|any)\\s+([\\w-]+\\s+){0,3}(letter|statements?|stubs?|documents?|files?|pre-?approval|proof|id|agreement|aps|contract|returns?|w-?2|t4|noa|photos?|pictures?|deed|commitment|lease|certificate)\\b",
  "^\\s*(no[,.!\\s]+)?not\\s+(yet|now|right now|at the moment)[.!\\s]*$",
  "^\\s*(i\\s+)?(do\\s*n[o']?t|dont|don't)\\s+have(\\s+it)?(\\s+yet)?[.!\\s]*$",
  "\\bnot\\s+(available|ready)\\s+yet\\b",
  "\\bje\\s+(ne\\s+)?l'?ai\\s+pas\\b", "\\bje\\s+n'?en\\s+ai\\s+pas\\b", "\\bpas\\s+encore\\b",
  "\\bno\\s+(lo|la|los|las)?\\s*tengo\\b", "\\btodav[ií]a\\s+no\\b", "\\ba[uú]n\\s+no\\b",
  "\\b(mere\\s+paas\\s+nahi|abhi\\s+nahi)\\b",
  "میرے\\s*پاس\\s*نہیں", "ابھی\\s*نہیں",
  "मेरे\\s*पास\\s*नहीं", "अभी\\s*नहीं",
  "ਮੇਰੇ\\s*ਕੋਲ\\s*ਨਹੀਂ", "ਅਜੇ\\s*ਨਹੀਂ",
  "என்னிடம்\\s*இல்லை", "இன்னும்\\s*இல்லை",
  "ليس\\s*(لدي|عندي|معي)", "لا\\s*(أملك|املك)", "ليس\\s*بعد",
  "我(还)?没有", "还没(有)?",
].join('|'), 'i');

/** The visitor says they do not have the asked document ("not yet", "I don't have one yet", "میرے پاس نہیں ہے"). */
export function visitorHasNoFile(text) {
  const value = String(text || '').trim();
  if (!value || value.split(/\s+/).length > 14) return false;
  return NO_FILE_RE.test(value);
}

export function visitorSkipsDocumentRequest(text, requestedDocument = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  if (visitorHasNoFile(value)) return true;
  if (userSignalsBookingIntent(value)) return true;
  const normalized = value.toLowerCase();
  const document = /\b(document|file|upload|attachment|proof of funds|pre-?approval|photo id|identification|bank statement|funds)\b/i;
  const refusal = /\b(skip|later|not now|rather not|not comfortable|don't have|dont have|do not have|can't|cannot|won't|will not|unable|not ready)\b/i;
  const requestedName = String(requestedDocument || '').toLowerCase().replace(/^(?:recent|current)\s+/, '').trim();
  if ((document.test(normalized) || (requestedName && normalized.includes(requestedName))) && refusal.test(normalized)) return true;
  if (DECLINE_WORDS_RE.test(normalized) && (DOCUMENT_WORDS_RE.test(normalized) || SHORT_DECLINE_RE.test(normalized))) return true;
  if (/[?？؟]/.test(value)) return false;
  return value.split(/\s+/).length <= 8
    && /\b(later|not now|rather not|skip it|not comfortable|don't have it|dont have it|do not have it|can't provide it|cannot provide it)\b/i.test(normalized);
}

export function holdFurtherQuestions(reply, userMessage = '', language = 'english') {
  const text = String(reply || '').trim();
  if (!visitorPausesDetails(userMessage)) return text;
  const kept = text
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !/[?？؟]/.test(sentence) && !/\bupload\b/i.test(sentence));
  const body = kept.join(' ').trim();
  if (body) return body;
  const copy = PAUSE_COPY[language] || PAUSE_COPY.english;
  return userSignalsBookingIntent(userMessage) ? copy.meet : copy.later;
}

/** Default booking link label and the skipped-upload note, by reply language (English fallback). */
export function bookingCopy(language = 'english') {
  return BOOKING_COPY[language] || BOOKING_COPY.english;
}

/**
 * Append a Markdown Calendly link when the assistant promised scheduling but omitted the URL.
 */

export function appendCalendlyBookingLink(
  reply,
  calendlyUrl,
  { userMessage = '', allowSchedule = true, label: ctaLabel = '', force = false, language = 'english' } = {},
) {
  if (!allowSchedule) return String(reply || '').trim();
  const url = String(calendlyUrl || '').trim();
  if (!url) return String(reply || '');
  const raw = String(reply || '').trim();
  if (!raw || replyAlreadyHasBookingLink(raw, url)) return raw;

  if (!force && replyStillCollectingContactPrefs(raw)) return raw;

  const shouldAttach = force
    || userProvidedAvailabilityOrAskedSlots(userMessage)
    || userSignalsBookingIntent(userMessage)
    || assistantSignalsBookingReady(raw);
  if (!shouldAttach) return raw;

  const label = String(ctaLabel || '').trim().slice(0, 60) || bookingCopy(language).label;
  const body = raw.replace(/\s*\p{Extended_Pictographic}+\s*$/u, '').replace(/[\uFE0E\uFE0F]/g, '').trim();
  return `${body}\n\n[${label}](${url})`;
}

function withoutUploadAsk(reply) {
  return String(reply || '')
    .split(SENTENCE_SPLIT)
    .filter((sentence) => {
      if (!sentence) return false;
      // Drop document/upload asks so booking is not stacked with another upload request.
      if (/\b(upload|proof of funds|pre-?approval|photo id|document|send the file)\b/i.test(sentence) && /[?？؟]|please|recommend|can you|could you|when you are ready/i.test(sentence)) {
        return false;
      }
      return true;
    })
    .join(' ')
    .trim();
}

/** Visitor defers or declines the requested upload ("not interested", "I'll skip the documents", "later"). */
export function isDocumentDeclineMessage(text) {
  if (visitorHasNoFile(text)) return true;
  const t = String(text || '').trim().toLowerCase().replace(/\bdon[0-9]?t\b/g, 'dont');
  if (!t) return false;
  const refuses = /\b(not interested|no thanks|no thank you|dont want|do not want|don't want|dont have|don't have|rather not|prefer not|not now|not right now|later|skip|not comfortable|no need|not needed|not ready)\b/.test(t);
  const aboutDocs = /\b(documents?|docs?|files?|upload|proof|statements?|letters?|id|share (it|them|that)|send (it|them|that))\b/.test(t);
  if (refuses && (aboutDocs || /^(no|nope|not now|later|skip( it)?|not interested|no thanks)[.!]*$/.test(t))) return true;
  return DECLINE_WORDS_RE.test(t) && (DOCUMENT_WORDS_RE.test(t) || SHORT_DECLINE_RE.test(t));
}

/** After a document was requested, a reply with no file can end with the consultation link. */
export function offerConsultationAfterSkippedUpload(reply, calendlyUrl, { allowSchedule = true, label = '', language = 'english' } = {}) {
  const cleaned = withoutUploadAsk(reply)
    .split(SENTENCE_SPLIT)
    .filter((sentence) => sentence && !/[?？؟]/.test(sentence))
    .slice(0, 2)
    .join(' ')
    .trim();
  const text = cleaned || String(reply || '').trim().replace(/[?？؟]+\s*$/, '');
  const copy = bookingCopy(language);
  const note = /\b(consultation|meeting|appointment|book)\b/i.test(text) || MEETING_I18N.test(text)
    ? text
    : allowSchedule
      ? `${text} ${copy.sendLater} ${copy.pickTime}`.trim()
      : `${text} ${copy.sendLater}`.trim();
  return appendCalendlyBookingLink(note, calendlyUrl, { allowSchedule, label, force: true, language });
}

/** Remove scheduling links without deleting unrelated URLs from an answer. */
export function stripBookingLinks(reply, bookingUrl = '') {
  const knownUrl = String(bookingUrl || '').trim().replace(/[.,!?]+$/g, '');
  const isBookingUrl = (url) => {
    const candidate = String(url || '').replace(/[.,!?]+$/g, '');
    return /calendly\.com/i.test(candidate) || Boolean(knownUrl && candidate === knownUrl);
  };
  return String(reply || '')
    .replace(/\n*\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gi, (link, url) => (isBookingUrl(url) ? '' : link))
    .replace(/https?:\/\/[^\s)]+/gi, (url) => (isBookingUrl(url) ? '' : url))
    .replace(/\s{2,}/g, ' ')
    .trim();
}
