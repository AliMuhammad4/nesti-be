function text(value) {
  return String(value || '').trim();
}

const FILLER_ONLY =
  /^(um+|uh+|uhm+|hmm+|mm+|mhm+|ah+|oh+|er+|eh+)[.!?…,]*$/i;

const BRACKET_NOISE_ONLY =
  /^\[(inaudible|inaudible\.|blank_audio|silence|noise|music|applause|laughter|coughing|speaking foreign language)\][.!?…]*$/i;

const PUNCTUATION_ONLY = /^[\s.,!?;:'"`´'""…\-–—•·~/\\|()[\]{}]+$/;

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

/** Latin or Arabic/Urdu letter — the only scripts Nesti call STT should keep. */
function isAllowedCallLetter(ch) {
  return /[\u0600-\u06FF]/.test(ch) || /[A-Za-z\u00C0-\u024F]/.test(ch);
}

/**
 * Drop auto-detect hallucinations in Japanese, Bengali, CJK, etc.
 * Keeps English (Latin) and Urdu (Arabic script), including mixed lines.
 */
export function isAllowedCallTranscriptScript(raw) {
  const body = text(raw);
  if (!body) return false;
  let allowed = 0;
  let other = 0;
  for (const ch of body) {
    if (!/\p{L}/u.test(ch)) continue;
    if (isAllowedCallLetter(ch)) allowed += 1;
    else other += 1;
  }
  if (allowed + other === 0) return true;
  // Any unsupported letter script on a short clip is almost always STT noise.
  if (other > 0 && allowed + other <= 8) return false;
  // Longer lines: reject when unsupported letters dominate.
  return other === 0 || allowed / (allowed + other) >= 0.7;
}

function hasArabicScript(raw) {
  return /[\u0600-\u06FF]/.test(text(raw));
}

function latinWords(raw) {
  return text(raw)
    .toLowerCase()
    .match(/[a-z]+/g) || [];
}

/** Common short spoken tokens that are real even at 2–4 letters. */
const SHORT_LATIN_KEEP = new Set([
  'a',
  'i',
  'ok',
  'hi',
  'hey',
  'yo',
  'yes',
  'no',
  'nah',
  'yep',
  'yup',
  'yeah',
  'yea',
  'bye',
  'wow',
  'sure',
  'cool',
  'fine',
  'good',
  'bad',
  'right',
  'okay',
  'wait',
  'stop',
  'go',
  'done',
  'next',
  'true',
  'help',
  'thanks',
  'thank',
  'please',
  'sorry',
  'hello',
  'ali',
  'ahmed',
  'john',
  'mike',
  'sara',
  'khan',
]);

/** Word onsets that are rare in English and common in STT nonsense. */
const IMPROBABLE_LATIN_ONSET =
  /^(nd|ng|mb|nj|nq|nz|tl|dl|zb|zv|zr|vl|vr|xd|xq|zx|qz|bw|dw|fw|gw|hz|kd|kf|kp|kt|mv|mw|pf|sb|sd|sf|sg|skh|sr|sv|sz|tp|vb|vd|vg|vk|vm|vn|vw)/;

function hasExcessiveConsonantCluster(word) {
  return /[bcdfghjklmnpqrstvwxz]{4,}/i.test(word);
}

function isPlausibleLatinWord(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 3) return true;
  if (SHORT_LATIN_KEEP.has(w)) return true;
  if (!/[aeiouy]/.test(w)) return false;
  if (hasExcessiveConsonantCluster(w)) return false;
  if (IMPROBABLE_LATIN_ONSET.test(w)) return false;
  return true;
}

/**
 * Catch high-confidence Latin STT gibberish ("Pega.", "Ndozoa aki.") without
 * phrase blacklists. Skips Urdu/Arabic and longer real sentences.
 */
export function looksLikeLatinSttGibberish(raw) {
  const body = text(raw);
  if (!body || hasArabicScript(body)) return false;
  if (!isAllowedCallTranscriptScript(body)) return false;

  const words = latinWords(body);
  if (!words.length) return false;

  const letters = words.join('').length;

  // Tiny single token: keep only known short speech ("yes", "ok", "hi").
  if (words.length === 1 && letters <= 4) {
    return !SHORT_LATIN_KEEP.has(words[0]);
  }

  // Short phrases: reject when content words look unpronounceable / foreign-onset.
  if (words.length <= 3 && letters <= 20) {
    const content = words.filter((word) => word.length >= 4);
    if (!content.length) {
      return words.every((word) => word.length <= 4 && !SHORT_LATIN_KEEP.has(word));
    }
    if (content.some((word) => !isPlausibleLatinWord(word))) return true;
  }

  return false;
}

/** Drop empty STT noise tokens only — not spoken content. */
export function shouldPersistTranscriptText(raw) {
  const cleaned = sanitizeTranscriptText(raw);
  if (!cleaned) return false;
  if (PUNCTUATION_ONLY.test(cleaned)) return false;
  if (BRACKET_NOISE_ONLY.test(cleaned)) return false;
  if (FILLER_ONLY.test(cleaned)) return false;
  if (letterOrDigitCount(cleaned) < 1) return false;
  if (!isAllowedCallTranscriptScript(cleaned)) return false;
  if (looksLikeLatinSttGibberish(cleaned)) return false;
  return true;
}

export function refineTranscriptSegmentText(raw) {
  const cleaned = sanitizeTranscriptText(raw);
  if (!shouldPersistTranscriptText(cleaned)) return '';
  return cleaned;
}

function scriptCounts(raw) {
  const body = text(raw);
  let latin = 0;
  let arabic = 0;
  for (const ch of body) {
    if (/\s/.test(ch)) continue;
    if (/[\u0600-\u06FF]/.test(ch)) arabic += 1;
    else if (/[\p{L}]/u.test(ch)) latin += 1;
  }
  return { latin, arabic, total: latin + arabic };
}

/** Infer spoken language from transcript script when STT metadata is unreliable. */
export function inferLanguageFromText(raw) {
  const { latin, arabic, total } = scriptCounts(raw);
  if (!total) return '';
  if (arabic >= 4 && latin >= 4) return 'mixed';
  const arabicRatio = arabic / total;
  const latinRatio = latin / total;
  if (arabicRatio >= 0.55) return 'ur';
  if (latinRatio >= 0.55) return 'en';
  if (arabic > 0 && latin > 0) return 'mixed';
  return '';
}

export function resolveSegmentLanguage(alternative) {
  const inferred = inferLanguageFromText(alternative?.text);
  const reported = text(alternative?.language).toLowerCase().slice(0, 5);
  if (inferred) return inferred;
  return reported;
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
