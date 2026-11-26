import { isGreetingOnly, isVagueYes, normalizedVisitorText } from '../../professionalAssistant/visitorMessage.js';
import { replyLanguage } from '../../professionalAssistant/replyStyle.js';
import { userSignalsBookingIntent, visitorPausesDetails } from '../utils/chatBookingReply.js';
import {
  assistantAnnouncingOptionCards,
  assistantOfferedAvailableOptions,
} from '../utils/propertyMatchesRequestIntent.js';
import { DOCUMENT_NAMES } from './documentCoverage.js';
import { allMarketDocumentNames, marketDocumentName } from '../../professionalAssistant/brokerInvestorMarket.js';
const DOCUMENT_ASK = {
  french: (name, quick) => (quick ? `Envoyez ${name} ici.` : `Vous pouvez envoyer ${name} ici.`),
  spanish: (name, quick) => (quick ? `Suba ${name} aquí.` : `Puede subir ${name} aquí.`),
  mandarin: (name) => `请在这里上传${name}。`,
  cantonese: (name) => `請喺呢度上載${name}。`,
  arabic: (name) => `يمكنك رفع ${name} من هنا.`,
  urdu: (name) => `آپ ${name} یہاں بھیج سکتے ہیں۔`,
  hindi: (name) => `आप ${name} यहाँ भेज सकते हैं।`,
  punjabi: (name) => `ਤੁਸੀਂ ${name} ਇੱਥੇ ਭੇਜ ਸਕਦੇ ਹੋ।`,
  tamil: (name) => `நீங்கள் ${name} இங்கே அனுப்பலாம்.`,
};

function documentAskLine(request, setting, userMessage, conversationText = '') {
  const language = replyLanguage(setting, userMessage, conversationText);
  const names = DOCUMENT_NAMES[language] || DOCUMENT_NAMES.english;
  const marketLanguage = DOCUMENT_NAMES[language] ? language : 'english';
  const marketName = marketDocumentName(request.id, request.market, marketLanguage);
  const name = marketName || names[request.id] || DOCUMENT_NAMES.english[request.id] || String(request.label || '').toLowerCase();
  const quick = setting?.communication_style === 'quick';
  const formal = setting?.formality === 'formal' || ['luxury', 'polished'].includes(setting?.personalities?.[0]);
  if (DOCUMENT_ASK[language]) return DOCUMENT_ASK[language](name, quick);
  if (quick) return `Upload your ${name} here.`;
  if (formal) return `Please upload the ${name} here when you are ready.`;
  return `You can upload your ${name} here.`;
}

function gentleDocumentReask(request, setting, userMessage, conversationText = '') {
  const language = replyLanguage(setting, userMessage, conversationText);
  if (language && language !== 'english') return documentAskLine(request, setting, userMessage, conversationText);
  const marketName = marketDocumentName(request.id, request.market, 'english');
  const name = marketName || DOCUMENT_NAMES.english[request.id] || String(request.label || '').toLowerCase();
  const quick = setting?.communication_style === 'quick';
  const formal = setting?.formality === 'formal' || ['luxury', 'polished'].includes(setting?.personalities?.[0]);
  if (quick) return `Send your ${name} when you can, or say skip if you do not have it.`;
  if (formal) return `Whenever it is convenient, you may upload your ${name} here, or let me know if it is not available and we will continue.`;
  return `No rush, you can upload your ${name} whenever it suits you, or just tell me if you do not have it and we will keep going.`;
}

function requestPatterns(request) {
  const names = [
    request?.label,
    ...Object.values(DOCUMENT_NAMES).map((pack) => pack[request?.id]),
    ...allMarketDocumentNames(request?.id),
  ].filter(Boolean);
  return [...new Set(names.map((name) => String(name).toLowerCase().replace(/\s+/g, ' ').trim()))]
    .filter((name) => name.length >= 4);
}

