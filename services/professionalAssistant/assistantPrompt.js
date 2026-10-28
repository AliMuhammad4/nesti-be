import { locationOverlaps } from '../agent/propertyMatch/locationUtils.js';
import { profileVisitorFactsBlock } from '../chat/utils/profileVisitorFacts.js';
import {
  COMMUNICATION_STYLES,
  DIFFERENTIATORS,
  ROLE_DIFFERENTIATORS,
  DOCUMENT_REQUESTS,
  LANGUAGES,
  NEXT_ACTIONS,
  PERSONALITIES,
  QUALIFICATION,
  SERVICES,
  labelOf,
} from './catalog.js';
import { documentRequestIds } from '../chat/documents/chatDocumentService.js';
import { clip } from './assistantText.js';
import { replyLanguage } from './replyStyle.js';
import {
  LAWYER_INTAKE_TOPICS,
  brokerHelloQuestion,
  brokerPurposeEnabled,
  brokerQuestionTopics,
  brokerRefusalInstruction,
  lawyerClosingQuestionEnabled,
  lawyerHelloQuestion,
  lawyerQuestionTopics,
  roleWorkLine,
} from './assistantQuestions.js';
import { isClosingRefusal, isGreetingOnly, isSocialCheck, isVagueYes } from './visitorMessage.js';

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

