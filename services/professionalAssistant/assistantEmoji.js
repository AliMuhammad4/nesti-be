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

export function finishAgentReply(reply, { userMessage = '', previousReply = '', setting = null, documentReceived = false, conversationText = '' } = {}) {
  const original = String(reply || '').trim();
  if (!setting) return original;
  const text = withWarmGreeting(original, setting, userMessage, conversationText);
  return withOccasionalEmoji(text, setting, { documentReceived });
}
