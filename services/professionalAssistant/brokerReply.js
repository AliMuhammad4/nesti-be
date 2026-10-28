import { GREETING_START, isClosingRefusal, isGreetingOnly } from './visitorMessage.js';
import {
  allowsLawyerExclamation,
  composeStyledLawyerReply,
  customLeadIn,
  customToneById,
  hasReplyCustomization,
  joinLawyerSentences,
  polishLawyerRegister,
  replyLanguage,
  withWarmGreeting,
} from './replyStyle.js';
import { withOccasionalEmoji } from './assistantEmoji.js';

const MORTGAGE_LOOP = /new mortgage|\ba refinance\b|refinancing or renewing/i;
const BROKER_DRIFT = /\b(buy or sell|buying or selling|looking to buy|looking to sell|property type|features or amenities|attract buyers)\b/i;

const BROKER_LEAD = {
  friendly: 'Happy to help',
  polished: 'I can certainly help',
  luxury: 'I can look after the financing',
  persuasive: 'The next step is naming the mortgage',
  caring: 'I am glad to help',
  consultative: 'The mortgage type decides which file I open',
};

const BROKER_QUESTION = {
  both: {
    friendly: 'Is it a renewal, or do you already have a pre-approval?',
    polished: 'Is this a renewal, or do you already have a pre-approval?',
    luxury: 'Would this be a renewal, or a pre-approval you already hold?',
    persuasive: 'Is the next step a renewal or a pre-approval?',
    caring: 'Could you tell me if this is a renewal, or if you already have a pre-approval?',
    consultative: 'So I know which file to open, is this a renewal or a pre-approval you already have?',
  },
  renewal: {
    friendly: 'Is it a renewal?',
    polished: 'Is this a renewal?',
    luxury: 'Would this be a renewal?',
    persuasive: 'Is the next step a renewal?',
    caring: 'Could you tell me if this is a renewal?',
    consultative: 'So I know which file to open, is this a renewal?',
  },
  amount: {
    friendly: 'What financing amount are you considering?',
    polished: 'What financing amount should I plan for?',
    luxury: 'What financing amount should I prepare?',
    persuasive: 'What financing amount is the next step?',
    caring: 'Could you share the financing amount you have in mind?',
    consultative: 'So I know which lenders fit, what financing amount are you considering?',
  },
  location: {
    friendly: 'Where is the property?',
    polished: 'Where is the property located?',
    luxury: 'Where is the property located?',
    persuasive: 'Which location should we start with?',
    caring: 'Could you tell me where the property is?',
    consultative: 'So I can check the local options, where is the property?',
  },
  property_value: {
    friendly: 'What is the property value?',
    polished: 'What is the approximate property value?',
    luxury: 'What is the approximate property value?',
    persuasive: 'What property value should we use?',
    caring: 'Could you share the approximate property value?',
    consultative: 'So I can size the mortgage, what is the approximate property value?',
  },
  timeline: {
    friendly: 'What is your financing timeline?',
    polished: 'What is your preferred financing timeline?',
    luxury: 'What financing timeline should I plan around?',
    persuasive: 'What timeline should we work toward?',
    caring: 'Could you tell me your preferred financing timeline?',
    consultative: 'So I know how soon to prepare, what is your financing timeline?',
  },
  preapproval: {
    friendly: 'Do you already have a pre-approval?',
    polished: 'Do you already have a mortgage pre-approval?',
    luxury: 'Do you already hold a mortgage pre-approval?',
    persuasive: 'Is a pre-approval the next step, or do you already have one?',
    caring: 'Could you tell me if you already have a pre-approval?',
    consultative: 'So I know where the file stands, do you already have a pre-approval?',
  },
};

const BROKER_FACT = {
  educational: 'A renewal and a new mortgage use different applications',
  consultative: 'The mortgage type decides which documents I need first',
};