export function requestDocumentForReply(request, reply) {
  if (!request?.label && !request?.id) return null;
  const text = String(reply || '');
    const matched = requestPatterns(request).some((phrase) => {
    const body = phrase.replace(/^(recent|current)\s+/, '');
    const variants = [body, body.replace(/\bstubs\b/g, 'stub'), body.replace(/\bphotos\b/g, 'photo')];
    return variants.some((variant) => {
      const pattern = variant.split(' ').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
      return new RegExp(pattern, 'i').test(text);
    });
  });
  return matched ? request : null;
}

const OPENING_INTAKE = {
  lawyer: /\b(purchase closing|sale closing|refinance closing)\b/i,
  mortgage_broker: /\b(new mortgage|refinance|renewal)\b/i,
  agent: /\b(buy or sell|buying or selling|looking to buy|looking to sell)\b/i,
};

function isOpeningIntake(reply, role) {
  const pattern = OPENING_INTAKE[role];
  const text = String(reply || '');
  return Boolean(pattern && text.includes('?') && text.length < 320 && pattern.test(text));
}

function isIntentOnly(message) {
  const text = normalizedVisitorText(message);
  if (!text || isGreetingOnly(message) || isVagueYes(message)) return true;
  return /^(yes |yeah |yep )?(i am |im |am )?(looking to |want to |going to |trying to )?(sell|buy|selling|buying)( a home| a house| a property)?$/.test(text);
}

function replyAsks(reply) {
  return /[?？]/.test(String(reply || ''));
}

function withoutDocumentSentence(reply, request) {
  return String(reply || '')
    .split(/(?<=[.!?？])\s+/)
    .filter((sentence) => sentence && !requestDocumentForReply(request, sentence))
    .join(' ')
    .trim();
}

function replyPushesMeeting(reply) {
  return /\b(consultation|strategy call|our meeting|phone call or email|available times|calendly)\b/i.test(String(reply || ''));
}

function withoutMeetingPush(reply) {
  return String(reply || '')
    .split(/(?<=[.!?？])\s+/)
    .filter((sentence) => sentence && !replyPushesMeeting(sentence))
    .join(' ')
    .trim();
}

export function applyDocumentAsk(reply, request, { previousReply = '', userMessage = '', setting = null, conversationText = '', qualificationOpen = null } = {}) {
  const text = String(reply || '').trim();
  const previousWasDetail = replyAsks(previousReply) && !isOpeningIntake(previousReply, setting?.role);
  const shortAnswer = isVagueYes(userMessage) || isIntentOnly(userMessage);
  if (!request?.label || qualificationOpen || isGreetingOnly(userMessage) || visitorPausesDetails(userMessage) || (shortAnswer && !previousWasDetail)) {
    return { reply: withoutDocumentSentence(text, request), request: null };
  }
  if (assistantOfferedAvailableOptions(text) || assistantAnnouncingOptionCards(text)) {
    return { reply: withoutDocumentSentence(text, request), request: null };
  }
  if (isOpeningIntake(text, setting?.role) && !replyPushesMeeting(text)) return { reply: withoutDocumentSentence(text, request), request: null };
  if (requestDocumentForReply(request, previousReply) && requestDocumentForReply(request, text)) {
    const acknowledgement = withoutDocumentSentence(text, request);
    const reask = gentleDocumentReask(request, setting, userMessage, conversationText);
    return { reply: [acknowledgement, reask].filter(Boolean).join(' '), request };
  }
  if (requestDocumentForReply(request, previousReply) || requestDocumentForReply(request, text)) return { reply: text, request };
  if (replyAsks(text) && !previousWasDetail && qualificationOpen !== false) {
    return { reply: withoutDocumentSentence(text, request), request: null };
  }
  const body = replyPushesMeeting(text) && !userSignalsBookingIntent(userMessage) ? withoutMeetingPush(text) : text;
  const statements = body
    .split(/(?<=[.!?？])\s+/)
    .filter((sentence) => sentence && !/[?？]/.test(sentence))
    .slice(0, 2)
    .join(' ')
    .trim();
  const line = documentAskLine(request, setting, userMessage, conversationText);
  return { reply: `${statements} ${line}`.trim(), request };
}
