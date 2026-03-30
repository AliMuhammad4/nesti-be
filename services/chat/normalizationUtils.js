import { WIDGET_AGENT_TYPE } from '../../constants/roles.js';
export const normalizeAgentType = (raw = '') => {
  const v = String(raw || '').toLowerCase().trim();
  if (['broker', 'mortgage', 'mortgage broker', 'lender'].includes(v)) return WIDGET_AGENT_TYPE.BROKER;
  if (['lawyer', 'attorney'].includes(v)) return WIDGET_AGENT_TYPE.LAWYER;
  return WIDGET_AGENT_TYPE.AGENT;
};

export const classifyIntentFromKeywords = (message = '') => {
  const text = String(message || '').toLowerCase();
  const sellKeywords = [
    'sell', 'selling', 'list my', 'listing', 'home value',
    'what is my home worth', 'put my house', 'put my home',
    'market my', 'closing on', 'seller',
  ];
  const buyKeywords = [
    'buy', 'buying', 'purchase', 'looking for a home', 'looking for a house',
    'find a home', 'find a house', 'mortgage', 'pre-approval', 'pre approval',
    'investment property', 'first home', 'first house', 'move in',
  ];
  const sellScore = sellKeywords.filter((kw) => text.includes(kw)).length;
  const buyScore  = buyKeywords.filter((kw) => text.includes(kw)).length;
  return sellScore > buyScore ? 'sell' : 'buy';
};

export const normalizeAiIntent = (raw = '', fallback = 'buy') => {
  const v = String(raw || '').toLowerCase();
  if (v === 'sell' || v === 'seller') return 'sell';
  if (v === 'buy'  || v === 'buyer')  return 'buy';
  return fallback;
};

