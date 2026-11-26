import { GREETING_START, isGreetingOnly } from './visitorMessage.js';
import {
  AREA_PREFIX,
  INVESTOR_OPENING_QUESTION,
  INVESTOR_REFINEMENT_QUESTION,
  INVESTOR_STRATEGY_CONFIRM_QUESTION,
  TURN_FALLBACK,
} from './localizedReplyCopy.js';

/**
 * Urdu vs Arabic (same script). Urdu-only letters: \u0679 tteh, \u0688 ddal, \u0691 rreh, \u06BA noon ghunna,
 * \u06BE do-chashmi heh, \u06C1 heh goal, \u06D2 / \u06D3 yeh barree. Otherwise Urdu (Farsi) yeh \u06CC or keheh \u06A9
 * with no Arabic-only letter (\u064A yeh, \u0643 kaf, \u0629 teh marbuta, \u0649 alef maksura). Real Arabic keeps
 * the Arabic letters, so it is never read as Urdu.
 */
const URDU_ONLY_LETTERS = /[\u0679\u0688\u0691\u06BA\u06BE\u06C1\u06D2\u06D3]/u;
const URDU_FARSI_LETTERS = /[\u06CC\u06A9]/u;
const ARABIC_ONLY_LETTERS = /[\u064A\u0643\u0629\u0649]/u;
export function looksUrdu(text) {
  const value = String(text || '');
  if (URDU_ONLY_LETTERS.test(value)) return true;
  return URDU_FARSI_LETTERS.test(value) && !ARABIC_ONLY_LETTERS.test(value);
}