const BROKER_I18N = {
  french: {
    plain: 'De quoi s’agit-il ? Un renouvellement, ou un dossier déjà commencé ?',
    lead: { friendly: 'Avec plaisir', polished: 'Je peux vous aider', caring: 'Je suis heureux de vous aider', consultative: 'Le type de prêt décide du dossier', luxury: 'Je peux m’occuper du financement', persuasive: 'La prochaine étape est de nommer le prêt' },
    both: { friendly: 'Est-ce un renouvellement, ou avez-vous déjà une préautorisation ?', polished: 'S’agit-il d’un renouvellement, ou avez-vous déjà une préautorisation ?', caring: 'Pouvez-vous me dire s’il s’agit d’un renouvellement ou si vous avez déjà une préautorisation ?', consultative: 'Pour savoir quel dossier ouvrir, est-ce un renouvellement ou une préautorisation déjà obtenue ?' },
    renewal: { friendly: 'Est-ce un renouvellement ?', polished: 'S’agit-il d’un renouvellement ?' },
    amount: { friendly: 'Quel montant de financement envisagez-vous ?', polished: 'Quel montant de financement dois-je prévoir ?' },
    location: { friendly: 'Où se trouve la propriété ?', polished: 'Où la propriété est-elle située ?' },
    property_value: { friendly: 'Quelle est la valeur de la propriété ?', polished: 'Quelle est la valeur approximative de la propriété ?' },
    timeline: { friendly: 'Quel est votre échéancier de financement ?', polished: 'Quel échéancier de financement préférez-vous ?' },
    preapproval: { friendly: 'Avez-vous déjà une préautorisation ?', polished: 'Avez-vous déjà une préautorisation hypothécaire ?' },
    mortgage: {
      friendly: 'Est-ce un nouveau prêt ou un refinancement ?',
      polished: 'S’agit-il d’un nouveau prêt ou d’un refinancement ?',
      caring: 'Pouvez-vous me dire s’il s’agit d’un nouveau prêt ou d’un refinancement ?',
      consultative: 'Pour savoir quel dossier ouvrir, est-ce un nouveau prêt ou un refinancement ?',
    },
    mortgageFact: {
      educational: 'Un nouveau prêt et un refinancement commencent par des documents différents',
      consultative: 'Le type de prêt décide du dossier que j’ouvre',
    },
    continue: 'Je peux continuer à partir de là.',
  },
  spanish: {
    plain: '¿De qué se trata la hipoteca? ¿Una renovación o un expediente ya iniciado?',
    lead: { friendly: 'Con gusto', polished: 'Puedo ayudarle', caring: 'Me alegra ayudarle', consultative: 'El tipo de hipoteca decide el expediente', luxury: 'Puedo ocuparme del financiamiento', persuasive: 'El siguiente paso es nombrar la hipoteca' },
    both: { friendly: '¿Es una renovación o ya tiene una preaprobación?', polished: '¿Se trata de una renovación o ya tiene una preaprobación?' },
    renewal: { friendly: '¿Es una renovación?', polished: '¿Se trata de una renovación?' },
    amount: { friendly: '¿Qué monto de financiamiento está considerando?', polished: '¿Qué monto de financiamiento debo prever?' },
    location: { friendly: '¿Dónde está la propiedad?', polished: '¿Dónde se encuentra la propiedad?' },
    property_value: { friendly: '¿Cuál es el valor de la propiedad?', polished: '¿Cuál es el valor aproximado de la propiedad?' },
    timeline: { friendly: '¿Cuál es su plazo de financiamiento?', polished: '¿Cuál es su plazo preferido de financiamiento?' },
    preapproval: { friendly: '¿Ya tiene una preaprobación?', polished: '¿Ya tiene una preaprobación hipotecaria?' },
    mortgage: {
      friendly: '¿Es una hipoteca nueva o un refinanciamiento?',
      polished: '¿Se trata de una hipoteca nueva o un refinanciamiento?',
      caring: '¿Puede decirme si es una hipoteca nueva o un refinanciamiento?',
    },
    mortgageFact: {
      educational: 'Una hipoteca nueva y un refinanciamiento parten de documentos distintos',
      consultative: 'El tipo de hipoteca decide qué expediente abro primero',
    },
    continue: 'Puedo continuar desde aquí.',
  },
  mandarin: {
    plain: '那么这是什么贷款？续贷，还是已经开始的申请？',
    lead: { friendly: '很高兴帮忙', polished: '我可以协助', caring: '我很乐意协助', consultative: '贷款类型决定我打开哪份档案', luxury: '我可以处理这项融资', persuasive: '下一步是说明贷款类型' },
    both: { friendly: '这是续贷，还是您已经有预批？', polished: '请问这是续贷，还是您已经有预批？' },
    renewal: { friendly: '这是续贷吗？', polished: '请问这是续贷吗？' },
    amount: { friendly: '您考虑的融资金额是多少？', polished: '请问需要规划的融资金额是多少？' },
    location: { friendly: '房产在哪里？', polished: '请问房产位于哪里？' },
    property_value: { friendly: '房产价值是多少？', polished: '请问房产大约价值多少？' },
    timeline: { friendly: '您的融资时间是怎样的？', polished: '请问您希望的融资时间是什么？' },
    preapproval: { friendly: '您已经有预批了吗？', polished: '请问您是否已经有房贷预批？' },
    mortgage: {
      friendly: '这是新贷款还是再融资？',
      polished: '请问这是新贷款还是再融资？',
      caring: '可以告诉我这是新贷款还是再融资吗？',
    },
    mortgageFact: {
      educational: '新贷款和再融资从不同的文件开始',
      consultative: '贷款类型决定我先打开哪份档案',
    },
    continue: '我可以从这里继续。',
  },
};

