import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';

const CAPABILITY_QUERY_RE =
  /\b(who are you|what can you do|how can you help|help me|what do you do)\b/i;
const CONTACT_HINT_RE = /@|\+?\d[\d\s\-()]{6,}/;
const SMALL_TALK_RE =
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|awesome|good morning|good evening|good afternoon)\b/i;

const COMMON_DOMAIN_KEYWORDS = [
  'real estate',
  'realtor',
  'property',
  'home',
  'house',
  'apartment',
  'condo',
  'townhouse',
  'listing',
  'buyer',
  'seller',
  'buy',
  'sell',
  'offer',
  'closing',
  'inspection',
  'valuation',
  'appraisal',
  'timeline',
  'budget',
  'address',
  'area',
  'neighbourhood',
];

const ROLE_DOMAIN_KEYWORDS = {
  [PROFESSIONAL_TYPE.AGENT]: [
    'viewing',
    'showing',
    'mls',
    'market value',
    'list my home',
  ],
  [PROFESSIONAL_TYPE.MORTGAGE_BROKER]: [
    'mortgage',
    'pre-approval',
    'pre approval',
    'interest rate',
    'down payment',
    'lender',
    'loan',
    'affordability',
    'refinance',
  ],
  [PROFESSIONAL_TYPE.LAWYER]: [
    'legal',
    'lawyer',
    'attorney',
    'contract',
    'title transfer',
    'document review',
    'closing documents',
    'deed',
  ],
};

const OFF_TOPIC_KEYWORDS = [
  'weather',
  'temperature',
  'news',
  'cricket',
  'football',
  'soccer',
  'nba',
  'movie',
  'netflix',
  'music',
  'song',
  'poem',
  'joke',
  'riddle',
  'recipe',
  'cook',
  'horoscope',
  'zodiac',
  'astrology',
  'politics',
  'election',
  'stock price',
  'crypto',
  'bitcoin',
  'ethereum',
  'programming',
  'javascript',
  'python',
  'coding',
  'math',
  'algebra',
  'physics',
  'chemistry',
  'biology',
];

function messageWordCount(message) {
  return String(message || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((kw) => text.includes(kw));
}

export function detectOutOfScopeMessage(message, flowRole) {
  const raw = String(message || '').trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();
  const words = messageWordCount(raw);
  if (words <= 4 && SMALL_TALK_RE.test(lower)) return false;
  if (CAPABILITY_QUERY_RE.test(lower)) return false;
  if (CONTACT_HINT_RE.test(raw)) return false;

  const roleKeywords = ROLE_DOMAIN_KEYWORDS[flowRole] || [];
  const hasDomainSignal = hasAnyKeyword(lower, COMMON_DOMAIN_KEYWORDS) || hasAnyKeyword(lower, roleKeywords);
  if (hasDomainSignal) return false;

  const hasOffTopicSignal = hasAnyKeyword(lower, OFF_TOPIC_KEYWORDS);
  return hasOffTopicSignal;
}

export function buildOutOfScopeReply(flowRole, professionalName) {
  const name = String(professionalName || '').trim() || 'the professional';
  if (flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return `I can only help with mortgage and home-financing questions for ${name}. If you want, I can help with pre-approval, budget range, and next mortgage steps.`;
  }
  if (flowRole === PROFESSIONAL_TYPE.LAWYER) {
    return `I can only help with real-estate legal and closing questions for ${name}. If you want, I can help with transaction type, timeline, and document/closing readiness.`;
  }
  return `I can only help with real-estate buy/sell questions for ${name}. If you want, I can help with location, budget, timeline, and your next step.`;
}
