import { lawyerReplyDrifted } from './lawyerReplyDrift.js';
import { GREETING_START, isClosingRefusal } from './visitorMessage.js';
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

const AREA_ASK = /\b(area|areas|jurisdiction|where do you|where are you|seing|seeing|serve)\b/i;
const NAMED_MATTER = /\b(refinanc|title transfer|purchase|sale|selling|buying)\b/i;
const PARTY_ASK = /\bparties\b/i;
const CLOSING_TYPE_ASK = /purchase closing/i;

function lawyerPlaces(setting) {
  return (setting?.jurisdictions || []).map((place) => String(place || '').trim()).filter(Boolean);
}

const MATTER_LEAD = {
  friendly: 'Happy to help',
  polished: 'I can certainly help',
  luxury: 'I can look after the matter',
  persuasive: 'The next step is naming the matter',
  caring: 'I am glad to help',
  consultative: 'The matter decides which documents I review',
};

const MATTER_QUESTION = {
  friendly: 'Is it a refinance closing, a title transfer, or a document review?',
  polished: 'Is this a refinance closing, a title transfer, or a document review?',
  luxury: 'Would this be a refinance closing, a title transfer, or a document review?',
  persuasive: 'Is the next step a refinance closing, a title transfer, or a document review?',
  caring: 'Could you tell me if this is a refinance closing, a title transfer, or a document review?',
  consultative: 'So I know which documents matter, is this a refinance closing, a title transfer, or a document review?',
};

const MATTER_FACT = {
  educational: 'A refinance, a title transfer, and a document review each use different papers',
  consultative: 'The matter decides which documents I review first',
};

const AREA_LEAD = {
  friendly: 'Sure',
  polished: 'I can confirm that',
  luxury: 'My practice covers specific jurisdictions',
  persuasive: 'I can help where I am licensed',
  caring: 'I am glad you asked',
  consultative: 'The jurisdiction decides whether I can act',
};

const AREA_FACT = {
  friendly: 'Licensing follows the jurisdiction',
  polished: 'Licensing follows the jurisdiction',
  luxury: 'Licensing is limited to specific jurisdictions',
  persuasive: 'I can move ahead where I am licensed',
  caring: 'I only take files where I am licensed',
  consultative: 'The jurisdiction decides whether I can act',
};

