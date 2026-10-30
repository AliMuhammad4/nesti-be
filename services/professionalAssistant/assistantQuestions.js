const LAWYER_QUESTION_TOPICS = [
  ['transaction_type', 'the agreement'],
  ['transaction_value', 'the title'],
  ['urgency', 'the parties'],
  ['location', 'the jurisdiction'],
  ['closing_date', 'the closing timeline'],
];

export const LAWYER_INTAKE_TOPICS = new Set(['transaction_type', 'location', 'closing_date']);

export function joinWithOr(items) {
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

export function lawyerClosingQuestionEnabled(setting) {
  return (setting?.qualification_questions || []).includes('legal_service');
}

export function lawyerHelloQuestion(setting) {
  if (lawyerClosingQuestionEnabled(setting)) {
    return 'The one question is whether this is a purchase closing or a sale closing.';
  }
  const topics = lawyerQuestionTopics(setting, { preview: true });
  if (!topics.length) return 'Greet in the selected voice. Do not add a question.';
  return `The one question is about ${topics[0]}.`;
}

export function lawyerWorkLine(setting, options = {}) {
  const topics = joinWithOr(lawyerQuestionTopics(setting, options));
  const repeat = 'Do not repeat a question already asked about the parties, the title, the agreement, the jurisdiction, or the closing timeline.';
  if (options.preview) {
    const hello = lawyerHelloQuestion(setting) === 'Greet in the selected voice. Do not add a question.'
      ? 'On a hello, greet in the selected voice and do not add a question.'
      : `On a hello, ${lawyerHelloQuestion(setting).charAt(0).toLowerCase()}${lawyerHelloQuestion(setting).slice(1)}`;
    const topic = topics
      ? `When the selected style includes one follow-up, that question is about ${topics}.`
      : 'Do not add a follow-up unless the visitor asks for the next step.';
    const refusal = lawyerClosingQuestionEnabled(setting)
      ? 'That purchase-or-sale question is only for a hello. If the visitor says no, or that this is not a purchase or a sale, do not ask it again. Ask, in the selected voice, communication style, and written language, whether it is a refinance closing, a title transfer, or a document review.'
      : 'If the visitor says no, do not repeat the last question.';
    return `${hello} ${refusal} Write one reply in the selected voice and communication style. Keep it polished and professional, with that voice still easy to hear. Do not write a second reply, and do not rewrite the same answer in another tone. ${repeat} ${topic}`;
  }
  const follow = topics
    ? `Ask about ${topics} only when that detail is still missing. If the previous reply already asked it, do not ask it again.`
    : 'Do not add a follow-up question unless the visitor asks for the next step.';
  return `The intake form already has the closing type, the location, the closing date, and the legal service. Do not ask those again, and do not ask whether this is a purchase closing, a sale closing, or a refinance closing. If the visitor says no, do not repeat the last question. Ask what the matter is instead, in the selected voice, communication style, and written language. Answer the visitor's latest point first in the selected voice and communication style. Keep it polished and professional, with that voice still easy to hear. Write one reply. Do not write a second version in another tone. A refinance, a title transfer, a purchase, or a sale is the matter, so continue that matter. A question about areas or jurisdiction gets a direct answer from the licensed jurisdictions, written in the selected voice, communication style, and written language. ${repeat} ${follow}`;
}

const BROKER_QUESTION_TOPICS = [
  ['location', 'the property location'],
  ['property_value', 'the property value'],
  ['amount', 'the financing amount'],
  ['timeline', 'the financing timeline'],
  ['preapproval', 'pre-approval'],
];

export function brokerQuestionTopics(setting, options = {}) {
  const checked = new Set(setting?.qualification_questions || []);
  return BROKER_QUESTION_TOPICS
    .filter(([id]) => checked.has(id) && (options.preview || id !== 'purpose'))
    .map(([, label]) => label);
}

export function brokerPurposeEnabled(setting) {
  const checked = setting?.qualification_questions;
  if (!Array.isArray(checked)) return true;
  return checked.includes('purpose');
}

export function brokerRefusalInstruction(setting) {
  const ids = Array.isArray(setting?.qualification_questions) ? setting.qualification_questions : null;
  if (!ids || (ids.includes('purpose') && ids.includes('preapproval'))) {
    return 'Ask, in the selected voice, communication style, and written language, whether it is a renewal or whether they already have a pre-approval.';
  }
  if (ids.includes('purpose')) {
    return 'Ask, in the selected voice, communication style, and written language, whether it is a renewal. Do not ask about pre-approval.';
  }
  const topic = brokerQuestionTopics(setting, { preview: true })[0];
  if (topic) {
    return `Ask, in the selected voice, communication style, and written language, about ${topic}.`;
  }
  return 'Continue in the selected voice and communication style. Do not add a question.';
}

export function brokerHelloQuestion(setting) {
  if (brokerPurposeEnabled(setting)) {
    return 'The one question is whether this is a new mortgage or a refinance.';
  }
  const topics = brokerQuestionTopics(setting, { preview: true });
  if (!topics.length) return 'Greet in the selected voice. Do not add a question.';
  return `The one question is about ${topics[0]}.`;
}

export function brokerWorkLine(setting, options = {}) {
  const topics = joinWithOr(brokerQuestionTopics(setting, options));
  const hello = brokerHelloQuestion(setting) === 'Greet in the selected voice. Do not add a question.'
    ? 'On a hello, greet in the selected voice and do not add a question.'
    : `On a hello, ${brokerHelloQuestion(setting).charAt(0).toLowerCase()}${brokerHelloQuestion(setting).slice(1)}`;
  const follow = topics
    ? `When the selected style includes one follow-up, that question is about ${topics}.`
    : 'Do not add a follow-up unless the visitor asks for the next step.';
  const nextAsk = brokerRefusalInstruction(setting);
  if (options.preview) {
    const refusal = brokerPurposeEnabled(setting)
      ? `That mortgage-or-refinance question is only for a hello. If the visitor says no, nope, or neither, do not ask it again. ${nextAsk}`
      : 'If the visitor says no, do not repeat the last question.';
    return `${hello} ${refusal} Write one reply in the selected voice and communication style. The opening words must sound like the selected voice. Keep it polished, with that voice still easy to hear. Do not write a second reply. Do not repeat a question already asked about the financing amount, the property location, the property value, the timeline, or pre-approval. ${follow}`;
  }
  const publicFollow = topics
    ? `Ask about ${topics} only when that detail is still missing. If the previous reply already asked it, do not ask it again.`
    : 'Do not add a follow-up unless the visitor asks for the next step.';
  return `Credit score, employment, income, down payment, and preferred contact time are already on the intake form. Do not ask those again. If the visitor says no, do not repeat the last question. ${nextAsk} Continue the mortgage they named, in the selected voice and communication style. A new mortgage, a refinance, or a renewal is the matter. ${publicFollow}`;
}

export function roleWorkLine(role, setting = null, options = {}) {
  if (role === 'lawyer') return lawyerWorkLine(setting, options);
  if (role === 'mortgage_broker') return brokerWorkLine(setting, options);
  return '';
}
