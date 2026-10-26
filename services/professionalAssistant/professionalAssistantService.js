import { randomUUID } from 'node:crypto';
import ProfessionalAssistantSetting from '../../models/ProfessionalAssistantSetting.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import { locationOverlaps } from '../agent/propertyMatch/locationUtils.js';
import { profileVisitorFactsBlock } from '../chat/utils/profileVisitorFacts.js';
import {
  ASSISTANT_ROLES,
  COMMUNICATION_STYLES,
  DIFFERENTIATORS,
  ROLE_DIFFERENTIATORS,
  FORMALITIES,
  LANGUAGES,
  NEXT_ACTIONS,
  PERSONALITIES,
  QUALIFICATION,
  ROLE_ASSISTANT_FAQS,
  SERVICES,
  VOICE_LANGUAGES,
  idsOf,
  labelOf,
} from './catalog.js';

const clip = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const faqText = (value, max) => String(value || '').trim().slice(0, max);
const list = (value, allowed, max) => {
  const source = Array.isArray(value) ? value : [];
  const kept = [];
  source.forEach((item) => {
    const id = clip(item, 80);
    if (!id || !allowed.includes(id) || kept.includes(id) || kept.length >= max) return;
    kept.push(id);
  });
  return kept;
};
const freeList = (value, max, itemMax) => {
  const source = Array.isArray(value) ? value : [];
  const kept = [];
  source.forEach((item) => {
    const text = clip(item, itemMax);
    if (!text || kept.some((entry) => entry.toLowerCase() === text.toLowerCase()) || kept.length >= max) return;
    kept.push(text);
  });
  return kept;
};

const RETIRED_DEFAULT_ANSWERS = new Set([
  'I can collect the property location and expected closing date so the lawyer can confirm whether they can assist and explain the process.',
  'Share the property location and expected closing date; the lawyer can review the details and confirm the next steps.',
  'A lawyer may review transaction documents, address title and closing requirements, and coordinate legal steps. The exact work depends on the transaction and jurisdiction.',
  'The lawyer can confirm whether they can review the agreement and what documents are needed. Please do not share confidential documents in this chat.',
  'The lawyer can discuss title-search services for your transaction and confirm the scope based on the property and its jurisdiction.',
  'The lawyer can confirm whether they assist with refinance transactions and what information is needed for an initial discussion.',
  'Fees depend on the transaction, location, and work required. The lawyer can provide details after reviewing the relevant information.',
  'Timing depends on the transaction, documents, and jurisdiction. The lawyer can help identify key dates once they know more about your file.',
  'Tell me where the property is located and I can help the lawyer confirm whether they are authorized and available to assist there.',
  'Documents vary by transaction and jurisdiction. The lawyer can provide a tailored list after learning whether you are buying, selling, or refinancing.',
  'Share your preference and the lawyer can confirm whether a remote consultation is available for your matter.',
  'This chat is for general information and arranging contact. The lawyer can advise you after understanding your matter and confirming the appropriate engagement.',
].map((answer) => answer.toLowerCase()));

export function assistantFaqsForRole(role, savedFaqs = []) {
  const saved = Array.isArray(savedFaqs) ? savedFaqs : [];
  const defaults = (ROLE_ASSISTANT_FAQS[role] || []).map((faq) => {
    const savedFaq = saved.find((item) => item?.id === faq.id || (
      item?.is_default === true
      && item?.question?.trim().toLowerCase() === faq.question.toLowerCase()
    ));
    const savedAnswer = String(savedFaq?.answer || '').trim().toLowerCase();
    const keepSavedAnswer = savedFaq && savedAnswer
      && !RETIRED_DEFAULT_ANSWERS.has(savedAnswer)
      && !(role === 'lawyer' && lawyerReplyDrifted(savedAnswer));
    return {
      ...faq,
      ...(keepSavedAnswer ? savedFaq : {}),
      answer: keepSavedAnswer ? savedFaq.answer : faq.answer,
      id: faq.id,
      is_default: true,
      approved: true,
      source: 'manual',
    };
  });
  const customFaqs = saved
    .filter((faq) => faq?.is_default !== true)
    .map((faq, index) => ({
      id: clip(faq?.id, 120) || `${role}-custom-faq-${index + 1}`,
      question: faqText(faq?.question, 240),
      answer: faqText(faq?.answer, 1200),
      is_default: false,
      source: faq?.source === 'generated' ? 'generated' : 'manual',
      approved: faq?.source === 'generated' ? faq?.approved === true : true,
    }))
    .filter((faq) => faq.question && faq.answer)
    .slice(0, 8);
  return [...defaults, ...customFaqs];
}

export function roleForUser(user, profile) {
  const role = profile?.professional_type || user?.role;
  return ASSISTANT_ROLES.includes(role) ? role : '';
}

export function emptyAssistant(role) {
  return {
    role,
    applied: false,
    bot_name: '',
    display_name: '',
    bot_persona_title: '',
    welcome_message: '',
    signup_cta_copy: '',
    consent_line: '',
    personalities: [],
    custom_tones: [],
    languages: [],
    auto_detect_language: true,
    communication_style: 'conversational',
    formality: 'professional',
    use_emojis: false,
    address_by_first_name: true,
    suggest_consultation: true,
    services: [],
    country: '',
    region: '',
    cities: [],
    neighbourhoods: [],
    virtual_consultations: false,
    jurisdictions: [],
    differentiators: [],
    custom_expertise: [],
    unique_note: '',
    faqs: assistantFaqsForRole(role),
    services_pricing: '',
    custom_guidance: '',
    qualification_questions: idsOf(QUALIFICATION[role] || []),
    next_actions: ['schedule', 'collect_contact', 'notify', 'save_lead'],
    hot_guidance: 'Prospects who show strong intent, urgency, and readiness to take action.',
    warm_guidance: 'Prospects who are interested but need more guidance or time.',
    cold_guidance: 'Prospects who are researching or working on a longer timeline.',
  };
}