const LANGUAGE_PACKS = {
  french: {
    plainMatter: 'De quoi s’agit-il ? Un refinancement, un transfert de titre ou une révision de documents ?',
    matterLead: {
      friendly: 'Avec plaisir',
      polished: 'Je peux certainement vous aider',
      luxury: 'Je peux m’occuper de ce dossier',
      persuasive: 'La prochaine étape est de nommer le dossier',
      caring: 'Je suis heureux de vous aider',
      consultative: 'Le dossier décide des documents que j’examine',
    },
    matterQuestion: {
      friendly: 'Est-ce un refinancement, un transfert de titre ou une révision de documents ?',
      polished: 'S’agit-il d’un refinancement, d’un transfert de titre ou d’une révision de documents ?',
      luxury: 'Serait-ce un refinancement, un transfert de titre ou une révision de documents ?',
      persuasive: 'La prochaine étape est-elle un refinancement, un transfert de titre ou une révision de documents ?',
      caring: 'Pouvez-vous me dire s’il s’agit d’un refinancement, d’un transfert de titre ou d’une révision de documents ?',
      consultative: 'Pour savoir quels documents comptent, s’agit-il d’un refinancement, d’un transfert de titre ou d’une révision de documents ?',
    },
    matterFact: {
      educational: 'Un refinancement, un transfert de titre et une révision de documents n’utilisent pas les mêmes documents',
      consultative: 'Le dossier décide des documents que j’examine d’abord',
    },
    areaLead: {
      friendly: 'Bien sûr',
      polished: 'Je peux le confirmer',
      luxury: 'Mon cabinet couvre des territoires précis',
      persuasive: 'Je peux aider là où je suis habilité',
      caring: 'Je suis heureux que vous le demandiez',
      consultative: 'Le territoire décide si je peux agir',
    },
    areaFact: {
      friendly: 'L’habilitation suit le territoire',
      polished: 'L’habilitation suit le territoire',
      luxury: 'L’habilitation est limitée à des territoires précis',
      persuasive: 'Je peux avancer là où je suis habilité',
      caring: 'Je n’accepte un dossier que là où je suis habilité',
      consultative: 'Le territoire décide si je peux agir',
    },
    licensed: (list) => `Je suis habilité en ${list}.`,
    licensedCasual: (list) => `Je suis habilité en ${list}.`,
    licensedPrivate: (list) => `Je suis habilité, à titre privé, en ${list}.`,
    assistIn: (list) => `Je peux vous aider en ${list}.`,
    askJurisdiction: 'Dans quel territoire se trouve la propriété ?',
    continue: 'Je peux continuer à partir de là.',
    matterFallbackLead: 'Je peux vous aider',
    matterFallbackQuestion: 'S’agit-il d’un refinancement, d’un transfert de titre ou d’une révision de documents ?',
  },
  spanish: {
    plainMatter: '¿De qué se trata? ¿Un refinanciamiento, una transferencia de título o una revisión de documentos?',
    matterLead: {
      friendly: 'Con gusto',
      polished: 'Puedo ayudarle',
      luxury: 'Puedo ocuparme del asunto',
      persuasive: 'El siguiente paso es nombrar el asunto',
      caring: 'Me alegra ayudarle',
      consultative: 'El asunto decide qué documentos reviso',
    },
    matterQuestion: {
      friendly: '¿Es un refinanciamiento, una transferencia de título o una revisión de documentos?',
      polished: '¿Se trata de un refinanciamiento, una transferencia de título o una revisión de documentos?',
      luxury: '¿Sería un refinanciamiento, una transferencia de título o una revisión de documentos?',
      persuasive: '¿El siguiente paso es un refinanciamiento, una transferencia de título o una revisión de documentos?',
      caring: '¿Podría decirme si es un refinanciamiento, una transferencia de título o una revisión de documentos?',
      consultative: 'Para saber qué documentos importan, ¿es un refinanciamiento, una transferencia de título o una revisión de documentos?',
    },
    matterFact: {
      educational: 'Un refinanciamiento, una transferencia de título y una revisión de documentos usan papeles distintos',
      consultative: 'El asunto decide qué documentos reviso primero',
    },
    areaLead: {
      friendly: 'Claro',
      polished: 'Puedo confirmarlo',
      luxury: 'Mi práctica cubre jurisdicciones concretas',
      persuasive: 'Puedo ayudar donde estoy autorizado',
      caring: 'Me alegra que lo pregunte',
      consultative: 'La jurisdicción decide si puedo actuar',
    },
    areaFact: {
      friendly: 'La autorización sigue a la jurisdicción',
      polished: 'La autorización sigue a la jurisdicción',
      luxury: 'La autorización se limita a jurisdicciones concretas',
      persuasive: 'Puedo avanzar donde estoy autorizado',
      caring: 'Solo tomo asuntos donde estoy autorizado',
      consultative: 'La jurisdicción decide si puedo actuar',
    },
    licensed: (list) => `Estoy autorizado en ${list}.`,
    licensedCasual: (list) => `Estoy autorizado en ${list}.`,
    licensedPrivate: (list) => `Estoy autorizado, de forma privada, en ${list}.`,
    assistIn: (list) => `Puedo ayudar en ${list}.`,
    askJurisdiction: '¿En qué jurisdicción está la propiedad?',
    continue: 'Puedo continuar desde aquí.',
    matterFallbackLead: 'Puedo ayudar con esto',
    matterFallbackQuestion: '¿Se trata de un refinanciamiento, una transferencia de título o una revisión de documentos?',
  },
  mandarin: {
    plainMatter: '那么这件事是什么？再融资过户、产权过户，还是文件审阅？',
    matterLead: {
      friendly: '很高兴帮忙',
      polished: '我可以协助处理',
      luxury: '我可以妥善处理此事',
      persuasive: '下一步是说明事项',
      caring: '我很乐意协助',
      consultative: '事项决定我先审阅哪些文件',
    },
    matterQuestion: {
      friendly: '这是再融资过户、产权过户，还是文件审阅？',
      polished: '请问这是再融资过户、产权过户，还是文件审阅？',
      luxury: '这会是再融资过户、产权过户，还是文件审阅？',
      persuasive: '下一步是再融资过户、产权过户，还是文件审阅？',
      caring: '可以告诉我这是再融资过户、产权过户，还是文件审阅吗？',
      consultative: '为了确认要审阅的文件，这是再融资过户、产权过户，还是文件审阅？',
    },
    matterFact: {
      educational: '再融资过户、产权过户和文件审阅使用的文件各不相同',
      consultative: '事项决定我先审阅哪些文件',
    },
    areaLead: {
      friendly: '可以',
      polished: '我可以确认',
      luxury: '我的执业范围限于特定法域',
      persuasive: '我可以在持牌法域提供协助',
      caring: '很高兴您问到这一点',
      consultative: '法域决定我是否可以处理',
    },
    areaFact: {
      friendly: '执业资格跟法域有关',
      polished: '执业资格跟法域有关',
      luxury: '执业资格限于特定法域',
      persuasive: '我可以在持牌法域继续处理',
      caring: '我只接受我可以执业的法域',
      consultative: '法域决定我是否可以处理',
    },
    licensed: (list) => `我可以在${list}执业。`,
    licensedCasual: (list) => `我可以在${list}执业。`,
    licensedPrivate: (list) => `我可以在${list}以私人方式执业。`,
    assistIn: (list) => `我可以在${list}提供协助。`,
    askJurisdiction: '房产位于哪个法域？',
    continue: '我可以从这里继续。',
    matterFallbackLead: '我可以协助',
    matterFallbackQuestion: '请问这是再融资过户、产权过户，还是文件审阅？',
  },
};

