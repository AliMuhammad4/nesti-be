import { GREETING_START, isClosingRefusal, isGreetingOnly, isSocialCheck } from './visitorMessage.js';

function stripEmojis(reply) {
  return String(reply || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.!?？])/g, '$1')
    .trim();
}


const ALLOWED_EMOJI = ['👋', '🙂', '💛', '🙏', '📅', '🏡', '🤝', '📄', '✅', '✨'];
const EMOJI_ALIASES = { '🏠': '🏡', '😊': '🙂', '😁': '🙂', '✋': '👋', '👍': '✅', '🤗': '🤝' };

function firstAllowedEmoji(reply) {
  const matches = String(reply || '').match(/\p{Extended_Pictographic}/gu) || [];
  for (const emoji of matches) {
    if (ALLOWED_EMOJI.includes(emoji)) return emoji;
    if (EMOJI_ALIASES[emoji]) return EMOJI_ALIASES[emoji];
  }
  return '';
}

function fallbackEmoji(text, userMessage = '', documentReceived = false) {
  const visitor = String(userMessage || '');
  const reply = String(text || '');
  if (isSocialCheck(visitor)) return '🙂';
  if (isGreetingOnly(visitor) || GREETING_START.test(reply) || /\b(ass?lam|ass?alam|alaikum|alaykum)\b/i.test(`${visitor} ${reply}`)) return '👋';
  if (isClosingRefusal(visitor) || /\b(not sure|unsure|don't know|dont know|confused)\b/i.test(visitor)) return '🙂';
  if (/\b(worried|anxious|stressed|nervous|scared|overwhelmed|concerned)\b/i.test(visitor)) return '💛';
  if (/\b(thank|thanks|appreciate)\b/i.test(visitor)) return '🙏';
  if (/\b(meet|meting|meeting|appointment|schedule|book)\b/i.test(visitor) || /\b(book|schedule|calendly|available time)\b/i.test(reply)) return '📅';
  if (/\b(later|not now|do not want to tell|dont want to tell|don't want to tell|rather not)\b/i.test(visitor)) return '';
  if (/\b(home|house|property|sell|selling|buy|buying)\b/i.test(`${visitor} ${reply}`)) return '🏡';
  if (documentReceived || /\b(uploaded|attached|attaching|here is my|here's my|sending my|sent my|receipt|invoice|this document|this file|this pdf|this photo|this image)\b/i.test(`${visitor} ${reply}`)) return '📄';
  const statements = reply.split(/[.!]/).map((part) => part.trim()).filter((part) => part.length > 20);
  if (!/[?？]/.test(reply) && statements.length >= 2) return '✨';
  return '';
}

function placeEmoji(text, emoji) {
  return `${String(text).trim()} ${emoji}`;
}

export function withOccasionalEmoji(reply, setting, { previousReply = '', userMessage = '', documentReceived = false } = {}) {
  const text = stripEmojis(reply);
  if (/calendly\.com/i.test(reply)) return text;
  if (!setting?.use_emojis) return text;
  const fromModel = firstAllowedEmoji(reply);
  const chosen = fromModel || fallbackEmoji(text, userMessage, documentReceived);
  if (!chosen) return text;
  if (String(previousReply || '').includes(chosen)) {
    if (!fromModel && documentReceived) {
      const alternate = ['✅', '✨', '🤝', '📄'].find((emoji) => emoji !== chosen && !String(previousReply || '').includes(emoji));
      if (alternate) return placeEmoji(text, alternate);
    }
    return text;
  }
  return placeEmoji(text, chosen);
}

export function finishAgentReply(reply, { userMessage = '', previousReply = '', setting = null, documentReceived = false } = {}) {
  const text = String(reply || '').trim();
  if (!setting) return text;
  return withOccasionalEmoji(text, setting, { previousReply, role: 'agent', userMessage, documentReceived });
}