const PLAIN_BROKER_FOLLOW_UP = 'What is the mortgage, then? A renewal, or a file you already started?';

function brokerFollowUpFocus(setting) {
  if (!Array.isArray(setting?.qualification_questions)) return 'both';
  const ids = setting.qualification_questions;
  if (ids.includes('purpose') && ids.includes('preapproval')) return 'both';
  if (ids.includes('purpose')) return 'renewal';
  return ['amount', 'location', 'property_value', 'timeline', 'preapproval'].find((id) => ids.includes(id)) || 'continue';
}

function brokerMatterFollowUp(setting, userMessage = '', conversationText = '') {
  const language = replyLanguage(setting, userMessage, conversationText);
  const pack = BROKER_I18N[language];
  const focus = brokerFollowUpFocus(setting);
  if (!hasReplyCustomization(setting)) return pack?.plain || PLAIN_BROKER_FOLLOW_UP;
  if (focus === 'continue') return pack?.continue || 'I can continue from here.';
  const questions = { ...(BROKER_QUESTION[focus] || BROKER_QUESTION.both), ...(pack?.[focus] || {}) };
  const leads = pack?.lead ? { ...BROKER_LEAD, ...pack.lead } : BROKER_LEAD;
  return composeStyledLawyerReply(setting, {
    leads,
    questions,
    facts: BROKER_FACT,
    fallbackLead: leads.polished || 'I can help with this mortgage',
    fallbackQuestion: questions.polished || questions.friendly || 'Is this a renewal?',
  }, language);
}

const BROKER_MORTGAGE_QUESTION = {
  friendly: 'Is it a new mortgage or a refinance?',
  polished: 'Is this a new mortgage or a refinance?',
  luxury: 'Would this be a new mortgage or a refinance?',
  persuasive: 'Is the next step a new mortgage or a refinance?',
  caring: 'Could you tell me if this is a new mortgage or a refinance?',
  consultative: 'So I know which file to open, is this a new mortgage or a refinance?',
};

function brokerDriftReply(setting, userMessage = '', conversationText = '') {
  const language = replyLanguage(setting, userMessage, conversationText);
  const pack = BROKER_I18N[language];
  const questions = { ...BROKER_MORTGAGE_QUESTION, ...(pack?.mortgage || {}) };
  const leads = pack?.lead ? { ...BROKER_LEAD, ...pack.lead } : BROKER_LEAD;
  return composeStyledLawyerReply(setting || {}, {
    leads,
    questions,
    facts: pack?.mortgageFact || {
      educational: 'A new mortgage and a refinance start from different documents',
      consultative: 'The mortgage type decides which file I open first',
    },
    fallbackLead: leads.polished || 'I can help with this mortgage',
    fallbackQuestion: questions.polished || questions.friendly || 'Is this a new mortgage or a refinance?',
  }, language);
}

function isStockMortgageAsk(reply) {
  const text = String(reply || '').trim();
  if (!MORTGAGE_LOOP.test(text)) return false;
  const sentences = text.split(/(?<=[.!?？])\s+/).filter(Boolean);
  if (!sentences.length || sentences.length > 2) return false;
  return sentences.every((sentence) => (
    GREETING_START.test(sentence)
    || MORTGAGE_LOOP.test(sentence)
  ));
}

function brokerHelloInVoice(reply, setting, userMessage, conversationText = '') {
  const body = brokerDriftReply(setting, userMessage, conversationText);
  const language = replyLanguage(setting, userMessage, conversationText);
  const greeting = String(reply || '').match(GREETING_START);
  const style = setting?.communication_style;
  if (!greeting || language !== 'english' || style === 'educational' || style === 'consultative') return body;
  const hello = greeting[0].charAt(0).toUpperCase() + greeting[0].slice(1).toLowerCase();
  const question = body.split(/(?<=[.!?？])\s+/).filter((part) => /[?？]/.test(part)).pop() || body;
  const primary = setting?.personalities?.[0] || '';
  const excited = (primary === 'friendly' || setting?.formality === 'casual') && allowsLawyerExclamation(setting, primary);
  return joinLawyerSentences(hello, question, excited, language);
}

