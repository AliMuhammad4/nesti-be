/**
 * Small helpers for live call STT.
 */

import { isAllowedCallTranscriptScript, looksLikeLatinSttGibberish } from '../../services/proChat/transcriptTextCleaning.js';

function text(value) {
  return String(value || '').trim();
}

export function readTranscriptionMinConfidence() {
  const parsed = Number(process.env.CALL_TRANSCRIPTION_MIN_CONFIDENCE);
  if (!Number.isFinite(parsed)) return 0.55;
  return Math.min(1, Math.max(0, parsed));
}

export function readTranscriptionVadOptions() {
  const threshold = Number(process.env.CALL_TRANSCRIPTION_VAD_THRESHOLD);
  const silenceMs = Number.parseInt(process.env.CALL_TRANSCRIPTION_VAD_SILENCE_MS, 10);
  return {
    threshold: Number.isFinite(threshold)
      ? Math.min(1, Math.max(0, threshold))
      : 0.56,
    prefix_padding_ms: 500,
    silence_duration_ms:
      Number.isFinite(silenceMs) && silenceMs > 0 ? silenceMs : 700,
  };
}

/** Keep segments when STT omits confidence; drop only explicit low scores. */
export function passesTranscriptionConfidence(
  alternative,
  minConfidence = readTranscriptionMinConfidence(),
) {
  const confidence = Number(alternative?.confidence);
  if (!Number.isFinite(confidence)) return true;
  return confidence >= minConfidence;
}

export function shouldPersistTranscriptAlternative(
  alternative,
  { previousText = '' } = {},
) {
  const body = text(alternative?.text);
  if (!body || body.replace(/\s+/g, '').length < 2) return false;
  if (!isAllowedCallTranscriptScript(body)) return false;
  if (looksLikeLatinSttGibberish(body)) return false;
  if (!passesTranscriptionConfidence(alternative)) return false;
  if (isDuplicateTranscript(previousText, body)) return false;
  return true;
}

export function containsNonLatinScript(raw) {
  return /[\u0600-\u06FF\u0900-\u097F]/.test(text(raw));
}

function normalizeComparableTranscript(raw) {
  return text(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function arabicScriptSimilarity(previous, next) {
  const left = normalizeComparableTranscript(previous).replace(/\s+/g, '');
  const right = normalizeComparableTranscript(next).replace(/\s+/g, '');
  if (!left || !right || left.length < 3 || right.length < 3) return false;
  if (left === right) return true;
  if (left.length >= 5 && right.includes(left)) return true;
  if (right.length >= 5 && left.includes(right)) return true;
  const minLen = Math.min(left.length, right.length);
  const maxLen = Math.max(left.length, right.length);
  if (maxLen - minLen > 10) return false;
  let matches = 0;
  for (let i = 0; i < minLen; i += 1) {
    if (left[i] === right[i]) matches += 1;
  }
  return matches / maxLen >= 0.62;
}

/** Drop exact/near-duplicate consecutive finals from the same speaker. */
export function isDuplicateTranscript(previous, next) {
  const left = normalizeComparableTranscript(previous);
  const right = normalizeComparableTranscript(next);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 8 && right.includes(left)) return true;
  if (right.length >= 8 && left.includes(right)) return true;
  return false;
}

function scriptSignature(raw) {
  const body = text(raw);
  if (!body) return '';
  if (containsNonLatinScript(body)) return 'non-latin';
  return /[A-Za-z]/.test(body) ? 'latin' : '';
}

/**
 * Same short utterance bleeding into both mics sometimes gets auto-detected
 * as a different language per channel (e.g. English on one, Urdu on the
 * other), so word/script comparison never matches. Only near-simultaneous
 * (<=400ms) short lines qualify — real bilingual turn-taking has more gap
 * than physical mic bleed does.
 */
function isLikelyCrossScriptBleed(previous, next, deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs > 400) return false;
  const leftScript = scriptSignature(previous);
  const rightScript = scriptSignature(next);
  if (!leftScript || !rightScript || leftScript === rightScript) return false;
  const leftLen = normalizeComparableTranscript(previous).replace(/\s+/g, '').length;
  const rightLen = normalizeComparableTranscript(next).replace(/\s+/g, '').length;
  if (!leftLen || !rightLen || leftLen > 90 || rightLen > 90) return false;
  return true;
}

