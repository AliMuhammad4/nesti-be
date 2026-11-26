import { withWarmGreeting } from './replyStyle.js';

function stripEmojis(reply) {
  return String(reply || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.!?…])/g, '$1')
    .trim();
}

/** Calendly markdown/URL already renders as a booking card — keep those replies emoji-free. */
function replyHasBookingSurface(reply) {
  const raw = String(reply || '');
  return /\[([^\]]+)\]\(https?:\/\/(?:[\w-]+\.)?calendly\.com\/[^)\s]+\)/i.test(raw)
    || /https?:\/\/(?:[\w-]+\.)?calendly\.com\//i.test(raw);
}

/**
 * Emoji policy for finished replies.
 * When use_emojis is on: keep whatever the model wrote (prompt asks for occasional emoji).
 * When off: strip all pictographs.
 * Booking cards and document-review turns stay emoji-free either way.
 */
export function withOccasionalEmoji(reply, setting, { documentReceived = false } = {}) {
  const raw = String(reply || '').trim();
  if (!raw) return '';
  if (!setting?.use_emojis || documentReceived || replyHasBookingSurface(raw)) {
    return stripEmojis(raw);
  }
  return raw;
}

const TRAILING_EMOJI_RE = /(\p{Extended_Pictographic}[\uFE0E\uFE0F\u200D\p{Extended_Pictographic}]*)\s*$/u;

/** The emoji the model itself chose at the end of its draft, if any. */
export function modelTrailingEmoji(reply) {
  const match = String(reply || '').trim().match(TRAILING_EMOJI_RE);
  return match ? match[1] : '';
}

/**
 * Finish-step rewrites (question trimming, intake strip, options/doc asks) split on sentences and
 * can drop the model's closing emoji. Re-attach the model's own emoji when emojis are on.
 */
export function keepModelEmoji(finalReply, modelDraft, setting) {
  const text = String(finalReply || '').trim();
  if (!setting?.use_emojis || !text) return text;
  if (/\p{Extended_Pictographic}/u.test(text)) return settleEmojiAtEnd(text);
  const emoji = modelTrailingEmoji(modelDraft) || firstModelEmoji(modelDraft);
  return emoji ? `${text} ${emoji}` : text;
}

const EMOJI_RUN_RE = /\p{Extended_Pictographic}[\uFE0E\uFE0F\u200D\p{Extended_Pictographic}]*/gu;

function firstModelEmoji(text) {
  return String(text || '').match(EMOJI_RUN_RE)?.[0] || '';
}

/** One model emoji, only at the very end: appended lines can strand it mid-reply. */
export function settleEmojiAtEnd(text) {
  const raw = String(text || '').trim();
  const emoji = firstModelEmoji(raw);
  if (!emoji) return raw;
  const body = raw
    .replace(EMOJI_RUN_RE, '')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.!?,\u061F\uFF1F])/g, '$1')
    .trim();
  return body ? `${body} ${emoji}` : raw;
}

export function finishAgentReply(reply, { userMessage = '', previousReply = '', setting = null, documentReceived = false, conversationText = '' } = {}) {
  const original = String(reply || '').trim();
  if (!setting) return original;
  const text = withWarmGreeting(original, setting, userMessage, conversationText);
  return withOccasionalEmoji(text, setting, { documentReceived });
}