function licensedSentence(places, setting, userMessage = '') {
  const pack = LANGUAGE_PACKS[replyLanguage(setting, userMessage)];
  const primary = setting?.personalities?.[0] || '';
  if (!places.length) {
    if (pack) return pack.askJurisdiction;
    if (primary === 'caring') return 'Could you share the jurisdiction?';
    if (primary === 'consultative') return 'Which jurisdiction is the property in, so I can confirm I am licensed there?';
    if (primary === 'persuasive') return 'Which jurisdiction should I confirm first?';
    return 'Which jurisdiction is the property in?';
  }
  const list = places.join(', ');
  const formal = setting?.formality === 'formal' || primary === 'polished' || primary === 'luxury';
  const casual = !formal && (setting?.formality === 'casual' || primary === 'friendly');
  if (pack) {
    if (primary === 'persuasive') return pack.assistIn(list);
    if (primary === 'luxury') return pack.licensedPrivate(list);
    if (casual) return pack.licensedCasual(list);
    return pack.licensed(list);
  }
  if (primary === 'persuasive') return casual ? `I can help in ${list}.` : `I can assist in ${list}.`;
  if (primary === 'luxury') return `I am licensed privately in ${list}.`;
  if (casual) return `I'm licensed in ${list}.`;
  return `I am licensed in ${list}.`;
}

function lawyerAreaReply(setting, userMessage = '') {
  const places = lawyerPlaces(setting);
  const language = replyLanguage(setting, userMessage);
  const pack = LANGUAGE_PACKS[language];
  const plain = places.length
    ? `I am licensed in ${places.join(', ')}.`
    : 'Share the jurisdiction and I can confirm whether I am licensed to assist there.';
  if (!hasReplyCustomization(setting)) return plain;
  const primary = setting?.personalities?.[0] || '';
  const leads = pack ? { ...AREA_LEAD, ...pack.areaLead } : AREA_LEAD;
  const facts = pack ? { ...AREA_FACT, ...pack.areaFact } : AREA_FACT;
  return composeStyledLawyerReply(setting, {
    leads,
    questions: {},
    facts: {
      educational: facts[primary] || (pack ? pack.areaFact.polished : 'A lawyer can act only in a licensed jurisdiction'),
      consultative: facts[primary] || (pack ? pack.areaFact.consultative : 'The jurisdiction decides whether I can act on the file'),
    },
    fallbackLead: places.length ? (pack?.areaLead.polished || 'I can confirm that') : (pack?.areaLead.polished || 'I can check that'),
    fallbackQuestion: licensedSentence(places, setting, userMessage),
  }, language);
}

const PLAIN_MATTER_FOLLOW_UP = 'What is the matter, then? A refinance closing, a title transfer, or a document review?';