export function prefillAssistant(role, profile) {
  const draft = emptyAssistant(role);
  draft.display_name = clip(profile?.full_name, 80);
  const languages = (profile?.languages_spoken || []).filter((item) => idsOf(LANGUAGES).includes(item));
  draft.languages = languages.length ? languages : ['english'];
  draft.country = clip(profile?.country, 40);
  draft.region = clip(profile?.jurisdiction, 80);
  draft.cities = freeList(profile?.service_area_cities, 12, 80);
  draft.neighbourhoods = freeList(
    [profile?.target_neighborhoods, ...(profile?.service_area_regions || [])],
    12,
    80,
  );
  draft.jurisdictions = role === 'lawyer' && profile?.jurisdiction ? [clip(profile.jurisdiction, 80)] : [];
  draft.unique_note = clip(profile?.bio, 400);
  return draft;
}

export function sanitizeAssistant(input, role) {
  const base = emptyAssistant(role);
  const source = input && typeof input === 'object' ? input : {};
  const style = idsOf(COMMUNICATION_STYLES).includes(source.communication_style)
    ? source.communication_style
    : base.communication_style;
  const formality = FORMALITIES.includes(source.formality) ? source.formality : base.formality;
  const faqs = assistantFaqsForRole(role, source.faqs);
  const customToneIds = new Set();
  const customTones = (Array.isArray(source.custom_tones) ? source.custom_tones : [])
    .slice(0, 8)
    .map((tone) => ({
      id: clip(tone?.id, 80),
      name: clip(tone?.name, 40),
      guidance: clip(tone?.guidance, 200),
    }))
    .filter((tone) => {
      if (!tone.id || tone.name.length < 2 || tone.guidance.length < 8 || customToneIds.has(tone.id)) return false;
      customToneIds.add(tone.id);
      return true;
    });
  const validPersonalities = [...idsOf(PERSONALITIES), ...customTones.map((tone) => tone.id)];
  return {
    ...base,
    applied: source.applied === true,
    bot_name: clip(source.bot_name, 40) || base.bot_name,
    display_name: clip(source.display_name, 80),
    bot_persona_title: clip(source.bot_persona_title, 80),
    welcome_message: clip(source.welcome_message, 2000),
    signup_cta_copy: clip(source.signup_cta_copy, 400),
    consent_line: clip(source.consent_line, 400),
    personalities: list(source.personalities, validPersonalities, 2),
    custom_tones: customTones,
    languages: list(source.languages, idsOf(LANGUAGES), 20),
    auto_detect_language: source.auto_detect_language !== false,
    communication_style: style,
    formality,
    use_emojis: source.use_emojis === true,
    address_by_first_name: source.address_by_first_name !== false,
    suggest_consultation: source.suggest_consultation !== false,
    services: list(source.services, idsOf(SERVICES[role] || []), 12),
    country: clip(source.country, 40),
    region: clip(source.region, 80),
    cities: freeList(source.cities, 12, 80),
    neighbourhoods: freeList(source.neighbourhoods, 12, 80),
    virtual_consultations: source.virtual_consultations === true,
    jurisdictions: role === 'lawyer' ? freeList(source.jurisdictions, 8, 80) : [],
    differentiators: list(source.differentiators, idsOf(DIFFERENTIATORS), 9),
    custom_expertise: freeList(source.custom_expertise, 12, 100),
    unique_note: clip(source.unique_note, 400),
    faqs,
    services_pricing: clip(source.services_pricing, 800),
    custom_guidance: clip(source.custom_guidance, 2000),
    qualification_questions: list(source.qualification_questions, idsOf(QUALIFICATION[role] || []), 8),
    next_actions: list(source.next_actions, idsOf(NEXT_ACTIONS), 8),
    hot_guidance: clip(source.hot_guidance, 300) || base.hot_guidance,
    warm_guidance: clip(source.warm_guidance, 300) || base.warm_guidance,
    cold_guidance: clip(source.cold_guidance, 300) || base.cold_guidance,
  };
}

export function assistantSettingForPreview(input, role) {
  return sanitizeAssistant({ ...(input || {}), applied: true }, role);
}

const FORMALITY_DIRECTIVES = {
  formal: 'Use formal language. Keep the selected voice audible, including the opening word, and avoid slang or casual asides.',
  professional: 'Use clear professional language. Polite and plain, neither stiff nor slangy.',
  casual: 'Use casual everyday language. Contractions are fine. Do not sound corporate.',
};

export function formalityInstruction(setting) {
  const key = setting?.formality;
  const directive = FORMALITY_DIRECTIVES[key];
  return directive ? `Reply formality: ${key}. ${directive}` : '';
}

export function voiceInstruction(setting) {
  const voices = (setting?.personalities || []).map((id) => {
    const custom = (setting?.custom_tones || []).find((tone) => tone.id === id);
    if (custom?.name) return custom.guidance ? `${custom.name}: ${custom.guidance}` : custom.name;
    const row = PERSONALITIES.find(([value]) => value === id);
    return row ? `${row[1]} — ${row[2]}` : '';
  }).filter(Boolean);
  return voices.join('; ');
}

export function communicationInstruction(setting) {
  const style = COMMUNICATION_STYLES.find(([id]) => id === setting?.communication_style);
  return style ? `${style[1]}. ${style[2]}` : '';
}