function firstGreetingLine(setting, opener) {
  const greetings = (setting?.personalities || []).map((id) => {
    const custom = (setting?.custom_tones || []).find((tone) => tone.id === id);
    if (custom?.name) return `Open in the ${custom.name} voice. ${custom.guidance || ''}`.trim();
    return TONE_GREETING[id] || '';
  }).filter(Boolean);
  const greeting = greetings[0] || 'Open with a short hello in the selected voice. Write a fresh sentence.';
  const second = greetings[1] ? ` The question must use the second voice. ${greetings[1]}` : '';
  const question = setting?.role === 'lawyer'
    ? lawyerHelloQuestion(setting)
    : setting?.role === 'mortgage_broker'
      ? brokerHelloQuestion(setting)
      : `Then ask one short question about ${opener}.`;
  const askNow = question === 'Greet in the selected voice. Do not add a question.'
    ? 'Do not add a follow-up question.'
    : 'The visitor is already here, so ask that question directly.';
  return `When the visitor's latest message is only a greeting (hello, hi, hey, hi there, good morning, salam), the reply must start with a greeting in the selected voice, warm and glad they are here, before any fact or question. ${greeting}${second} ${question} ${askNow} Do not say they can answer later. Do not skip the greeting. Do not open with the question. Do not repeat the welcome line. Do not list three options. Do not describe or label the greeting. The opening words must sound like the selected voice. Do not open with "I understand" or "Could you clarify". When emojis are on, end a greeting with a wave.`;
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
  lines.push(setting.use_emojis
    ? 'Choose one emoji that matches this reply and the visitor\'s mood, and put it at the very end. Use a wave for a greeting, a smile for a social check-in, a decline, or reassurance, a heart for worry, folded hands when the visitor says thank you, a calendar for a booking offer, a house for a home, a handshake for mortgage, renewal, pre-approval, or closing help, a page when a document arrives, a check mark for a clear next step, and sparkles for good news. Skip the emoji on a plain intake question. Do not repeat the emoji from the previous reply. Do not put an emoji between sentences.'
    : 'No emojis.');
  lines.push(setting.role === 'lawyer'
    ? 'Keep the reply short and polished. Sound like a lawyer speaking with a client. The selected voice and communication style stay easy to hear.'
    : REPLY_BREVITY);
  if (setting.role !== 'lawyer') {
    lines.push('The confirmation recap may use short labeled lines. Every other reply stays one or two short sentences.');
  }
  lines.push('Ignore the tone of earlier assistant replies. Answer the latest visitor message directly.');
  const language = replyLanguage(setting, latestMessage, options.conversationText || '');
  const languageName = labelOf(LANGUAGES, language);
  if (language && language !== 'english' && languageName) {
    lines.push(`The visitor wrote in ${languageName}. Every sentence of this reply is ${languageName}.`);
  } else if (setting.auto_detect_language !== false && (setting.languages || []).length > 1) {
    lines.push('Reply in the same language the visitor just used when it is one of the selected chat languages.');
  }
  lines.push(`Never copy wording from these instructions. Write a fresh sentence. Never write: ${BANNED_STOCK_PHRASES.map((phrase) => `"${phrase}"`).join(', ')}.`);
  const opener = setting.role === 'lawyer'
    ? (lawyerClosingQuestionEnabled(setting) ? ROLE_GREETING_OPENER.lawyer : (lawyerQuestionTopics(setting, { preview: true })[0] || 'the closing'))
    : setting.role === 'mortgage_broker'
      ? (brokerPurposeEnabled(setting) ? ROLE_GREETING_OPENER.mortgage_broker : (brokerQuestionTopics(setting, { preview: true })[0] || 'the mortgage'))
      : (ROLE_GREETING_OPENER[setting.role] || ROLE_GREETING_OPENER.agent);
  if (greeting) {
    lines.push(firstGreetingLine(setting, opener));
  } else if (isSocialCheck(latestMessage)) {
    lines.push(`The visitor asked how you are. Answer that in the selected voice in one short clause. Do not open with another hello. Do not ask again about ${opener}.`);
  } else if (setting.role === 'lawyer' && isVagueYes(latestMessage)) {
    lines.push(options.preview && lawyerClosingQuestionEnabled(setting)
      ? 'The visitor said yes without naming the closing. Ask whether this is a purchase closing or a sale closing.'
      : options.preview
        ? `The visitor said yes. ${lawyerHelloQuestion(setting)}`
        : 'The visitor said yes. Continue the matter they already named. Do not ask the closing type again.');
  } else if (setting.role === 'lawyer' && isClosingRefusal(latestMessage)) {
    lines.push('The visitor said this is not a purchase closing or a sale closing. Do not ask that question again. Ask, in the selected voice and communication style, whether it is a refinance closing, a title transfer, or a document review.');
  } else if (setting.role === 'mortgage_broker' && isClosingRefusal(latestMessage)) {
    lines.push(`The visitor said this is not a new mortgage or a refinance. Do not ask that question again. ${brokerRefusalInstruction(setting)}`);
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
  const opener = setting?.role === 'lawyer'
    ? (lawyerClosingQuestionEnabled(setting) ? ROLE_GREETING_OPENER.lawyer : (lawyerQuestionTopics(setting, { preview: true })[0] || 'the closing'))
    : setting?.role === 'mortgage_broker'
      ? (brokerPurposeEnabled(setting) ? ROLE_GREETING_OPENER.mortgage_broker : (brokerQuestionTopics(setting, { preview: true })[0] || 'the mortgage'))
      : (ROLE_GREETING_OPENER[setting?.role] || ROLE_GREETING_OPENER.agent);
  const lines = [
    'REPLY CONDUCT (this overrides every earlier persona, warmth, concise-professional line, exact booking script, and character-for-character line):',
    'Read the latest message before choosing a question. Incomplete, casual, and mistyped wording still has a meaning.',
    ...intentConductLines(setting?.role),
    roleWorkLine(setting?.role, setting, options),
    'A short "yes" or "yeah" answers the previous question. Continue from that answer.',
    setting?.role === 'lawyer'
      ? (options.preview && lawyerClosingQuestionEnabled(setting)
        ? 'When a lawyer visitor says yes without naming the closing, ask whether this is a purchase closing or a sale closing. When the visitor says no, do not ask that question again. Ask, in the selected voice, communication style, and written language, whether it is a refinance closing, a title transfer, or a document review.'
        : options.preview
          ? `When a lawyer visitor says yes, ${lawyerHelloQuestion(setting)} When the visitor says no, do not repeat the last question.`
          : 'When a lawyer visitor says yes, continue the matter already named. Do not ask the closing type again. When the visitor says no, do not repeat the last question. Ask what is still missing, in the selected voice, communication style, and written language.')
      : setting?.role === 'mortgage_broker'
        ? `When a broker visitor says yes, continue that mortgage. When the visitor says no, nope, or neither, do not ask the new-mortgage-or-refinance question again. ${brokerRefusalInstruction(setting)}`
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
  lines.push(setting?.role === 'lawyer'
    ? 'Keep the reply short and polished. Sound like a lawyer speaking with a client. The selected voice and communication style stay easy to hear.'
    : REPLY_BREVITY);
  if (setting?.role !== 'lawyer') {
    lines.push('The confirmation recap may use short labeled lines. Every other reply stays one or two short sentences.');
  }
  lines.push(`Banned in every tone: ${BANNED_STOCK_PHRASES.map((phrase) => `"${phrase}"`).join(', ')}.`);
  lines.push('Never copy wording from these instructions. Write a fresh sentence each time.');
  if (setting?.role === 'lawyer') {
    lines.push('Lawyer replies stay polished and professional. The selected voice, communication style, formality, and saved customizations stay audible inside that register. A friendly voice may use one light exclamation. Every other voice uses none. Do not add slang, and do not say "as well."');
    lines.push(lawyerClosingQuestionEnabled(setting)
      ? 'The greeting words can be fresh. The question keeps the words purchase closing and sale closing, and may mention a refinance closing.'
      : 'The greeting words can be fresh. Ask only a checked follow-up, and do not add a purchase-or-sale question when that follow-up is unchecked.');
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
    lines.push(setting.auto_detect_language
      ? `Written chat languages: ${names.join(', ')}. The latest visitor message decides the language. Answer the entire reply in that language when it is one of these. If it is not, use ${names[0]}.`
      : `Written chat languages: ${names.join(', ')}. Answer every written reply in ${names[0]}.`);
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
  const requestedDocs = documentRequestIds(setting)
    .map((id) => labelOf(DOCUMENT_REQUESTS[setting.role] || [], id))
    .filter(Boolean);
  if (requestedDocs.length) {
    lines.push(`Documents this ${setting.role === 'mortgage_broker' ? 'mortgage broker' : setting.role} collects, in order: ${requestedDocs.join(', ')}. Do not ask for a document yourself. One short upload line is added after the reply, in the visitor's language, for the next missing file. It is skipped on a greeting and on the first closing or mortgage question. When a file arrives, confirm it. Do not claim approval or give a legal or financial ruling.`);
  }
  lines.push(`CUSTOMIZATION PRIORITY — assistant style: The selected voice, communication style, formality, and language preferences above override conflicting general persona or style instructions elsewhere in this prompt. Keep role-specific safety and accuracy requirements.`);
  if (setting.role === 'agent') {
    lines.push(options.preview
      ? 'This preview has no intake form. Do not claim a form already collected intent, location, budget, timeline, property type, or mortgage status. Learn those from the chat. For a buyer, property matches appear only as chat cards. When they ask to see options, reply with one short sentence that points at the cards. Do not list homes, prices, or features. An FAQ cannot replace that reply. For a seller, do not offer property match cards. Ask about the property they are selling, not about a home they want to buy.'
      : 'Buyer and seller handling stays in force. The intake form already collects intent, location, budget, timeline, property type, and mortgage status, so do not treat those as customization questions. For a buyer, property matches appear only as chat cards. When they ask to see options, reply with one short sentence that points at the cards. Do not list homes, prices, or features. An FAQ cannot replace that reply. For a seller, do not offer property match cards. Ask about the property they are selling, not about a home they want to buy.');
  }
  if (setting.role === 'lawyer' || setting.role === 'mortgage_broker') {
    const askIds = setting.role === 'lawyer'
      ? (setting.qualification_questions || []).filter((id) => options.preview || !new Set(['legal_service', ...LAWYER_INTAKE_TOPICS]).has(id))
      : (setting.qualification_questions || []).filter((id) => options.preview || id !== 'purpose');
    lines.push(appliedQualificationBlock({ ...setting, qualification_questions: askIds }));
    const tiers = [
      setting.hot_guidance ? `Ready to act: ${setting.hot_guidance}` : '',
      setting.warm_guidance ? `Interested: ${setting.warm_guidance}` : '',
      setting.cold_guidance ? `Early: ${setting.cold_guidance}` : '',
    ].filter(Boolean);
    if (tiers.length) {
      const emphasis = setting.role === 'lawyer'
        ? 'A ready visitor hears about the consultation sooner, and an early visitor gets the closing explained first.'
        : 'A ready visitor hears about the consultation sooner, and an early visitor gets the mortgage explained first.';
      lines.push(`How I read visitors, for reply emphasis only. ${emphasis} ${tiers.join(' ')}`);
    }
    if (setting.next_actions?.length) {
      const steps = setting.next_actions.map((id) => labelOf(NEXT_ACTIONS, id)).filter(Boolean);
      if (steps.length) {
        const savesLead = setting.next_actions.includes('save_lead');
        const notifies = setting.next_actions.includes('notify');
        lines.push(`Preferred next steps from the studio: ${steps.join(', ')}. Mention one when a next step fits the selected style. ${savesLead ? 'A qualified conversation can be saved as a lead.' : 'Do not tell the visitor a CRM lead was created.'} ${notifies ? 'The professional can receive a lead notification.' : 'Do not promise an instant notification.'} A booking link can still be shared when the visitor asks.`);
      }
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
