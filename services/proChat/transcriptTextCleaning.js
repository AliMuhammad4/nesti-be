function text(value) {
  return String(value || '').trim();
}

const FILLER_ONLY =
  /^(um+|uh+|uhm+|hmm+|mm+|mhm+|ah+|oh+|er+|eh+|like|you know|i mean)[.!?…,]*$/i;

const BRACKET_NOISE_ONLY =
  /^\[(inaudible|inaudible\.|blank_audio|silence|noise|music|applause|laughter|coughing|speaking foreign language)\][.!?…]*$/i;

const PUNCTUATION_ONLY = /^[\s.,!?;:'"`´'""…\-–—•·~/\\|()[\]{}]+$/;

const META_TRANSCRIPTION =
  /^(nesti\s+(notetaker|minutes)|notetaker\b|notes?\s*agent|transcription\s*(bot|agent|service))\b.*$/i;

const HALLUCINATION_PHRASES = [
  /^thanks for watching[.!?…]*$/i,
  /^thank you for watching[.!?…]*$/i,
  /^thanks for listening[.!?…]*$/i,
  /^please subscribe[.!?…]*$/i,
  /^subscribe to (the|my|our) channel[.!?…]*$/i,
  /^see you in the next (video|one)[.!?…]*$/i,
  /^caption(s)? by[.!?…:].*$/i,
  /^transcribed by[.!?…:].*$/i,
];

export function sanitizeTranscriptText(raw) {
  let cleaned = String(raw || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();

  cleaned = cleaned.replace(/^["'`“”]+|["'`“”]+$/g, '').trim();
  return cleaned;
}

function letterOrDigitCount(value) {
  return (value.match(/[\p{L}\p{N}]/gu) || []).length;
}

export function shouldPersistTranscriptText(raw) {
  const cleaned = sanitizeTranscriptText(raw);
  if (!cleaned) return false;
  if (PUNCTUATION_ONLY.test(cleaned)) return false;
  if (BRACKET_NOISE_ONLY.test(cleaned)) return false;
  if (FILLER_ONLY.test(cleaned)) return false;
  if (META_TRANSCRIPTION.test(cleaned)) return false;
  if (HALLUCINATION_PHRASES.some((pattern) => pattern.test(cleaned))) return false;
  if (letterOrDigitCount(cleaned) < 2) return false;
  return true;
}

export function refineTranscriptSegmentText(raw) {
  const cleaned = sanitizeTranscriptText(raw);
  if (!shouldPersistTranscriptText(cleaned)) return '';
  return cleaned;
}

export function stripMinutesMarkup(raw) {
  return text(raw)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMinutesMetaFluff(raw) {
  const value = text(raw);
  if (!value) return true;
  return (
    /nesti\s*(notetaker|minutes)/i.test(value) ||
    /transcription (agent|service|bot|process)/i.test(value) ||
    /this (call|meeting) was (automatically )?transcribed/i.test(value) ||
    /notes?\s*agent/i.test(value) ||
    /no (meaningful|substantial) (discussion|content|conversation)/i.test(value)
  );
}