const BROKER_REPEAT_TOPICS = [
  ['amount', /\b(financing amount|loan amount|how much|borrow|montant de financement|monto de financiamiento|融资金额)\b/i],
  ['location', /\b(where is the property|property located|property location|which city|what city|what area|where are you looking|où se trouve la propriété|dónde está la propiedad|房产在哪里)\b/i],
  ['value', /\b(property value|approximate value|home worth|house worth|purchase price|valeur de la propriété|valor de la propiedad|房产价值)\b/i],
  ['timeline', /\b(financing timeline|how soon|when do you|when are you|échéancier de financement|plazo de financiamiento|融资时间)\b/i],
  ['preapproval', /\b(pre-approval|preapproval|pre-approved|preapproved|préautorisation|preaprobación|预批)\b/i],
  ['mortgage', /\b(new mortgage|a refinance|refinancing)\b/i],
];

function brokerAskedTopics(text) {
  const source = String(text || '');
  if (!source.includes('?') && !source.includes('？')) return [];
  return BROKER_REPEAT_TOPICS.filter(([, pattern]) => pattern.test(source)).map(([id]) => id);
}

function dropRepeatedBrokerQuestion(reply, previousReply, setting, userMessage, conversationText = '') {
  const previousTopics = new Set(brokerAskedTopics(previousReply));
  if (!previousTopics.size) return reply;
  const kept = String(reply || '')
    .split(/(?<=[.!?？])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence.includes('?') && !sentence.includes('？')) return true;
      const topics = brokerAskedTopics(sentence).filter((topic) => {
        if (topic === 'mortgage' && /renewal|renouvellement|renovación|续贷/i.test(sentence) && !/new mortgage|\ba refinance\b/i.test(sentence)) {
          return false;
        }
        return true;
      });
      return !topics.some((topic) => previousTopics.has(topic));
    })
    .join(' ')
    .trim();
  if (kept) return kept;
  return BROKER_I18N[replyLanguage(setting, userMessage, conversationText)]?.continue
    || BROKER_LEAD[setting?.personalities?.[0]]
    || 'I can continue from here.';
}

function shapeBrokerVoice(reply, setting) {
  if (!hasReplyCustomization(setting) || replyLanguage(setting) !== 'english') return reply;
  const primary = setting?.personalities?.[0] || '';
  const lead = BROKER_LEAD[primary] || customLeadIn(customToneById(setting, primary));
  if (!lead) return reply;
  if (String(reply || '').toLowerCase().startsWith(lead.toLowerCase())) return reply;
  const match = String(reply || '').match(/^(?:i understand|understood|of course|are you considering|sure)\b[.!]?\s*/i);
  if (!match) return reply;
  const rest = reply.slice(match[0].length).trim();
  if (!rest) return reply;
  const excited = (primary === 'friendly' || setting?.formality === 'casual') && allowsLawyerExclamation(setting, primary);
  return joinLawyerSentences(lead, rest, excited);
}

export function finishBrokerReply(reply, { userMessage = '', previousReply = '', setting = null, documentReceived = false, conversationText = '' } = {}) {
  const original = String(reply || '').trim();
  const language = replyLanguage(setting, userMessage, conversationText);
  const refusedMortgage = isClosingRefusal(userMessage)
    && MORTGAGE_LOOP.test(previousReply)
    && MORTGAGE_LOOP.test(original);
  let text = isGreetingOnly(userMessage) && BROKER_I18N[language]
    ? brokerDriftReply(setting, userMessage, conversationText)
    : refusedMortgage
      ? brokerMatterFollowUp(setting, userMessage, conversationText)
      : BROKER_DRIFT.test(original)
        ? brokerDriftReply(setting, userMessage, conversationText)
        : (hasReplyCustomization(setting) && isStockMortgageAsk(original)
          ? brokerHelloInVoice(original, setting, userMessage, conversationText)
          : original);
  text = dropRepeatedBrokerQuestion(text, previousReply, setting, userMessage, conversationText);
  text = shapeBrokerVoice(text, setting);
  text = hasReplyCustomization(setting) ? polishLawyerRegister(text, setting) : text;
  text = withWarmGreeting(text, setting, userMessage);
  return withOccasionalEmoji(text, setting, { previousReply, role: 'mortgage_broker', userMessage, documentReceived });
}
