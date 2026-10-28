import { GREETING_START, isGreetingOnly } from './visitorMessage.js';

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
  hindi: { default: 'नमस्ते, आपका स्वागत है' },
  punjabi: { default: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ' },
  tamil: { default: 'வணக்கம்' },
};

const STRONG_LANGUAGE = [
  ['arabic', (text) => /\p{Script=Arabic}/u.test(text) || /\b(marhaba|assalamu|as-salamu|assalam|asslam|salam|salaam)\b/i.test(text)],
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
  if (id === 'arabic') return /\p{Script=Arabic}/u.test(text) || /\b(marhaba|assalamu|as-salamu)\b/i.test(text);
  if (id === 'french') return /[àâäçéèêëîïôùûüœ]/i.test(text) || /\b(bonjour|bonsoir)\b/i.test(text);
  if (id === 'spanish') return /[áéíóúñü¿¡]/i.test(text) || /\b(hola|holas|holi|ola|olas)\b/i.test(text);
  if (id === 'hindi') return /\p{Script=Devanagari}/u.test(text) || /\b(namaste|namaskar)\b/i.test(text);
  if (id === 'punjabi') return /\p{Script=Gurmukhi}/u.test(text);
  if (id === 'tamil') return /\p{Script=Tamil}/u.test(text);
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

export function withWarmGreeting(reply, setting, userMessage = '') {
  const text = String(reply || '').trim();
  if (!text || !isGreetingOnly(userMessage)) return text;
  if (GREETING_START.test(text)) return text;
  const language = replyLanguage(setting, userMessage);
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
