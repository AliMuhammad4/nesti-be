const GREETING_ONLY_PATTERNS = [
  'hello',
  'hi',
  'hey',
  'salam',
  'salaam',
  'hi there',
  'hello there',
  'hey there',
  'good morning',
  'good afternoon',
  'good evening',
  'good night',
  'good day',
  'morning',
  'afternoon',
  'evening',
  'howdy',
  'yo',
  'bonjour',
  'bonsoir',
  'salut',
  'hola',
  'holas',
  'holi',
  'ola',
  'olas',
  'buenos dias',
  'buenas',
  'buenas tardes',
  'buenas noches',
  'que tal',
  'qué tal',
  'namaste',
  'vanakkam',
  'marhaba',
  'assalamu alaikum',
  'assalamu alaykum',
  'assalam o alaikum',
  'assalamualaikum',
  'asslam o alikum',
  'aslam o alikum',
  'salam alaikum',
  'as-salamu alaykum',
  '你好',
  '您好',
];

export function normalizedVisitorText(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[!?,.:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOCIAL_CHECKS = [
  'how are you',
  'how are you doing',
  'how you doing',
  'how is it going',
  'hows it going',
  'whats up',
  'what is up',
];

export function isSocialCheck(message) {
  const text = normalizedVisitorText(message);
  if (SOCIAL_CHECKS.includes(text)) return true;
  return GREETING_ONLY_PATTERNS.some((prefix) => SOCIAL_CHECKS.some((suffix) => text === `${prefix} ${suffix}`));
}

export function isVagueYes(message) {
  const text = normalizedVisitorText(message);
  return ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay'].includes(text);
}

export function isClosingRefusal(message) {
  const text = normalizedVisitorText(message);
  if (['no', 'nope', 'nah', 'neither', 'none'].includes(text)) return true;
  return /\b(no|not|neither|none)\b/.test(text) && text.length < 80;
}

export function isGreetingOnly(message) {
  if (isSocialCheck(message)) return false;
  return GREETING_ONLY_PATTERNS.includes(normalizedVisitorText(message));
}

export const GREETING_START = /^(?:hello|hi|hey|bonjour|bonsoir|salut|hola|holas|holi|ola|olas|buenos|buenas|namaste|vanakkam|marhaba|wa alaikum|assalam|asalam|asslam|salam|salaam|您好|你好|good morning|good afternoon|good evening|good day|greetings)\b/i;
