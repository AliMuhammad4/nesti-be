/** User message signals they want to schedule / gave availability. */
export function userSignalsBookingIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  const meeting = /\b(viewing|appointment|apointment|schedule|scheduling|book|booking|meet|meting|meeting|call)\b/.test(t);
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
  return userSignalsBookingIntent(t) || /\b(later|not now|do not want to tell|dont want to tell|don't want to tell|rather not|in (?:the |our )?meeting|when we meet)\b/.test(t);
}

export function visitorSkipsDocumentRequest(text, requestedDocument = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  if (userSignalsBookingIntent(value)) return true;
  const normalized = value.toLowerCase();
  const document = /\b(document|file|upload|attachment|proof of funds|pre-?approval|photo id|identification|bank statement|funds)\b/i;
  const refusal = /\b(skip|later|not now|rather not|not comfortable|don't have|dont have|do not have|can't|cannot|won't|will not|unable|not ready)\b/i;
  const requestedName = String(requestedDocument || '').toLowerCase().replace(/^(?:recent|current)\s+/, '').trim();
  if ((document.test(normalized) || (requestedName && normalized.includes(requestedName))) && refusal.test(normalized)) return true;
  if (/[?？]/.test(value)) return false;
  return value.split(/\s+/).length <= 8
    && /\b(later|not now|rather not|skip it|not comfortable|don't have it|dont have it|do not have it|can't provide it|cannot provide it)\b/i.test(normalized);
}

const PAUSE_COPY = {
  french: { meet: 'Je peux vous rencontrer. Choisissez un moment qui vous convient.', later: 'Nous pourrons voir ces détails quand vous serez prêt.' },
  spanish: { meet: 'Puedo reunirme con usted. Elija un horario que le convenga.', later: 'Podemos ver esos detalles cuando esté listo.' },
  arabic: { meet: 'يمكنني الاجتماع معك. اختر وقتًا مناسبًا.', later: 'يمكننا مراجعة هذه التفاصيل عندما تكون جاهزًا.' },
  mandarin: { meet: '我可以和您见面。请选择一个方便的时间。', later: '这些细节可以等您准备好再谈。' },
  english: { meet: 'I can meet with you. Choose a time that works.', later: 'We can go through those details when you are ready.' },
};

export function holdFurtherQuestions(reply, userMessage = '', language = 'english') {
  const text = String(reply || '').trim();
  if (!visitorPausesDetails(userMessage)) return text;
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !/[?？]/.test(sentence) && !/\bupload\b/i.test(sentence));
  const body = kept.join(' ').trim();
  if (body) return body;
  const copy = PAUSE_COPY[language] || PAUSE_COPY.english;
  return userSignalsBookingIntent(userMessage) ? copy.meet : copy.later;
}

/**
 * Append a Markdown Calendly link when the assistant promised scheduling but omitted the URL.
 */
export function appendCalendlyBookingLink(
  reply,
  calendlyUrl,
  { userMessage = '', allowSchedule = true, label: ctaLabel = '', force = false } = {},
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

  const label = String(ctaLabel || '').trim().slice(0, 60) || 'Book an appointment';
  const body = raw.replace(/\s*\p{Extended_Pictographic}+\s*$/u, '').replace(/[\uFE0E\uFE0F]/g, '').trim();
  return `${body}\n\n[${label}](${url})`;
}

function withoutUploadAsk(reply) {
  return String(reply || '')
    .split(/(?<=[.!?？])\s+/)
    .filter((sentence) => {
      if (!sentence) return false;
      // Drop document/upload asks so booking is not stacked with another upload request.
      if (/\b(upload|proof of funds|pre-?approval|photo id|document|send the file)\b/i.test(sentence) && /[?？]|please|recommend|can you|could you|when you are ready/i.test(sentence)) {
        return false;
      }
      return true;
    })
    .join(' ')
    .trim();
}

/** After a document was requested, a reply with no file can end with the consultation link. */
export function offerConsultationAfterSkippedUpload(reply, calendlyUrl, { allowSchedule = true, label = '' } = {}) {
  const cleaned = withoutUploadAsk(reply)
    .split(/(?<=[.!?？])\s+/)
    .filter((sentence) => sentence && !/[?？]/.test(sentence))
    .slice(0, 2)
    .join(' ')
    .trim();
  const text = cleaned || String(reply || '').trim().replace(/[?？]+\s*$/, '');
  const note = /\b(consultation|meeting|appointment|book)\b/i.test(text)
    ? text
    : allowSchedule
      ? `${text} You can send the documents whenever they are ready. We can also pick a time to go through this.`.trim()
      : `${text} You can send the documents whenever they are ready.`.trim();
  return appendCalendlyBookingLink(note, calendlyUrl, { allowSchedule, label, force: true });
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
