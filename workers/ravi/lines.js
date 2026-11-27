import { text } from './text.js';

const QUIET_LINES = {
  en: ['Are you still there? What can I help you with?', 'Is there anything else I can help you with?'],
  ur: ['کیا آپ لائن پر ہیں؟ میں آپ کی کیا مدد کر سکتا ہوں؟', 'کیا میں کسی اور چیز میں آپ کی مدد کر سکتا ہوں؟'],
};

export function quietLine(code, declines) {
  const lines = QUIET_LINES[code];
  return lines ? lines[declines ? 1 : 0] : '';
}

const MISSED_LINES = {
  en: 'Sorry, I missed that. Could you say that once more?',
  ur: 'معاف کیجیے، میں سن نہیں سکا۔ کیا آپ ایک بار پھر کہہ سکتے ہیں؟',
  pa: 'معاف کرنا، میں سن نئیں سکیا۔ تسیں اک وار فیر دس سکدے او؟',
};

export function missedLine(code) {
  return MISSED_LINES[code] || '';
}

const GOODBYE_LINES = {
  en: "I'll let you go. Take care.",
  ur: 'ٹھیک ہے، میں اب کال ختم کرتا ہوں۔ اپنا خیال رکھیں۔',
};

export function goodbyeLine(code) {
  return GOODBYE_LINES[code] || '';
}

const DECLINE_GOODBYE_LINES = {
  en: 'No problem, thanks for your time. Take care.',
  ur: 'کوئی بات نہیں، وقت دینے کا شکریہ۔ اپنا خیال رکھیں۔',
  pa: 'کوئی گل نئیں، ویلا دین دا شکریہ۔ اپنا خیال رکھنا۔',
};

export function declineGoodbyeLine(code) {
  return DECLINE_GOODBYE_LINES[code] || '';
}

const DROP_LINES = {
  en: 'Sorry, the line dropped for a second, could you say that again?',
  ur: 'معاف کیجیے، لائن ایک لمحے کے لیے کٹ گئی تھی، کیا آپ دوبارہ کہہ سکتے ہیں؟',
  pa: 'معاف کرنا، لائن اک پل لئی کٹ گئی سی، تسیں فیر دس سکدے او؟',
};

export function dropLine(code) {
  return DROP_LINES[code] || DROP_LINES.en;
}

export const DROP_LINE_GAP_MS = 8000;

export function englishGreeting(name, recorded = false) {
  const first = text(name).split(/\s+/)[0];
  if (recorded) return `Hi${first ? ` ${first}` : ''}, I'm Ravi, Nesti's AI assistant, and this call is recorded for quality. What are you hoping to get done?`;
  return `Hi${first ? ` ${first}` : ''}, I'm Ravi from Nesti. What are you hoping to get done?`;
}