function matterFollowUp(setting, userMessage = '') {
  const language = replyLanguage(setting, userMessage);
  const pack = LANGUAGE_PACKS[language];
  if (!hasReplyCustomization(setting)) return pack?.plainMatter || PLAIN_MATTER_FOLLOW_UP;
  return composeStyledLawyerReply(setting, {
    leads: pack ? { ...MATTER_LEAD, ...pack.matterLead } : MATTER_LEAD,
    questions: pack ? { ...MATTER_QUESTION, ...pack.matterQuestion } : MATTER_QUESTION,
    facts: pack ? { ...MATTER_FACT, ...pack.matterFact } : MATTER_FACT,
    fallbackLead: pack?.matterFallbackLead || 'I can help with this',
    fallbackQuestion: pack?.matterFallbackQuestion || 'Is this a refinance closing, a title transfer, or a document review?',
  }, language);
}

function sentencesWithoutDrift(reply) {
  return String(reply || '')
    .split(/(?<=[.!])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !sentence.includes('?') && !lawyerReplyDrifted(sentence))
    .join(' ')
    .trim();
}

export function guardLawyerReply(reply, setting = null, userMessage = '') {
  const text = String(reply || '').trim();
  if (!text || !lawyerReplyDrifted(text)) return text;
  if (AREA_ASK.test(userMessage)) return lawyerAreaReply(setting, userMessage);
  if (NAMED_MATTER.test(userMessage)) {
    return sentencesWithoutDrift(text) || 'I can help with that matter.';
  }
  const greeting = text.match(GREETING_START);
  const hello = greeting ? `${greeting[0][0].toUpperCase()}${greeting[0].slice(1)}` : '';
  const [primary = '', secondary = ''] = setting?.personalities || [];
  const question = GUARD_QUESTION_BY_VOICE[secondary] || 'Is this a purchase closing, a sale closing, or a refinance closing?';
  const fact = primary === 'consultative' || secondary === 'consultative'
    ? ''
    : GUARD_FACT_BY_STYLE[setting?.communication_style] || '';
  const body = fact ? `${fact} ${question}` : question;
  const casual = setting?.formality === 'casual' || primary === 'friendly';
  if (hello) return casual ? `${hello}! ${body}` : `${hello}. ${body}`;
  if (setting?.communication_style === 'quick') return question;
  const leadIn = GUARD_LEAD_IN_BY_VOICE[primary] || 'I can help with this closing.';
  return `${leadIn} ${body}`;
}

const CLOSING_LOOP = /purchase closing|sale closing/i;

function moveOffClosingLoop(reply, userMessage, previousReply, setting) {
  if (!isClosingRefusal(userMessage)) return reply;
  if (!CLOSING_LOOP.test(previousReply) || !CLOSING_LOOP.test(reply)) return reply;
  const kept = String(reply)
    .split(/(?<=[.!])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !CLOSING_LOOP.test(sentence))
    .join(' ')
    .trim();
  const next = matterFollowUp(setting, userMessage);
  if (hasReplyCustomization(setting) && /^(i understand|understood|okay|ok|sure|of course)\.?$/i.test(kept)) {
    return next;
  }
  return kept ? `${kept} ${next}` : next;
}

const REPEATED_QUESTION_TOPICS = [
  ['parties', /\b(parties|parties au|partes|当事人)\b/i],
  ['title', /\b(title search|title deed|about the title|titre|título|产权)\b/i],
  ['agreement', /\b(purchase agreement|the agreement|been signed|convention|acuerdo|协议)\b/i],
  ['timeline', /\b(closing timeline|closing date|délai de clôture|fecha de cierre|过户时间)\b/i],
  ['jurisdiction', /\b(which jurisdiction|where are you licensed|quel territoire|qué jurisdicción|哪个法域)\b/i],
  ['closing', /\b(purchase closing|sale closing)\b/i],
];

function askedTopics(text) {
  const source = String(text || '');
  if (!source.includes('?') && !source.includes('？')) return [];
  return REPEATED_QUESTION_TOPICS.filter(([, pattern]) => pattern.test(source)).map(([id]) => id);
}