const WARM_HELLO = {
  english: {
    friendly: 'Hi, glad you are here',
    caring: 'Hello, I am glad you reached out',
    polished: 'Hello, welcome',
    luxury: 'Hello, it is good to hear from you',
    persuasive: 'Hello, I am glad you are here',
    consultative: 'Hello, I am here with you',
  },
  french: {
    friendly: 'Bonjour, content de vous voir',
    caring: 'Bonjour, je suis heureux que vous m’écriviez',
    polished: 'Bonjour',
    default: 'Bonjour',
  },
  spanish: {
    friendly: 'Hola, me alegra que esté aquí',
    caring: 'Hola, me alegra que haya escrito',
    polished: 'Hola',
    default: 'Hola',
  },
  mandarin: { default: '您好，很高兴您来了' },
  cantonese: { default: '你好，好高兴你嚟' },
  arabic: { default: 'مرحبا، يسعدني تواصلك' },
  urdu: { default: 'السلام علیکم، خوش آمدید' },
  hindi: { default: 'नमस्ते, आपका स्वागत है' },
  punjabi: { default: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ' },
  tamil: { default: 'வணக்கம்' },
};

const STRONG_LANGUAGE = [
  // Urdu before Arabic: both use the Arabic script.
  ['urdu', (text) => looksUrdu(text)],
  ['arabic', (text) => (/\p{Script=Arabic}/u.test(text) && !looksUrdu(text)) || /\b(marhaba|assalamu|as-salamu|assalam|asslam|salam|salaam)\b/i.test(text)],
  ['hindi', (text) => /\p{Script=Devanagari}/u.test(text) || /\b(namaste|namaskar)\b/i.test(text)],
  ['punjabi', (text) => /\p{Script=Gurmukhi}/u.test(text) || /\b(sat sri akal)\b/i.test(text)],
  ['tamil', (text) => /\p{Script=Tamil}/u.test(text) || /\bvanakkam\b/i.test(text)],
  ['french', (text) => /[àâäçéèêëîïôùûüœ]/i.test(text) || /\b(bonjour|bonsoir|salut|merci|hypothèque|hypotheque|prêt|renouvellement|refinancement)\b/i.test(text)],
  ['spanish', (text) => /[áéíóúñü¿¡]/i.test(text) || /\b(hola|holas|holi|ola|olas|gracias|buenos|buenas|hipoteca|préstamo|prestamo|refinanciamiento|qué tal|que tal)\b/i.test(text)],
];

const WEAK_LANGUAGE = [
  ['french', (text) => /\b(oui|pret|je veux|je suis)\b/i.test(text)],
  ['spanish', (text) => /\b(necesito|dónde|donde)\b/i.test(text)],
];

function replyLooksLocalized(language, text) {
  if (language === 'english') return true;
  if ((language === 'mandarin' || language === 'cantonese') && /\p{Script=Han}/u.test(text)) return true;
  const signal = STRONG_LANGUAGE.find(([id]) => id === language);
  return Boolean(signal && signal[1](text));
}

function hanLanguage(selected, text) {
  if (!/\p{Script=Han}/u.test(text)) return '';
  const cantonese = /[唔嘅佢喺嚟睇]/;
  if (selected.includes('cantonese') && (cantonese.test(text) || !selected.includes('mandarin'))) return 'cantonese';
  if (selected.includes('mandarin')) return 'mandarin';
  if (selected.includes('cantonese')) return 'cantonese';
  return '';
}

function unmistakableLanguage(id, text) {
  if (id === 'urdu') return looksUrdu(text);
  if (id === 'arabic') return (/\p{Script=Arabic}/u.test(text) && !looksUrdu(text)) || /\b(marhaba|assalamu|as-salamu|assalam|asslam|salam|salaam)\b/i.test(text);
  if (id === 'french') return /[àâäçéèêëîïôùûüœ]/i.test(text) || /\b(bonjour|bonsoir)\b/i.test(text);
  if (id === 'spanish') return /[áéíóúñü¿¡]/i.test(text) || /\b(hola|holas|holi|ola|olas)\b/i.test(text);
  if (id === 'hindi') return /\p{Script=Devanagari}/u.test(text) || /\b(namaste|namaskar)\b/i.test(text);
  if (id === 'punjabi') return /\p{Script=Gurmukhi}/u.test(text) || /\b(sat sri akal)\b/i.test(text);
  if (id === 'tamil') return /\p{Script=Tamil}/u.test(text) || /\bvanakkam\b/i.test(text);
  return false;
}

function detectLanguage(setting, text) {
  const selected = Array.isArray(setting?.languages) ? setting.languages.filter(Boolean) : [];
  const source = String(text || '');
  if (setting?.auto_detect_language === false || !source.trim()) return '';
  const han = hanLanguage(
    selected.includes('mandarin') || selected.includes('cantonese') ? selected : ['mandarin'],
    source,
  );
  if (han && (selected.includes(han) || !selected.length)) return han;
  const strong = STRONG_LANGUAGE.find(([id, test]) => test(source) && (selected.includes(id) || unmistakableLanguage(id, source)));
  if (strong) return strong[0];
  const weak = WEAK_LANGUAGE.find(([id, test]) => selected.includes(id) && test(source));
  return weak ? weak[0] : '';
}

function keepsPriorLanguage(message) {
  const words = String(message || '').trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6;
}

export function replyLanguage(setting, userMessage = '', earlierText = '') {
  const selected = Array.isArray(setting?.languages) ? setting.languages.filter(Boolean) : [];
  if (setting?.auto_detect_language !== false) {
    const current = detectLanguage(setting, userMessage);
    if (current) return current;
    if (keepsPriorLanguage(userMessage)) {
      const prior = detectLanguage(setting, earlierText);
      if (prior) return prior;
    }
  }
  if (!selected.length) return 'english';
  if (selected.length === 1) return selected[0];
  if (!selected.includes('english')) return selected[0];
  return 'english';
}

export function investorOptionsFeedbackInstruction(feedback, nextQuestion = '') {
  const question = String(nextQuestion || '').trim();
  const progression = feedback === 'declined'
    ? 'Acknowledge the decline without arguing, pitching the same listings again, or asking for documents. Ask one focused question about which search criterion to change, such as market, budget, or property type.'
    : question
      ? `Acknowledge the positive feedback naturally, then ask this next unanswered qualification question in the selected voice: "${question}"`
      : 'Acknowledge the positive feedback naturally, then ask one useful investor follow-up about what they like most or what they want to explore next.';
  return `The visitor is responding to property matches already shown. Write this turn yourself in the configured assistant voice, tone, formality, response length, language, and custom guidance. Do not use canned wording. ${progression} Ask only one question. Do not request documents, add a booking link, or repeat property matches on this turn. Follow the configured emoji rule.`;
}

/** ASCII ?, Arabic ؟ (U+061F), fullwidth ？ (U+FF1F). Never rely on a literal ؟ in source — encoding breaks it. */
export const REPLY_QUESTION_RE = /[?\u061F\uFF1F]/u;
export const REPLY_SENTENCE_SPLIT_RE = /(?<=[.!\u003F\u061F\uFF1F])\s+/u;

export function replyHasQuestionMark(text) {
  return REPLY_QUESTION_RE.test(String(text || ''));
}

export function splitReplySentences(text) {
  return String(text || '').split(REPLY_SENTENCE_SPLIT_RE).map((part) => part.trim()).filter(Boolean);
}

const OPTIONS_OFFER_COPY = {
  english: {
    buyer: {
      friendly: 'Would you like to take a look at available options that fit what you shared?',
      polished: 'Would you like to review available options that fit your criteria?',
      luxury: 'Would you like me to curate a selection of available options based on your criteria?',
      consultative: 'Would it be helpful to review available options that fit what you shared?',
      persuasive: 'Shall I show you available options that match what you are looking for?',
      default: 'Would you like to see available options that fit what you shared?',
    },
    investor: {
      friendly: 'Would you like to take a look at investment options that fit what you shared?',
      polished: 'Would you like to review available investment options that fit your criteria?',
      luxury: 'Would you like me to curate investment options based on your criteria?',
      consultative: 'Would it be helpful to review investment options that fit what you shared?',
      persuasive: 'Shall I show you investment options that match your goals?',
      default: 'Would you like to see available investment options that fit what you shared?',
    },
  },
  french: {
    buyer: 'Souhaitez-vous voir les options disponibles qui correspondent à vos critères ?',
    investor: 'Souhaitez-vous voir les options de placement qui correspondent à vos objectifs ?',
  },
  spanish: {
    buyer: '¿Le gustaría ver opciones disponibles que se ajusten a lo que busca?',
    investor: '¿Le gustaría ver opciones de inversión que se ajusten a sus objetivos?',
  },
  mandarin: {
    buyer: '您想看看符合您需求的房源选项吗？',
    investor: '您想看看符合您投资目标的房源选项吗？',
  },
  cantonese: {
    buyer: '你想睇下符合你需要嘅樓盤選項嗎？',
    investor: '你想睇下符合你投資目標嘅樓盤選項嗎？',
  },
  arabic: {
    buyer: 'هل ترغب في الاطلاع على الخيارات المتاحة التي تناسب ما شاركته؟',
    investor: 'هل ترغب في الاطلاع على خيارات استثمارية تناسب أهدافك؟',
  },
  urdu: {
    buyer: 'کیا آپ اپنی ضرورت کے مطابق دستیاب آپشنز دیکھنا چاہیں گے؟',
    investor: 'کیا آپ اپنے سرمایہ کاری کے اہداف کے مطابق آپشنز دیکھنا چاہیں گے؟',
  },
  hindi: {
    buyer: 'क्या आप अपनी ज़रूरतों के अनुसार उपलब्ध विकल्प देखना चाहेंगे?',
    investor: 'क्या आप अपने निवेश लक्ष्यों के अनुसार विकल्प देखना चाहेंगे?',
  },
  punjabi: {
    buyer: 'ਕੀ ਤੁਸੀਂ ਆਪਣੀਆਂ ਲੋੜਾਂ ਮੁਤਾਬਕ ਉਪਲਬਧ ਵਿਕਲਪ ਦੇਖਣਾ ਚਾਹੋਗੇ?',
    investor: 'ਕੀ ਤੁਸੀਂ ਆਪਣੇ ਨਿਵੇਸ਼ ਟੀਚਿਆਂ ਮੁਤਾਬਕ ਵਿਕਲਪ ਦੇਖਣਾ ਚਾਹੋਗੇ?',
  },
  tamil: {
    buyer: 'உங்கள் தேவைகளுக்குப் பொருந்தும் கிடைக்கக்கூடிய விருப்பங்களைப் பார்க்க விரும்புகிறீர்களா?',
    investor: 'உங்கள் முதலீட்டு இலக்குகளுக்குப் பொருந்தும் விருப்பங்களைப் பார்க்க விரும்புகிறீர்களா?',
  },
};

export function availableOptionsOffer(setting, isInvestor, userMessage = '', earlierText = '') {
  const audience = isInvestor ? 'investor' : 'buyer';
  const language = replyLanguage(setting, userMessage, earlierText);
  const copy = OPTIONS_OFFER_COPY[language];
  const primary = setting?.personalities?.[0] || '';
  if (!copy) {
    if (language === 'other') return '';
    return OPTIONS_OFFER_COPY.english[audience].default;
  }
  const question = typeof copy[audience] === 'string'
    ? copy[audience]
    : copy[audience][primary] || copy[audience].default;
  if (language !== 'english') return question;
  const custom = customToneById(setting, primary);
  const leadIn = customLeadIn(custom);
  return leadIn ? joinLawyerSentences(leadIn, question, false) : question;
}

export function turnFallbackReply(key, language = 'english') {
  return TURN_FALLBACK[language]?.[key] || '';
}

const AGENT_OPENING_FUNNEL = {
  english: {
    buy: {
      withLocation: (loc) => `Great start. In ${loc}, which should we lock first: neighborhood shortlist or property features?`,
      without: 'Great start. Which should we lock first: neighborhood shortlist or property features?',
    },
    sell: {
      without: 'Great start. Would you like to prioritize a faster sale or testing a higher asking price first?',
    },
  },
  french: {
    buy: {
      withLocation: (loc) => `Bon d\u00e9but. \u00c0 ${loc}, que priorisons-nous d'abord : la shortlist de quartiers ou les caract\u00e9ristiques ?`,
      without: "Bon d\u00e9but. Que priorisons-nous d'abord : la shortlist de quartiers ou les caract\u00e9ristiques ?",
    },
    sell: {
      without: 'Bon d\u00e9but. Priorisez-vous une vente plus rapide ou un prix demand\u00e9 plus \u00e9lev\u00e9 ?',
    },
  },
  spanish: {
    buy: {
      withLocation: (loc) => `Buen comienzo. En ${loc}, \u00bfqu\u00e9 cerramos primero: lista corta de barrios o caracter\u00edsticas?`,
      without: 'Buen comienzo. \u00bfQu\u00e9 cerramos primero: lista corta de barrios o caracter\u00edsticas?',
    },
    sell: {
      without: 'Buen comienzo. \u00bfPriorizamos una venta m\u00e1s r\u00e1pida o probar un precio m\u00e1s alto?',
    },
  },
  arabic: {
    buy: {
      // "Great start. In {loc}, which should we lock first: neighborhood shortlist or property features?"
      withLocation: (loc) => `\u0628\u062f\u0627\u064a\u0629 \u062c\u064a\u062f\u0629. \u0641\u064a ${loc}\u060c \u0628\u0645\u0627\u0630\u0627 \u0646\u0628\u062f\u0623: \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u062d\u064a\u0627\u0621 \u0623\u0645 \u0645\u0645\u064a\u0632\u0627\u062a \u0627\u0644\u0639\u0642\u0627\u0631\u061f`,
      without: '\u0628\u062f\u0627\u064a\u0629 \u062c\u064a\u062f\u0629. \u0628\u0645\u0627\u0630\u0627 \u0646\u0628\u062f\u0623: \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u062d\u064a\u0627\u0621 \u0623\u0645 \u0645\u0645\u064a\u0632\u0627\u062a \u0627\u0644\u0639\u0642\u0627\u0631\u061f',
    },
    sell: {
      without: '\u0628\u062f\u0627\u064a\u0629 \u062c\u064a\u062f\u0629. \u0647\u0644 \u062a\u0641\u0636\u0644 \u0628\u064a\u0639\u0627\u064b \u0623\u0633\u0631\u0639 \u0623\u0645 \u062a\u062c\u0631\u0628\u0629 \u0633\u0639\u0631 \u0637\u0644\u0628 \u0623\u0639\u0644\u0649\u061f',
    },
  },
  urdu: {
    buy: {
      withLocation: (loc) => `اچھا آغاز۔ ${loc} میں، پہلے کیا طے کریں: محلوں کی مختصر فہرست یا پراپرٹی کی خصوصیات؟`,
      without: 'اچھا آغاز۔ پہلے کیا طے کریں: محلوں کی مختصر فہرست یا پراپرٹی کی خصوصیات؟',
    },
    sell: {
      without: 'اچھا آغاز۔ کیا آپ پہلے جلد فروخت کو ترجیح دیں گے یا زیادہ قیمت آزمانے کو؟',
    },
  },
};

/**
 * Buyer/seller opening funnel ask, localized to the visitor language.
 * Returns '' when language is non-English and we have no copy — never fall back to English.
 */
export function agentOpeningFunnelQuestion(setting, {
  intent = 'buy',
  location = '',
  userMessage = '',
  earlierText = '',
} = {}) {
  const language = replyLanguage(setting, userMessage, earlierText);
  const copy = AGENT_OPENING_FUNNEL[language];
  if (!copy) return '';
  const side = intent === 'sell' ? 'sell' : 'buy';
  const pack = copy[side] || copy.buy;
  if (!pack) return '';
  const area = String(location || '').trim();
  if (side === 'buy' && area && typeof pack.withLocation === 'function') {
    return pack.withLocation(area);
  }
  return pack.without || '';
}

/**
 * Opening-turn funnel rewrite for agent chat.
 * Keeps the model reply when it already asks a question (incl. Arabic ؟).
 * Appends a localized funnel ask only when the reply has no question yet.
 */
export function applyAgentOpeningFunnel(finalReply, {
  isOpeningFormTurn = false,
  flowRole = '',
  namedReply = false,
  isOutOfScopeMessage = false,
  isInvestorVisitor = false,
  intent = 'buy',
  locationHint = '',
  setting = null,
  userMessage = '',
  conversationText = '',
  nextQuestion = '',
  investmentGoalKnown = false,
  strategyGoalConflict = false,
} = {}) {
  if (!isOpeningFormTurn || flowRole !== 'agent' || namedReply || isOutOfScopeMessage) {
    return String(finalReply || '');
  }
  const original = polishOpeningReply(finalReply);
  if (replyHasQuestionMark(original) && !(isInvestorVisitor && asksGenericBuyerFunnel(original))) return original;

  const base = splitReplySentences(original)
    .filter((sentence) => sentence && !replyHasQuestionMark(sentence) && !asksGenericBuyerFunnel(sentence))
    .slice(0, 2)
    .join(' ')
    .trim();

  const area = displayLocation(locationHint);
  const language = replyLanguage(setting, userMessage, conversationText);
  const openAsk = String(nextQuestion || '').trim();
  // Prefer the next unanswered saved question (English catalog labels) over canned funnel copy.
  const englishOpenAsk = openAsk && language === 'english'
    ? (replyHasQuestionMark(openAsk) ? openAsk : `${openAsk.replace(/[.!\s]+$/, '')}?`)
    : '';
  // Investors never fall through to the buyer funnel (neighbourhood shortlist / features), in any language.
  let firstQuestion = isInvestorVisitor
    ? (strategyGoalConflict
      ? (INVESTOR_STRATEGY_CONFIRM_QUESTION[language] || '')
      : englishOpenAsk
        || (!investmentGoalKnown
          ? investorOpeningQuestion(setting, userMessage, conversationText, area)
          : (INVESTOR_REFINEMENT_QUESTION[language] || '')))
    : englishOpenAsk || agentOpeningFunnelQuestion(setting, {
      intent,
      location: area,
      userMessage,
      earlierText: conversationText,
    });
  if (!firstQuestion) return original;
  // A tailored model sentence already opens the reply: drop the canned "Great start." intro.
  if (base) {
    const parts = splitReplySentences(firstQuestion);
    if (parts.length > 1 && !replyHasQuestionMark(parts[0])) firstQuestion = parts.slice(1).join(' ');
  }

  const fallbackThanks = language === 'english' ? 'Thanks for sharing those details.' : '';
  const lead = base || fallbackThanks;
  if (!lead) return firstQuestion;
  return `${lead} ${firstQuestion}`.trim();
}

const GENERIC_OPENER_RE = /^(?:it'?s|it is)\s+(?:a\s+)?(?:pleasure|great|wonderful|nice|lovely)\s+(?:to\s+)?(?:connect|see|meet|hear)\b[^.!?]*[.!?]\s*/i;
const GREAT_START_RE = /(^|\s)great start[.!]\s*/gi;
const BUYER_FUNNEL_RE = /neighbou?rhood shortlist or property features/i;

function asksGenericBuyerFunnel(text) {
  return BUYER_FUNNEL_RE.test(String(text || ''));
}

/** Fix and flip targets resale profit; a rental-income goal points to buy-and-hold. */
export function investorStrategyGoalConflict(investmentType, investmentGoal) {
  const type = String(investmentType || '').toLowerCase().replace(/_/g, ' ');
  const goal = String(investmentGoal || '').toLowerCase().replace(/_/g, ' ');
  return /\bflip\b/.test(type) && /\brental|cash ?flow\b/.test(goal) && !/\bboth\b/.test(goal);
}

/** "400k–700k" / "400k 700k" / "400K-700K" -> "$400K–$700K" (catalog bands are dollar bands). */
export function formatBudgetBands(text) {
  return String(text || '').replace(
    /(\$?)(\d+(?:\.\d+)?)\s*([km])\s*(?:[-\u2013\u2014]|\s|to)\s*\$?(\d+(?:\.\d+)?)\s*([km])\b/gi,
    (_m, _d, a, ua, b, ub) => `$${a}${ua.toUpperCase()}\u2013$${b}${ub.toUpperCase()}`,
  );
}

/** Opening-turn polish: drop filler openers and canned "Great start.", format budget bands. */
export function polishOpeningReply(reply) {
  let text = String(reply || '').trim();
  const sentences = splitReplySentences(text);
  const kept = sentences.filter((sentence) => !GENERIC_OPENER_RE.test(sentence));
  if (sentences.length > 1 && kept.length && kept.length < sentences.length) {
    const rest = kept.join(' ');
    const name = GENERIC_OPENER_RE.test(sentences[0])
      ? sentences[0].match(/,\s*([A-Z][\p{L}'-]+)[.!]\s*$/u)?.[1]
      : '';
    text = name ? `Welcome, ${name}. ${rest}` : rest;
  }
  if (splitReplySentences(text).length > 1) text = text.replace(GREAT_START_RE, '$1').replace(/\s{2,}/g, ' ').trim();
  return formatBudgetBands(text);
}

const DOCUMENT_LINE_RE = /\b(upload|proof of funds|pre-?approval|photo id|document|bank statement)\b/i;
const DECLINE_REFINE_QUESTION = {
  investor: 'Which should we adjust first: the area, budget, property type, or investment strategy?',
  buyer: 'Which should we adjust first: the area, budget, or property type?',
};
export const DECLINE_REFINE_RE = /which should we adjust first/i;

/**
 * After a visitor declines shown options: brief acknowledgement plus one refinement question.
 * Drops document/upload lines; prefers the next unanswered saved question (English labels).
 */
export function declineRefinementReply(reply, { nextQuestion = '', isInvestor = false, language = 'english' } = {}) {
  const sentences = splitReplySentences(reply).filter((sentence) => !DOCUMENT_LINE_RE.test(sentence));
  const statements = sentences.filter((sentence) => !replyHasQuestionMark(sentence));
  const questions = sentences.filter((sentence) => replyHasQuestionMark(sentence));
  if (language !== 'english') return sentences.join(' ').trim() || String(reply || '').trim();
  const ask = questions[0]
    || (nextQuestion ? (replyHasQuestionMark(nextQuestion) ? nextQuestion : `${String(nextQuestion).replace(/[.!\s]+$/, '')}?`) : '')
    || DECLINE_REFINE_QUESTION[isInvestor ? 'investor' : 'buyer'];
  const lead = statements.slice(0, 1).join(' ').trim() || 'Understood, those options are not the right fit.';
  return `${lead} ${ask}`.replace(/\s+/g, ' ').trim();
}

/** "lahore" -> "Lahore", "new york" -> "New York"; keeps existing capitals (e.g. "GTA"). */
export function displayLocation(location) {
  return String(location || '').trim().replace(/(^|[\s,/-])(\p{Ll})/gu, (_, sep, c) => `${sep}${c.toUpperCase()}`);
}

export function investorOpeningQuestion(setting, userMessage = '', earlierText = '', location = '') {
  const language = replyLanguage(setting, userMessage, earlierText);
  const copy = INVESTOR_OPENING_QUESTION[language];
  if (!copy) return '';
  const area = String(location || '').trim();
  let question = copy.question;
  if (area) question = AREA_PREFIX[language] ? AREA_PREFIX[language](area, question) : `${area}: ${question}`;
  return `${copy.intro} ${question}`;
}

export function withWarmGreeting(reply, setting, userMessage = '', earlierText = '') {
  const text = String(reply || '').trim();
  if (!text || !isGreetingOnly(userMessage)) return text;
  if (GREETING_START.test(text)) return text;
  const language = replyLanguage(setting, userMessage, earlierText);
  if (!replyLooksLocalized(language, text)) return text;
  const pack = WARM_HELLO[language] || WARM_HELLO.english;
  const primary = setting?.personalities?.[0] || '';
  const hello = pack[primary] || pack.default || WARM_HELLO.english[primary] || 'Hello, I am glad you are here';
  const excited = language === 'english' && (primary === 'friendly' || setting?.formality === 'casual') && allowsLawyerExclamation(setting, primary);
  return joinLawyerSentences(hello, text, excited, language === 'mandarin' || language === 'cantonese' ? 'mandarin' : 'english');
}

export function hasReplyCustomization(setting) {
  return Boolean(
    setting?.personalities?.length
    || setting?.communication_style
    || setting?.formality
    || (setting?.custom_tones || []).length
    || (setting?.languages || []).some((id) => id && id !== 'english'),
  );
}

export function customToneById(setting, id) {
  if (!id) return null;
  return (setting?.custom_tones || []).find((tone) => tone.id === id) || null;
}

export function customLeadIn(custom) {
  const guidance = String(custom?.guidance || '').replace(/\s+/g, ' ').trim();
  const descriptive = guidance.length > 0 && guidance.length <= 80
    && !/\b(use|write|say|avoid|sound|reply|sentence|voice|emoji|exclamation|do not|don't|never)\b/i.test(guidance);
  if (descriptive) {
    const phrase = guidance.replace(/[.!?]+$/g, '').trim();
    if (phrase) return `I will keep this ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`;
  }
  const name = String(custom?.name || '').trim();
  if (name.length < 2) return '';
  return `I will keep this ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

export function voiceLead(map, id, setting, allowCustom = false) {
  if (map[id]) return map[id];
  if (!allowCustom) return '';
  return customLeadIn(customToneById(setting, id));
}

export function allowsLawyerExclamation(setting, primary) {
  const quiet = setting?.formality === 'formal' || primary === 'polished' || primary === 'luxury';
  const customTone = Boolean(customToneById(setting, primary));
  return !quiet && (primary === 'friendly' || setting?.formality === 'casual' || customTone);
}

export function joinLawyerSentences(first, second, excited, language = 'english') {
  const head = String(first || '').trim().replace(/[.!\s。]+$/g, '');
  const tail = String(second || '').trim();
  if (!head) return tail;
  if (!tail) return head;
  const stop = language === 'mandarin' ? '。' : (excited ? '!' : '.');
  return `${head}${stop} ${tail}`;
}

export function composeStyledLawyerReply(setting, { leads, questions, facts, fallbackLead, fallbackQuestion }, language = 'english') {
  const primary = setting?.personalities?.[0] || '';
  const secondary = setting?.personalities?.[1] || '';
  const style = setting?.communication_style || '';
  const question = voiceLead(questions, secondary, setting)
    || voiceLead(questions, primary, setting)
    || fallbackQuestion;
  const lead = voiceLead(leads, primary, setting, true) || fallbackLead;
  const excited = (primary === 'friendly' || setting?.formality === 'casual') && allowsLawyerExclamation(setting, primary);
  const voiceIsConsultative = primary === 'consultative' || secondary === 'consultative';
  if (style === 'quick') {
    if (secondary && lead && lead !== question) return joinLawyerSentences(lead, question, false, language);
    return question;
  }
  const fact = voiceIsConsultative ? '' : (facts[style] || '');
  if (fact) return joinLawyerSentences(fact, question, false, language);
  if (style === 'consultative' || voiceIsConsultative) {
    const observation = lead || facts.consultative || fallbackLead;
    if (!observation || observation === question) return question;
    return joinLawyerSentences(observation, question, false, language);
  }
  if (!lead || lead === question) return question;
  return joinLawyerSentences(lead, question, excited, language);
}

export function dropRepeatedVisitorName(reply, firstName, { keepName = false } = {}) {
  const name = String(firstName || '').trim();
  const text = String(reply || '');
  if (!name || keepName || name.length < 3) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keptParts = [];
  const kept = text.replace(new RegExp(`\\bmy name is\\s+${escaped}\\b`, 'gi'), (match) => {
    keptParts.push(match);
    return `___KEEP_NAME_${keptParts.length - 1}___`;
  });
  return kept
    .replace(new RegExp(`\\b(hi|hello|hey|dear)\\s+${escaped}\\b`, 'gi'), '$1')
    .replace(new RegExp(`\\bthank you(?: for that)?,?\\s+${escaped}\\b`, 'gi'), 'Thank you')
    .replace(new RegExp(`,\\s*${escaped}\\b`, 'gi'), '')
    .replace(new RegExp(`\\b${escaped}\\s*,`, 'gi'), '')
    .replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '')
    .replace(/___KEEP_NAME_(\d+)___/g, (_, index) => keptParts[Number(index)] || '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*(?=[.!?؟])/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.!?؟])/g, '$1')
    .trim();
}

export function polishLawyerRegister(reply, setting) {
  const primary = setting?.personalities?.[0] || '';
  const customTone = (setting?.custom_tones || []).some((tone) => tone.id === primary);
  const quiet = setting?.formality === 'formal' || primary === 'polished' || primary === 'luxury';
  const allowOne = !quiet && (primary === 'friendly' || setting?.formality === 'casual' || customTone);
  let text = String(reply || '')
    .replace(/\s+as well\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  if (!allowOne) {
    return text.replace(/!+/g, '.').replace(/\.{2,}/g, '.').trim();
  }
  let used = false;
  text = text.replace(/!+/g, () => {
    if (used) return '.';
    used = true;
    return '!';
  });
  return text.replace(/\.{2,}/g, '.').trim();
}