const VOICE_CONDUCT = {
  friendly: 'Friendly: easy, upbeat, texting rhythm. Use contractions and everyday words such as "great", "sure", "love that". One light exclamation is fine. Avoid stiff words such as "assist", "regarding", "kindly".',
  polished: 'Polished: crisp, businesslike, complete sentences. Use words such as "certainly", "I can arrange", "to confirm". No exclamation marks, no "Hey", no slang, and no gushing.',
  luxury: 'Luxury: refined, private, and unhurried. Use words such as "private", "at your pace", "exceptional". No exclamation marks, no slang, no "Hey", and no hurry words such as "quick" or "ASAP".',
  persuasive: 'Persuasive: confident and forward. Name one concrete next step and a benefit, using words such as "let\'s", "the next step is", "I can line up". No hedging such as "maybe" or "if you want".',
  caring: 'Caring: patient and reassuring. Warm and direct. On a hello, greet and ask the question. Do not say the visitor can answer later, and do not say there is no rush unless they sound worried.',
  consultative: 'Consultative: thoughtful advisor. Ask one precise question and give a short reason it matters ("so I can..."). No pitch, no hype, and no stock greeting.',
};

const ROLE_GREETING_OPENER = {
  agent: 'buying or selling',
  lawyer: 'whether this is a purchase closing or a sale closing',
  mortgage_broker: 'a new mortgage or a refinance',
};

const TONE_GREETING = {
  friendly: 'Friendly opening: a casual hello. Write a fresh word, not a copied phrase.',
  polished: 'Polished opening: a formal hello. No hey, no slang, and no exclamation mark.',
  luxury: 'Luxury opening: reserved and unhurried. No hey, no slang, and no exclamation mark. Write your own greeting.',
  persuasive: 'Persuasive opening: a plain hello, then the next step.',
  caring: 'Caring opening: a soft hello. No sales push.',
  consultative: 'Consultative opening: a plain hello.',
};

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
  'assalamu alaikum',
  'as-salamu alaykum',
];

function normalizedVisitorText(message) {
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
  'how is it going',
  'hows it going',
  'whats up',
  'what is up',
];

function isSocialCheck(message) {
  const text = normalizedVisitorText(message);
  if (SOCIAL_CHECKS.includes(text)) return true;
  return GREETING_ONLY_PATTERNS.some((prefix) => SOCIAL_CHECKS.some((suffix) => text === `${prefix} ${suffix}`));
}

function isVagueYes(message) {
  const text = normalizedVisitorText(message);
  return ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay'].includes(text);
}

function isGreetingOnly(message) {
  if (isSocialCheck(message)) return false;
  return GREETING_ONLY_PATTERNS.includes(normalizedVisitorText(message));
}

function firstGreetingLine(setting, opener) {
  const greetings = (setting?.personalities || []).map((id) => {
    const custom = (setting?.custom_tones || []).find((tone) => tone.id === id);
    if (custom?.name) return `Open in the ${custom.name} voice. ${custom.guidance || ''}`.trim();
    return TONE_GREETING[id] || '';
  }).filter(Boolean);
  const greeting = greetings[0] || 'Open with a short hello in the selected voice. Write a fresh sentence.';
  const second = greetings[1] ? ` The question must use the second voice. ${greetings[1]}` : '';
  const question = setting?.role === 'lawyer'
    ? 'The one question is whether this is a purchase closing or a sale closing.'
    : setting?.role === 'mortgage_broker'
      ? 'The one question is whether this is a new mortgage or a refinance.'
      : `Then ask one short question about ${opener}.`;
  return `When the visitor's latest message is only a greeting (hello, hi, hey, hi there, good morning, salam), the reply must start with a greeting in the selected voice. ${greeting}${second} ${question} The visitor is already here, so ask that question directly. Do not say they can answer later. Do not skip the greeting. Do not repeat the welcome line. Do not list three options. Do not describe or label the greeting. Write a normal greeting in that voice.`;
}

const BANNED_STOCK_PHRASES = [
  'How can I assist you',
  'How can I help you today',
  'your real estate needs',
  'Hey there! How can I assist you today?',
  "I'm excited to help you with that",
];

function selectedVoiceRules(setting) {
  return (setting?.personalities || []).map((id) => {
    const custom = (setting?.custom_tones || []).find((tone) => tone.id === id);
    if (custom?.guidance) return `${custom.name}: ${custom.guidance}`;
    return VOICE_CONDUCT[id] || '';
  }).filter(Boolean);
}

const REPLY_BREVITY = 'Sound like a person texting, not a brochure. One or two short sentences. One question. No intro about who you are, no stacked adjectives, and no extra sentence just to sound complete.';

function voiceUseLine(voices, mode) {
  if (voices.length === 1) {
    return `Use only this voice, inside the short reply. Do not lay a generic warm voice on top of it. ${voices[0]}`;
  }
  if (voices.length > 1) {
    const named = `First voice — ${voices[0]} Second voice — ${voices[1]}`;
    if (mode === 'greeting') {
      return `Use both voices in the same one or two short sentences. The greeting carries the first voice. The question carries the second voice. Do not drop the second voice. ${named}`;
    }
    if (mode === 'answer') {
      return `Use both voices in the same one or two short sentences. Do not open with a hello. The answer carries the first voice. The follow-up question carries the second voice. Do not drop the second voice. ${named}`;
    }
    return `Use both voices in the same one or two short sentences. Do not drop the second voice. When the latest message is only a greeting: The greeting carries the first voice. The question carries the second voice. On every other message, do not open with a hello. The answer carries the first voice and the single follow-up carries the second voice. ${named}`;
  }
  return '';
}