function dropRepeatedLawyerQuestion(reply, previousReply, setting, userMessage) {
  const previousTopics = new Set(askedTopics(previousReply));
  if (!previousTopics.size) return reply;
  const kept = String(reply || '')
    .split(/(?<=[.!?？])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence.includes('?') && !sentence.includes('？')) return true;
      const topics = askedTopics(sentence).filter((topic) => {
        if (topic === 'closing' && /refinance|title transfer|document review|refinancement|refinanciamiento|再融资/i.test(sentence)) {
          return false;
        }
        if (topic === 'title' && /title transfer|transfert de titre|transferencia de título|产权过户/i.test(sentence)) {
          return false;
        }
        return true;
      });
      return !topics.some((topic) => previousTopics.has(topic));
    })
    .join(' ')
    .trim();
  if (kept) return kept;
  return LANGUAGE_PACKS[replyLanguage(setting, userMessage)]?.continue
    || {
      friendly: 'Happy to help with the next step.',
      polished: 'I can continue from there.',
      luxury: 'I can take the next step whenever you are ready.',
      persuasive: 'The next step is yours to name.',
      caring: 'I am glad to keep going from here.',
      consultative: 'The next detail you share decides what I review.',
    }[setting?.personalities?.[0]]
    || 'I can continue from here.';
}

function shapeLawyerVoice(reply, setting) {
  if (!hasReplyCustomization(setting) || replyLanguage(setting) !== 'english') return reply;
  const primary = setting?.personalities?.[0] || '';
  const lead = MATTER_LEAD[primary] || customLeadIn(customToneById(setting, primary));
  if (!lead) return reply;
  if (String(reply || '').toLowerCase().startsWith(lead.toLowerCase())) return reply;
  const match = String(reply || '').match(/^(?:i understand|understood|of course)\b[.!]?\s*/i);
  if (!match) return reply;
  const rest = reply.slice(match[0].length).trim();
  if (!rest) return reply;
  const excited = (primary === 'friendly' || setting?.formality === 'casual') && allowsLawyerExclamation(setting, primary);
  return joinLawyerSentences(lead, rest, excited);
}

export function finishLawyerReply(reply, { userMessage = '', previousReply = '', setting = null, documentReceived = false } = {}) {
  const original = String(reply || '').trim();
  const closingRefusal = isClosingRefusal(userMessage)
    && CLOSING_LOOP.test(previousReply)
    && (CLOSING_LOOP.test(original) || lawyerReplyDrifted(original));
  let text = original;
  if (closingRefusal && CLOSING_LOOP.test(original)) text = moveOffClosingLoop(original, userMessage, previousReply, setting);
  else if (closingRefusal) text = matterFollowUp(setting, userMessage);
  else if (lawyerReplyDrifted(original)) {
    text = AREA_ASK.test(userMessage)
      ? lawyerAreaReply(setting, userMessage)
      : (sentencesWithoutDrift(original) || guardLawyerReply(original, setting, userMessage));
  } else {
    text = moveOffClosingLoop(original, userMessage, previousReply, setting);
  }
  text = dropRepeatedLawyerQuestion(text, previousReply, setting, userMessage);
  text = shapeLawyerVoice(text, setting);
  text = polishLawyerRegister(text, setting);
  text = withWarmGreeting(text, setting, userMessage);
  return withOccasionalEmoji(text, setting, { previousReply, role: 'lawyer', userMessage, documentReceived });
}

const GUARD_LEAD_IN_BY_VOICE = {
  friendly: 'Happy to help with this closing.',
  polished: 'I can certainly help with this closing.',
  luxury: 'I handle the legal side of real-estate closings.',
  persuasive: 'Let us focus on the closing itself.',
  caring: 'I am glad to help with this closing.',
  consultative: 'The closing type shapes what I review.',
};

const GUARD_QUESTION_BY_VOICE = {
  friendly: 'Is it a purchase closing, a sale closing, or a refinance closing?',
  caring: 'Could you tell me if this is a purchase closing, a sale closing, or a refinance closing?',
  persuasive: 'Let us start there: is this a purchase closing, a sale closing, or a refinance closing?',
  consultative: 'So I know which documents matter, is this a purchase closing, a sale closing, or a refinance closing?',
};

const GUARD_FACT_BY_STYLE = {
  educational: 'Each closing type has its own documents and title steps.',
  consultative: 'The closing type decides which documents I review first.',
};
