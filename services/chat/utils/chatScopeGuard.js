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

const PERSONAL_OFF_TOPIC_RE =
  /\b(lonely|loneliness|feeling alone|being alone|feel alone|feeling lonely|am feeling alone|i am alone|i'm alone|im alone|depressed|depression|suicidal|breakup|girlfriend|boyfriend|no friends|nobody to talk|no one to talk|feel empty|feeling empty)\b/i;

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

  if (PERSONAL_OFF_TOPIC_RE.test(lower)) return true;
  const hasOffTopicSignal = hasAnyKeyword(lower, OFF_TOPIC_KEYWORDS);
  return hasOffTopicSignal;
}

export function buildOutOfScopeReply(flowRole, professionalName, assistantSetting = null) {
  const name = String(professionalName || '').trim() || 'the professional';
  const tone = assistantSetting?.applied ? (assistantSetting.personalities || [])[0] : '';
  const formality = assistantSetting?.applied ? assistantSetting.formality : 'professional';
  const quiet = tone === 'luxury' || tone === 'polished' || formality === 'formal';
  const soft = tone === 'caring';
  const forward = tone === 'persuasive' || tone === 'consultative';
  const casual = !quiet && (tone === 'friendly' || formality === 'casual');

  if (flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    if (quiet) return 'I cover mortgage and home-financing questions. Are you planning a new mortgage, a refinance, or a renewal?';
    if (soft) return 'I stay with mortgage and home-financing questions. Is this a new mortgage, a refinance, or a renewal?';
    if (forward) return 'I handle mortgage and home-financing questions. Is this a new mortgage, a refinance, or a renewal?';
    if (casual) return 'I stick to mortgage and home-financing questions. Is this a new mortgage, a refinance, or a renewal?';
    return 'I can help with a new mortgage, a refinance, or a renewal. Which one is this?';
  }
  if (flowRole === PROFESSIONAL_TYPE.LAWYER) {
    if (quiet) return 'I cover real-estate closings. Is this a purchase closing, a sale closing, or a refinance closing?';
    if (soft) return 'I stay with real-estate closings. Is this a purchase closing, a sale closing, or a refinance closing?';
    if (forward) return 'I handle real-estate closings. Is this a purchase closing, a sale closing, or a refinance closing?';
    if (casual) return 'I stick to real-estate closings. Is this a purchase closing, a sale closing, or a refinance closing?';
    return 'I can help with a purchase closing, a sale closing, or a refinance closing. Which one is this?';
  }
  if (quiet) return `I cover real-estate buy and sell questions for ${name}. Are you looking to purchase or to sell a property?`;
  if (soft) return `No problem, I stay focused on real-estate buy and sell questions for ${name}. Are you thinking about buying or selling?`;
  if (forward) return `I handle real-estate buy and sell questions for ${name}. Let's start with your area, budget, or timeline.`;
  if (casual) return `I stick to real-estate buy and sell questions for ${name}. Are you looking to buy or sell?`;
  return `I can only help with real-estate buy/sell questions for ${name}. If you want, I can help with location, budget, timeline, and your next step.`;
}

export function buildEmptyTurnFallbackReply(flowRole, assistantSetting = null) {
  if (!assistantSetting?.applied) {
    return "I'm here to help! Could you tell me a bit more about what you're looking for?";
  }
  const tone = (assistantSetting.personalities || [])[0] || '';
  const formality = assistantSetting.formality || 'professional';
  const quiet = tone === 'luxury' || tone === 'polished' || formality === 'formal';
  const soft = tone === 'caring';
  const forward = tone === 'persuasive' || tone === 'consultative';
  const topic = flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER
    ? 'a new mortgage, a refinance, or a renewal'
    : flowRole === PROFESSIONAL_TYPE.LAWYER
      ? 'a purchase closing or a sale closing'
      : 'buying or selling';
  if (quiet) return `Please share a detail on ${topic}, and I will take it from there.`;
  if (soft && flowRole === PROFESSIONAL_TYPE.LAWYER) {
    return 'I am glad to help with your closing. Is this a purchase closing, a sale closing, or a refinance closing?';
  }
  if (soft && flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return 'I am glad to help with your mortgage. Is this a new mortgage, a refinance, or a renewal?';
  }
  if (soft) return `Whenever you're ready, share one detail on ${topic}.`;
  if (forward) return `Share one detail on ${topic}, and we can take the next step.`;
  return `Share a quick detail on ${topic}, and we can go from there.`;
}