function formalityKeepsVoiceLine(setting) {
  const formality = formalityInstruction(setting);
  if (!formality) return '';
  return `${formality} The selected voice stays audible, including the opening word. Formality only limits slang, contractions, and exclamation marks where that still leaves the voice recognizable.`;
}

const LAWYER_QUESTION_TOPICS = [
  ['transaction_type', 'the agreement'],
  ['transaction_value', 'the title'],
  ['urgency', 'the parties'],
  ['location', 'the jurisdiction'],
  ['closing_date', 'the closing timeline'],
];

const LAWYER_INTAKE_TOPICS = new Set(['transaction_type', 'location', 'closing_date']);

function joinWithOr(items) {
  if (items.length < 2) return items[0] || '';
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

export function lawyerQuestionTopics(setting, options = {}) {
  const checked = new Set(setting?.qualification_questions || []);
  return LAWYER_QUESTION_TOPICS
    .filter(([id]) => checked.has(id) && (options.preview || !LAWYER_INTAKE_TOPICS.has(id)))
    .map(([, label]) => label);
}

function lawyerWorkLine(setting, options = {}) {
  const topics = joinWithOr(lawyerQuestionTopics(setting, options));
  if (options.preview) {
    const hello = 'On a hello, the one question is whether this is a purchase closing or a sale closing.';
    if (!topics) {
      return `${hello} On every later reply, answer what was asked about the closing. Do not add a follow-up question unless the visitor asks for the next step.`;
    }
    return `${hello} On every later reply, ask one question about ${topics}. A location or home detail is context for that closing, and the next question stays on ${topics}. A refinance answer talks about the legal documents for that closing, then asks about ${topics}. A dispute or ownership-transfer question stays on the document, the title, the parties, or the jurisdiction.`;
  }
  const follow = topics
    ? `Ask about ${topics} only when that detail is still missing. If the previous reply already asked it, do not ask it again.`
    : 'Do not add a follow-up question unless the visitor asks for the next step.';
  return `The intake form already has the closing type, the location, the closing date, and the legal service. Do not ask those again, and do not ask whether this is a purchase closing, a sale closing, or a refinance closing. Answer the visitor's latest point first in polished, professional sentences. No exclamation marks. A refinance, a title transfer, a purchase, or a sale is the matter, so continue that matter. A question about areas or jurisdiction gets a direct answer from the licensed jurisdictions. ${follow}`;
}

function roleWorkLine(role, setting = null, options = {}) {
  if (role === 'lawyer') return lawyerWorkLine(setting, options);
  if (role === 'mortgage_broker') {
    return 'This reply is for a mortgage. Ask one question about a new mortgage, a refinance, the loan amount, the term, or pre-approval.';
  }
  return '';
}

function intentConductLines(role) {
  if (role === 'lawyer') {
    return [
      'Treat "purchase", "buying", and "closing on a buy" as a purchase closing. Continue that closing, and do not ask the closing type again.',
      'Treat "sale", "sell", "listing", and "my house" as a sale closing. Continue that closing, and do not ask the closing type again.',
      'Treat "refinance" and "refinancing" as a refinance closing. Continue the legal documents for that closing, and do not ask the closing type again.',
      'Treat a title transfer, a property dispute, or an ownership transfer as its own matter. Continue that matter, and do not ask again for a detail the previous reply already requested.',
    ];
  }
  if (role === 'mortgage_broker') {
    return [
      'Treat "looking for", "buying", "new mortgage", and "pre-approval" as a new mortgage. Ask about that mortgage, and do not ask a home-search question.',
      'Treat "refinance", "renew", and "my mortgage" as a refinance or a renewal. Ask which one, and do not ask a home-search question.',
    ];
  }
  return [
    'Treat "looking for", "yes am looking for", "need a place", "searching", and "wanna buy" as buy intent. Ask what they want or which area, and do not ask whether they are buying or selling.',
    'Treat "sell", "listing", and "my house" as sell intent. Ask about that property, and do not ask whether they are buying or selling.',
  ];
}

function styleConductLine(setting) {
  const style = setting?.communication_style;
  const twoVoices = selectedVoiceRules(setting).length > 1;
  if (style === 'quick' && twoVoices) {
    return 'Length: two very short clauses or two short sentences, about 18 words, so both voices are clear.';
  }
  return STYLE_CONDUCT[style] || '';
}

export function voiceTurnReminder(setting, latestMessage = '', options = {}) {
  if (!setting?.applied) return '';
  const greeting = isGreetingOnly(latestMessage);
  const lines = ['VOICE FOR THIS REPLY (applies to the next reply only, and overrides the tone of earlier assistant replies in this chat):'];
  const voice = voiceUseLine(selectedVoiceRules(setting), greeting ? 'greeting' : 'answer');
  if (voice) lines.push(voice);
  const styleLine = styleConductLine(setting);
  if (styleLine) lines.push(styleLine);
  const formality = formalityKeepsVoiceLine(setting);
  if (formality) lines.push(formality);
  lines.push(setting.use_emojis ? 'One emoji is allowed if it fits.' : 'No emojis.');
  lines.push(REPLY_BREVITY);
  if (setting.role !== 'lawyer') {
    lines.push('The confirmation recap may use short labeled lines. Every other reply stays one or two short sentences.');
  }
  lines.push('Ignore the tone of earlier assistant replies. Answer the latest visitor message directly.');
  lines.push(`Never copy wording from these instructions. Write a fresh sentence. Never write: ${BANNED_STOCK_PHRASES.map((phrase) => `"${phrase}"`).join(', ')}.`);
  const opener = ROLE_GREETING_OPENER[setting.role] || ROLE_GREETING_OPENER.agent;
  if (greeting) {
    lines.push(firstGreetingLine(setting, opener));
  } else if (isSocialCheck(latestMessage)) {
    lines.push(`The visitor asked how you are. Answer that in the selected voice in one short clause. Do not open with another hello. Do not ask again about ${opener}.`);
  } else if (setting.role === 'lawyer' && isVagueYes(latestMessage)) {
    lines.push('The visitor said yes without naming the closing. Ask whether this is a purchase closing or a sale closing.');
  } else {
    lines.push('This message is not only a greeting. Answer what was just asked in the selected voice. Do not open with a hello.');
  }
  const work = roleWorkLine(setting.role, setting, options);
  if (work) lines.push(work);
  return lines.join('\n');
}

const STYLE_CONDUCT = {
  quick: 'Length: one short sentence, about 12 words.',
  conversational: 'Length: one or two short sentences, about 25 words.',
  educational: 'Length: two short sentences. One plain fact, then one question. About 35 words.',
  consultative: 'Length: two short sentences. One observation, then one question. About 30 words.',
};

export function replyConductBlock(setting, options = {}) {
  const voices = selectedVoiceRules(setting);
  const opener = ROLE_GREETING_OPENER[setting?.role] || ROLE_GREETING_OPENER.agent;
  const lines = [
    'REPLY CONDUCT (this overrides every earlier persona, warmth, concise-professional line, exact booking script, and character-for-character line):',
    'Read the latest message before choosing a question. Incomplete, casual, and mistyped wording still has a meaning.',
    ...intentConductLines(setting?.role),
    roleWorkLine(setting?.role, setting, options),
    'A short "yes" or "yeah" answers the previous question. Continue from that answer.',
    setting?.role === 'lawyer'
      ? 'When a lawyer visitor says yes without naming the closing, ask whether this is a purchase closing or a sale closing.'
      : '',
    'Speak as the professional in the first person. Say "I have" and "I help with". Do not use the professional\'s name, and do not sound like a separate person describing them.',
    'Never repeat the previous question.',
    `A "how are you" is a social question. Answer it in the selected voice. Do not greet again, and do not repeat the question about ${opener}.`,
  ].filter(Boolean);
  if (setting?.welcome_message) {
    lines.push(`The visitor already saw this welcome: "${setting.welcome_message}". Do not paste that welcome again. A short greeting in the selected voice is still required when they say hi.`);
  }
  lines.push(firstGreetingLine(setting, opener));
  lines.push('On a greeting, use the greeting split above. On every other message, answer what was asked and do not open with a hello.');
  lines.push(`Stay on this role. A hello asks about ${opener}. Loneliness, relationships, and mood get one short redirect back to that question. Do not counsel or give life advice.`);
  lines.push(REPLY_BREVITY);
  if (setting?.role !== 'lawyer') {
    lines.push('The confirmation recap may use short labeled lines. Every other reply stays one or two short sentences.');
  }
  lines.push(`Banned in every tone: ${BANNED_STOCK_PHRASES.map((phrase) => `"${phrase}"`).join(', ')}.`);
  lines.push('Never copy wording from these instructions. Write a fresh sentence each time.');
  if (setting?.role === 'lawyer') {
    lines.push('The greeting words can be fresh. The question keeps the words purchase closing and sale closing, and may mention a refinance closing.');
  }
  const voiceLine = voiceUseLine(voices);
  if (voiceLine) lines.push(voiceLine);
  const styleLine = styleConductLine(setting);
  if (styleLine) {
    lines.push(`${styleLine} Communication style decides length. If a voice line wants a longer reply, keep the feeling and cut it to this length.`);
  }
  const formality = formalityKeepsVoiceLine(setting);
  if (formality) lines.push(formality);
  lines.push('Rewrite every scheduling sentence in this same voice, formality, and length. Keep the booking goal and the same link. Do not copy "Would you like me to share available viewing times now?", "Would you like me to share available consultation times now?", "Would you like me to help you book a quick strategy call", or "Great - please choose a time that works best for you."');
  lines.push('If an earlier line says to use an exact client-facing prompt character-for-character, keep its meaning and rewrite the words in the selected voice.');
  return lines.join('\n');
}

export function appliedPersonaText(setting) {
  const voices = voiceInstruction(setting);
  const style = communicationInstruction(setting);
  const formality = formalityInstruction(setting);
  const roleLimit = setting?.role === 'lawyer'
    ? '\n- You never give legal advice. You qualify the closing and can suggest a consultation with me.'
    : setting?.role === 'mortgage_broker'
      ? '\n- Do not promise rates, approval, or lender decisions.'
      : '';
  return `OVERALL PERSONA:
- ${voices ? `Speak in this voice: ${voices}.` : 'Speak in a clear, professional voice.'}
- ${style ? `Communication style: ${style} This sets reply length and detail.` : 'Keep replies clear and professional.'}
- ${formality || 'Reply formality: professional. Use clear professional language. Polite and plain, neither stiff nor slangy.'}
- Skip a feelings sentence unless the visitor sounds worried. Then one short line, then the question.
- Do not fall back to a generic calm, warm, or concise persona when it conflicts with this voice or style.${roleLimit}`;
}

export function appliedQualificationBlock(setting) {
  const labels = (setting?.qualification_questions || [])
    .map((id) => labelOf(QUALIFICATION[setting?.role] || [], id))
    .filter(Boolean);
  if (!labels.length) {
    return `SELECTED QUALIFICATION QUESTIONS:
- No extra qualification questions are turned on. Do not walk the older default list.`;
  }
  return `SELECTED QUALIFICATION QUESTIONS (ask only these, one at a time, and skip any the client already answered):
${labels.map((question, index) => `${index + 1}. "${question}"`).join('\n')}`;
}

export function introductionLine(_setting, profile) {
  return clip(profile?.full_name, 120) || clip(profile?.company_name, 120) || 'your professional';
}

export function assistantCatalog(role) {
  return {
    personalities: PERSONALITIES,
    communication_styles: COMMUNICATION_STYLES,
    languages: LANGUAGES,
    voice_languages: VOICE_LANGUAGES,
    differentiators: ROLE_DIFFERENTIATORS[role] || DIFFERENTIATORS,
    next_actions: NEXT_ACTIONS,
    services: SERVICES[role] || [],
    qualification: QUALIFICATION[role] || [],
  };
}

function hasServiceArea(setting) {
  return Boolean(setting?.country || setting?.region || setting?.cities?.length || setting?.neighbourhoods?.length || setting?.jurisdictions?.length);
}

export function serviceAreaPlaces(setting) {
  if (!setting?.applied) return [];
  const places = [
    ...(setting.cities || []),
    ...(setting.neighbourhoods || []),
    setting.region,
  ].map((place) => String(place || '').trim()).filter(Boolean);
  if (places.length) return places;
  return setting.country ? [String(setting.country).trim()] : [];
}

export function listingInsideServiceArea(listing, setting) {
  const places = serviceAreaPlaces(setting);
  if (!places.length) return true;
  return places.some((place) => locationOverlaps(place, listing?.location, listing?.address));
}

export function appendAssistantOverlay(prompt, setting, options = {}) {
  if (!setting?.applied) return prompt;
  const lines = [
    'Professional-approved assistant settings for this account only. Ignore every homepage and admin chatbot setting.',
  ];
  if (setting.bot_name) {
    lines.push(`Your spoken assistant name is "${setting.bot_name}". Use it when introducing yourself; do not present it as the professional's name.`);
  }
  if (setting.signup_cta_copy) {
    lines.push(`When account creation is a relevant next step and the visitor has expressed interest, invite them once with this meaning, rewritten in the selected voice and length: "${setting.signup_cta_copy}". Keep the invitation. Do not repeat it or imply an account was created.`);
  }
  if (setting.consent_line) {
    lines.push(`Before asking for contact details, give this consent explanation in the selected voice and length: "${setting.consent_line}". Keep every consent fact. Do not imply consent has been given until the visitor agrees.`);
  }
  if (setting.introduction_line) {
    lines.push(`You are ${setting.introduction_line}. Speak as this professional in the first person. Do not talk about them by name.`);
  }
  const voice = voiceInstruction(setting);
  if (voice) {
    lines.push((setting.personalities || []).length > 1
      ? `Selected voices: ${voice}. Keep both voices distinct inside the same short reply. Do not average them into one generic voice. Keep every fact accurate.`
      : `Selected voice: ${voice}. This voice overrides a generic warm, calm, or concise style. Keep every fact accurate.`);
  }
  const style = communicationInstruction(setting);
  if (style) {
    lines.push(`Communication style: ${style} Keep the reply inside the short length set below.`);
  }
  const formality = formalityInstruction(setting);
  if (formality) lines.push(formality);
  if (setting.languages?.length) {
    const names = setting.languages.map((id) => labelOf(LANGUAGES, id)).filter(Boolean);
    lines.push(`Written chat languages: ${names.join(', ')}. Answer every written reply in ${setting.auto_detect_language ? 'the visitor\'s language when it is one of these, otherwise the first selected language' : names[0]}.`);
  }
  lines.push(setting.use_emojis
    ? 'Emojis are allowed in chat replies only. Never use emojis in a spoken or voice reply.'
    : 'Do not use emojis.');
  lines.push(setting.address_by_first_name
    ? 'Address the client by first name after you know it.'
    : 'Do not address the client by first name.');
  lines.push(setting.suggest_consultation
    ? 'You may suggest a consultation when the client shows interest.'
    : 'Do not suggest a consultation unless the client asks.');
  if (setting.services?.length) {
    const names = setting.services.map((id) => labelOf(SERVICES[setting.role] || [], id)).filter(Boolean);
    if (names.length) lines.push(`Specializations to use when answering: ${names.join(', ')}.`);
  }
  if (hasServiceArea(setting)) {
    const place = [setting.cities?.join(', '), setting.neighbourhoods?.join(', '), setting.region, setting.country].filter(Boolean).join('; ');
    const licensed = setting.jurisdictions?.length ? ` Licensed jurisdictions: ${setting.jurisdictions.join(', ')}.` : '';
    const outOfArea = setting.role === 'lawyer'
      ? 'If the property is outside your licensed jurisdiction, say so and offer to take their details if a consultation is still useful.'
      : 'If an inquiry is outside this area, say so and still offer to take their details.';
    lines.push(`Service area: ${place || 'the saved area'}.${licensed} ${outOfArea} This replaces any instruction that you can help in any city.`);
  }
  if (setting.virtual_consultations) lines.push('Virtual consultations are available, including for visitors outside the saved physical service area.');
  const differentiatorPairs = ROLE_DIFFERENTIATORS[setting.role] || DIFFERENTIATORS;
  const claims = (setting.differentiators || [])
    .filter((id) => id !== 'experience')
    .map((id) => labelOf(differentiatorPairs, id))
    .filter(Boolean);
  if (claims.length || setting.unique_note) {
    lines.push(`Approved claims only: ${[...claims, setting.unique_note].filter(Boolean).join('. ')}. Do not invent other business claims.`);
  }
  if (setting.custom_expertise?.length) {
    lines.push(`Professional-approved custom expertise: ${setting.custom_expertise.join('; ')}. Include these when you show expertise.`);
  }
  const faqs = (setting.faqs || []).filter((faq) => (
    faq.approved && faq.question && faq.answer
    && !(setting.role === 'agent' && /find a property/i.test(faq.question))
  ));
  if (faqs.length) {
    const faqUse = setting.role === 'lawyer'
      ? 'Use one only when the client asked that question. A custom answer may supply one closing fact, rewritten in the selected voice and length. The follow-up stays on the agreement, the title, the parties, the jurisdiction, or the closing timeline. A refinance answer stays on the legal documents for that closing.'
      : 'Use one only when the client asked that question. Keep every fact, number, area, and condition from the saved answer, and rewrite the wording in the selected voice and length. Do not add, drop, or soften a fact, and do not paste the saved answer as the whole reply. Do not use an FAQ to replace a property-card reply or a seller property question';
    lines.push(`Approved answers. ${faqUse}: ${JSON.stringify(faqs.map(({ question, answer }) => ({ question, answer })))}`);
  }
  if (setting.services_pricing) lines.push(`Approved service notes: ${setting.services_pricing}`);
  if (setting.custom_guidance) lines.push(`Professional instructions: ${setting.custom_guidance}. Follow them for emphasis only, inside the selected voice, formality, and short reply length. Do not let them make the reply longer, and do not break safety, consent, or role limits.`);
  lines.push(`CUSTOMIZATION PRIORITY — assistant style: The selected voice, communication style, formality, and language preferences above override conflicting general persona or style instructions elsewhere in this prompt. Keep role-specific safety and accuracy requirements.`);
  if (setting.role === 'agent') {
    lines.push(options.preview
      ? 'This preview has no intake form. Do not claim a form already collected intent, location, budget, timeline, property type, or mortgage status. Learn those from the chat. For a buyer, property matches appear only as chat cards. When they ask to see options, reply with one short sentence that points at the cards. Do not list homes, prices, or features. An FAQ cannot replace that reply. For a seller, do not offer property match cards. Ask about the property they are selling, not about a home they want to buy.'
      : 'Buyer and seller handling stays in force. The intake form already collects intent, location, budget, timeline, property type, and mortgage status, so do not treat those as customization questions. For a buyer, property matches appear only as chat cards. When they ask to see options, reply with one short sentence that points at the cards. Do not list homes, prices, or features. An FAQ cannot replace that reply. For a seller, do not offer property match cards. Ask about the property they are selling, not about a home they want to buy.');
  }
  if (setting.role === 'lawyer') {
    const intakeIds = new Set(['legal_service', ...LAWYER_INTAKE_TOPICS]);
    const askIds = (setting.qualification_questions || [])
      .filter((id) => options.preview || !intakeIds.has(id));
    lines.push(appliedQualificationBlock({ ...setting, qualification_questions: askIds }));
    const tiers = [
      setting.hot_guidance ? `Ready to act: ${setting.hot_guidance}` : '',
      setting.warm_guidance ? `Interested: ${setting.warm_guidance}` : '',
      setting.cold_guidance ? `Early: ${setting.cold_guidance}` : '',
    ].filter(Boolean);
    if (tiers.length) {
      lines.push(`How I read visitors, for reply emphasis only. A ready visitor hears about the consultation sooner, and an early visitor gets the closing explained first. ${tiers.join(' ')}`);
    }
  }
  if (options.preview && setting.role === 'lawyer') {
    lines.push('This preview has no intake form. Do not claim those answers were already collected. Continue the closing from what the visitor just said.');
  }
  if (options.preview && setting.role === 'mortgage_broker') {
    lines.push('This preview has no intake form. Do not claim those answers were already collected. Continue the mortgage from what the visitor just said.');
  }
  lines.push(replyConductBlock(setting, { preview: options.preview === true }));
  return `${prompt}\n\n${lines.join('\n')}`;
}

export function buildPreviewChatPrompt(flowRole, professionalProfile, options = {}) {
  const name = clip(professionalProfile?.full_name, 120) || 'this professional';
  const roleLine = flowRole === 'lawyer'
    ? `You are ${name}, a real estate lawyer. Speak in the first person.`
    : flowRole === 'mortgage_broker'
      ? `You are ${name}, a mortgage broker. Speak in the first person.`
      : `You are ${name}, a real estate agent. Speak in the first person.`;
  const setting = options.assistantSetting;
  const base = `${roleLine}
Answer only the visitor's latest message in the selected communication style, then stop.
Do not write a scoring block, JSON, or a label for the greeting.`;
  return `${appendAssistantOverlay(base, setting, { preview: true })}\n\n${profileVisitorFactsBlock(professionalProfile, setting, options.yearsExperience)}`;
}

const LAWYER_REPLY_DRIFT = /\b(buy or sell|buying or selling|looking to buy|looking to sell|selling a property|buying a property|property type|features or amenities|attract buyers)\b/i;
const LAWYER_FINANCING_TERMS = /\b(income verification|credit information|credit score|current mortgage|interest rate|loan application)\b/i;
const LAWYER_FINANCING_HANDOFF = /\b(lender|broker|bank)\b|\b(I do not|I don't|I don’t|not something I)\b/i;
const LAWYER_FINANCING_ASK = /\?|\b(share|provide|send|tell me|what is|what's|what’s|need)\b/i;

export function lawyerReplyDrifted(reply) {
  const text = String(reply || '');
  if (LAWYER_REPLY_DRIFT.test(text)) return true;
  return text.split(/(?<=[.!?])\s+/).some((sentence) => (
    LAWYER_FINANCING_TERMS.test(sentence)
    && !LAWYER_FINANCING_HANDOFF.test(sentence)
    && LAWYER_FINANCING_ASK.test(sentence)
  ));
}

const AREA_ASK = /\b(area|areas|jurisdiction|where do you|where are you|seing|seeing|serve)\b/i;
const NAMED_MATTER = /\b(refinanc|title transfer|purchase|sale|selling|buying)\b/i;
const PARTY_ASK = /\bparties\b/i;
const CLOSING_TYPE_ASK = /purchase closing/i;

function lawyerAreaReply(setting) {
  const places = (setting?.jurisdictions || []).map((place) => String(place || '').trim()).filter(Boolean);
  return places.length
    ? `I am licensed in ${places.join(', ')}.`
    : 'Share the jurisdiction and I can confirm whether I am licensed to assist there.';
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
  if (AREA_ASK.test(userMessage)) return lawyerAreaReply(setting);
  if (NAMED_MATTER.test(userMessage)) {
    return sentencesWithoutDrift(text) || 'I can help with that matter.';
  }
  const greeting = text.match(/^(hello|hi|hey|good morning|good afternoon|good evening)\b/i);
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

export function finishLawyerReply(reply, { userMessage = '', previousReply = '', setting = null } = {}) {
  const guarded = guardLawyerReply(reply, setting, userMessage);
  const repeated = (PARTY_ASK.test(previousReply) && PARTY_ASK.test(guarded) && /\?/.test(guarded))
    || (CLOSING_TYPE_ASK.test(previousReply) && CLOSING_TYPE_ASK.test(guarded) && /\?/.test(guarded));
  const kept = repeated
    ? (sentencesWithoutDrift(guarded) || 'I have noted that. We can continue with the documents for this matter.')
    : guarded;
  return String(kept)
    .replace(/!+/g, '.')
    .replace(/\s+as well\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
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

export function assistantAllowsLeadSaving() {
  return true;
}

export function appliedSettingForRole(setting, role) {
  if (!setting?.applied) return null;
  if (setting.role && role && setting.role !== role) return null;
  return setting;
}

export async function loadAppliedAssistantSetting(userId) {
  if (!userId) return null;
  const doc = await ProfessionalAssistantSetting.findOne({ user_id: userId, applied: true }).lean();
  if (!doc) return null;
  const [profile, user] = await Promise.all([
    ProfessionalProfile.findOne({ user_id: userId }).select('full_name company_name professional_type').lean(),
    User.findById(userId).select('role').lean(),
  ]);
  const role = roleForUser(user, profile);
  if (!role || !appliedSettingForRole(doc, role)) return null;
  const sanitized = sanitizeAssistant({ ...doc, applied: true }, role);
  return { ...sanitized, introduction_line: introductionLine(sanitized, profile) };
}

export async function assistantAllowsLeadEmail() {
  return true;
}

export function draftFaqs(setting, profile) {
  const role = setting?.role;
  const name = clip(profile?.full_name, 120) || 'This professional';
  const customFaqCount = (setting?.faqs || []).filter((faq) => faq?.is_default !== true).length;
  const availableSlots = Math.max(0, 8 - customFaqCount);
  if (!availableSlots) return [];
  const services = (setting?.services || [])
    .map((id) => labelOf(SERVICES[role] || [], id) || id);
  const expertise = freeList(setting?.custom_expertise, 12, 100);
  const fallbackServices = services.length || expertise.length
    ? []
    : idsOf(SERVICES[role] || []).slice(0, 3).map((id) => labelOf(SERVICES[role] || [], id) || id);
  const area = (role === 'lawyer' ? setting?.jurisdictions?.[0] : '')
    || setting?.cities?.[0] || setting?.region || profile?.location || '';
  const helper = role === 'lawyer' ? 'I help clients' : `${name} helps clients`;
  return [...services, ...expertise, ...fallbackServices].slice(0, Math.min(5, availableSlots)).map((label) => {
    return {
      question: `Can you help with ${label.toLowerCase()}?`,
      answer: `${helper} with ${label.toLowerCase()}${area ? ` in ${area}` : ''}.${setting?.unique_note ? ` ${setting.unique_note}` : ''}`,
      id: `${role}-suggested-${randomUUID()}`,
      approved: false,
      source: 'generated',
    };
  });
}

export async function readAssistantForUser(user) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id }).lean();
  const role = roleForUser(user, profile);
  if (!role) return null;
  const saved = await ProfessionalAssistantSetting.findOne({ user_id: user._id }).lean();
  const draft = saved ? sanitizeAssistant(saved, role) : prefillAssistant(role, profile);
  draft.display_name = draft.display_name || clip(profile?.full_name, 80);
  draft.applied = Boolean(saved?.applied);
  return {
    saved: Boolean(saved),
    applied: Boolean(saved?.applied),
    role,
    draft,
    catalog: assistantCatalog(role),
    voice_note: 'Selected languages apply to every written reply. This chat does not speak aloud.',
  };
}

export async function saveAssistantForUser(user, body) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id }).lean();
  const role = roleForUser(user, profile);
  if (!role) return null;
  const next = sanitizeAssistant({ ...body, role }, role);
  const doc = await ProfessionalAssistantSetting.findOneAndUpdate(
    { user_id: user._id },
    {
      $set: { ...next, user_id: user._id, role },
      $unset: {
        introduction_mode: '',
        introduction_custom: '',
        professional_title: '',
          website_import_url: '',
          faq_upload_note: '',
          voice_accent: '',
          transfer_calls: '',
        },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, strict: false },
  ).lean();
  return sanitizeAssistant(doc, role);
}