function isNearDuplicateTranscript(previous, next) {
  if (isDuplicateTranscript(previous, next)) return true;
  if (containsNonLatinScript(previous) && containsNonLatinScript(next)) {
    return arabicScriptSimilarity(previous, next);
  }
  const left = normalizeComparableTranscript(previous).split(/\s+/).filter(Boolean);
  const right = normalizeComparableTranscript(next).split(/\s+/).filter(Boolean);
  if (!left.length || !right.length) return false;

  // Short bleed lines (1–3 words) — catch when one is contained in the other.
  if (left.length <= 3 || right.length <= 3) {
    const leftJoined = left.join(' ');
    const rightJoined = right.join(' ');
    if (leftJoined.length >= 4 && rightJoined.includes(leftJoined)) return true;
    if (rightJoined.length >= 4 && leftJoined.includes(rightJoined)) return true;
    if (left.length < 2 || right.length < 2) return false;
  }

  if (left.length < 2 || right.length < 2) return false;
  const leftSet = new Set(left);
  const overlap = right.reduce((count, word) => count + (leftSet.has(word) ? 1 : 0), 0);
  const ratio = (2 * overlap) / (left.length + right.length);
  // Shorter phrases need a bit more overlap; longer phrases keep 0.55.
  const minRatio = Math.max(left.length, right.length) <= 3 ? 0.7 : 0.55;
  return ratio >= minRatio;
}

/** Drop the same speech saved for both speakers when mics pick up speaker bleed. */
export function createCallEchoTracker({ windowMs = 8000, maxEntries = 40 } = {}) {
  const recent = [];

  const prune = (startTimeMs) => {
    const cutoff = startTimeMs - windowMs;
    while (recent.length && recent[0].startTimeMs < cutoff) recent.shift();
    while (recent.length > maxEntries) recent.shift();
  };

  return {
    isEcho({ speakerId, text: utterance, startTimeMs = 0 }) {
      const body = text(utterance);
      const speaker = text(speakerId);
      if (!body || !speaker) return false;
      const start = Math.max(0, Number(startTimeMs) || 0);
      prune(start);
      return recent.some((entry) => {
        if (entry.speakerId === speaker) return false;
        const deltaMs = Math.abs(entry.startTimeMs - start);
        if (deltaMs > windowMs) return false;
        if (isNearDuplicateTranscript(entry.text, body)) return true;
        return isLikelyCrossScriptBleed(entry.text, body, deltaMs);
      });
    },
    remember({ speakerId, text: utterance, startTimeMs = 0 }) {
      const body = text(utterance);
      const speaker = text(speakerId);
      if (!body || !speaker) return;
      const start = Math.max(0, Number(startTimeMs) || 0);
      prune(start);
      recent.push({ speakerId: speaker, text: body, startTimeMs: start });
    },
  };
}

const echoTrackers = new Map();

export function getCallEchoTracker(callId) {
  const key = text(callId);
  if (!key) return createCallEchoTracker();
  let tracker = echoTrackers.get(key);
  if (!tracker) {
    tracker = createCallEchoTracker();
    echoTrackers.set(key, tracker);
  }
  return tracker;
}

export function frameSampleCount(frame) {
  const samples = Number(frame?.samplesPerChannel);
  if (Number.isFinite(samples) && samples > 0) return samples;
  const channels = Math.max(1, Number(frame?.channels) || 1);
  const dataLength = frame?.data?.length;
  if (Number.isFinite(dataLength) && dataLength > 0) {
    return Math.floor(dataLength / channels);
  }
  return 0;
}
