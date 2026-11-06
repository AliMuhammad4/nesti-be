import { questionLabel } from './assistantSettings.js';
import { readQualificationAlias } from './qualificationFieldAliases.js';
import { isGreetingOnly } from './visitorMessage.js';
import { userSignalsBookingIntent } from '../chat/utils/chatBookingReply.js';

const QUESTION_CUES = {
  intent: /\b(buying or selling|buy or sell|looking to buy|looking to sell|exploring)\b/i,
  location: /\b(where|location|city|areas?|jurisdiction|located|neighbou?rhoods?|markets?)\b/i,
  budget: /\b(budget|price range)\b/i,
  timeline: /\b(timeline|how soon|when are you|when do you|when would you|closing date)\b/i,
  property_type: /\b(property type|type of property|kind of home|kind of property|residential or commercial)\b/i,
  preapproval: /\b(pre-?approv)/i,
  purpose: /\b(new mortgage|refinance|refinancing|renewal|renewing|purchasing|first home|next home|selling and buying)\b/i,
  property_value: /\b(property value|home worth|purchase price|approximate value|price range)\b/i,
  amount: /\b(financing amount|loan amount|how much)\b/i,
  legal_service: /\b(purchase closing|sale closing|refinance closing|legal service|legal assistance|purchasing, selling, or refinancing)\b/i,
  transaction_type: /\b(agreement|been signed|signed)\b/i,
  transaction_value: /\b(title|document question)\b/i,
  closing_date: /\b(closing timeline|closing date|transaction date)\b/i,
  urgency: /\b(parties)\b/i,
  expected_price: /\b(estimated price|asking price|expected price|price range)\b/i,
  buying_another: /\b(also buying|buying another|another property)\b/i,
  investment_type: /\b(type of investment|investment property|rental|flip|pre-construction|multi-unit)\b/i,
  investment_goal: /\b(rental income|appreciation|cash ?flow)\b/i,
  realtor_status: /\b(working with (a )?(realtor|agent)|have (a )?(realtor|agent)|no (realtor|agent))\b/i,
  owns_investments: /\b(other investment|own other|already own|portfolio)\b/i,
  preferred_contact_method: /\b(preferred contact|contact method|best time to (contact|reach)|how (should|can) (we|i) (reach|contact)|follow-?ups?)\b/i,
  down_payment: /\b(down ?payment|proof of funds|capital ready|funds ready)\b/i,
  viewing_readiness: /\b(tour|viewing|see properties|see options)\b/i,
  urgency_readiness: /\b(make an offer|ready to (buy|offer|close)|right deal)\b/i,
  household_income: /\b(household income|annual income|income)\b/i,
  mortgage_balance: /\b(currently have a mortgage|existing mortgage|mortgage on the property)\b/i,
  term_end: /\b(term end|term ends|renewal date|maturity)\b/i,
  via_company: /\b(personally|through a company|corporation|holding company)\b/i,
};

const SHARED_FORM_VALUE = {
  expected_price: (form) => form.price || form.expected_price,
  buying_another: (form) => (form.living_situation === 'own_need_to_sell' ? 'yes' : ''),
  investment_type: (form) => form.investment_type,
  investment_goal: (form) => form.investment_goal,
  realtor_status: (form) => form.realtor_status,
  owns_investments: (form) => form.owns_investments,
  down_payment: (form) => readQualificationAlias(form, 'down_payment'),
  viewing_readiness: (form) => form.viewing_readiness,
  urgency_readiness: (form) => form.urgency_readiness,
  household_income: (form) => form.household_income,
  mortgage_balance: (form) => form.mortgage_status || form.mortgage_balance,
  term_end: (form) => form.term_end,
  via_company: (form) => form.via_company,
};

const FORM_VALUE = {
  agent: {
    ...SHARED_FORM_VALUE,
    intent: (form) => form.intent,
    location: (form) => (form.intent === 'sell' ? form.address || form.location : form.buy_property_location || form.location || form.address),
    budget: (form) => (form.intent === 'sell' ? form.price || form.budget : form.budget),
    timeline: (form) => form.timeline,
    property_type: (form) => form.property_type,
    preapproval: (form) => form.mortgage_status,
    realtor_status: (form) => form.realtor_status,
    owns_investments: (form) => form.owns_investments,
    down_payment: (form) => readQualificationAlias(form, 'down_payment'),
    viewing_readiness: (form) => form.viewing_readiness,
    urgency_readiness: (form) => form.urgency_readiness,
        preferred_contact_method: (form) => {
      if (form.preferred_contact_method && form.best_time_to_contact) {
        return `${form.preferred_contact_method}|${form.best_time_to_contact}`;
      }
      if (form.preferred_contact_method) return form.preferred_contact_method;
      // Email/phone already collected on intake — do not re-ask preferred contact method.
      if (String(form.email || '').trim() || String(form.phone || '').trim()) return 'contact_on_file';
      return '';
    },
    motivation_reason: (form) => form.motivation_reason,
    living_situation: (form) => form.living_situation,
  },
  mortgage_broker: {
    ...SHARED_FORM_VALUE,
    purpose: (form) => form.purchase_purpose || form.purpose,
    location: (form) => form.address || form.location || form.buy_property_location,
    property_value: (form) => form.property_value || form.price || form.budget || form.property_budget,
    amount: (form) => form.financing_amount || form.loan_amount || form.mortgage_amount,
    timeline: (form) => form.mortgage_timeline || form.timeline,
    preapproval: (form) => form.pre_approval_status,
  },
  lawyer: {
    ...SHARED_FORM_VALUE,
    legal_service: (form) => form.legal_services_needed,
    location: (form) => form.address || form.location,
    transaction_type: (form) => form.transaction_stage || form.transaction_type,
    closing_date: (form) => form.closing_timeline,
    property_type: (form) => form.property_type,
  },
};

function filled(value) {
  return String(value || '').trim().length > 0;
}

export function intakeValueFor(role, id, form) {
  const reader = FORM_VALUE[role]?.[id];
  return reader ? reader(form || {}) : '';
}

function answersQuestion(text) {
  const value = String(text || '').trim();
  if (!value || isGreetingOnly(value)) return false;
  const questionText = value
    .replace(/^(?:yes|yeah|yep|no|okay|ok|sure)[,.! ]+/i, '')
    .replace(/[?？!！.]+$/g, '')
    .trim();
  if (!questionText) return false;
  return !/^(?:(?:why|what|how|when|where|which|who|can you|could you|would you|do you|does it|is it|are you|are there|please explain|please clarify|i have a question|i have questions|not sure what|what do you mean)\b|(?:i(?:'m| am) (?:confused|not sure|unclear|uncertain)|i do not understand|i don't understand|i dont understand|i(?:'m| am) having trouble understanding|can you explain|could you explain|please explain what|what does .* mean))\b/i.test(questionText);
}

const CUE_STOP_WORDS = new Set(['what', 'which', 'when', 'where', 'your', 'you', 'are', 'the', 'this', 'that', 'have', 'with', 'for', 'and', 'about', 'there', 'would', 'like', 'into', 'from', 'type', 'kind']);

function labelCue(label) {
  const words = String(label || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter((word) => word.length > 3 && !CUE_STOP_WORDS.has(word));
  return [...new Set(words)];
}

function labelAsked(text, label) {
  const words = labelCue(label);
  if (!words.length) return false;
  const lower = String(text || '').toLowerCase();
  const hits = words.filter((word) => lower.includes(word)).length;
  return hits >= Math.min(2, words.length);
}

function cuePosition(sentence, id, overrides = {}) {
  const source = String(sentence || '');
  const cueAt = QUESTION_CUES[id] ? source.search(QUESTION_CUES[id]) : -1;
  const lower = source.toLowerCase();
  const labelAt = labelCue(overrides?.[id]?.label).reduce((latest, word) => {
    const at = lower.indexOf(word);
    return at > latest ? at : latest;
  }, -1);
  return Math.max(cueAt, labelAt);
}

function latestAsked(sentence, allowed, overrides = {}) {
  let chosen = '';
  let at = -1;
  for (const id of allowed) {
    if (!QUESTION_CUES[id]?.test(sentence) && !labelAsked(sentence, overrides?.[id]?.label)) continue;
    const position = cuePosition(sentence, id, overrides);
    if (position >= at) {
      chosen = id;
      at = position;
    }
  }
  return chosen ? [chosen] : [];
}

function askedIds(text, allowed, overrides = {}) {
  const source = String(text || '');
  if (!source.includes('?') && !source.includes('？')) return [];
  const sentences = source.split(/(?<=[?？])\s+/).filter((sentence) => /[?？]/.test(sentence));
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const asked = latestAsked(sentences[index], allowed, overrides);
    if (asked.length) return asked;
  }
  return latestAsked(source, allowed, overrides);
}

const MEETING_PUSH = /\b(consultation|strategy call|our meeting|phone call or email|available times|calendly)\b/i;

/** A saved lead does not replace the next open question with a meeting ask. */
export function keepOpenQuestion(reply, setting, form, answeredIds = [], userMessage = '') {
  let text = String(reply || '').trim();
  if (!text || !qualificationStillOpen(setting, form, answeredIds) || userSignalsBookingIntent(userMessage)) return text;
  const sentences = text.split(/(?<=[.!?？])\s+/).filter(Boolean);
  const questionSentences = sentences.filter((sentence) => /[?？]/.test(sentence));
  if (questionSentences.length > 1) {
    const firstQuestion = questionSentences[0];
    const statements = sentences.filter((sentence) => !/[?？]/.test(sentence)).slice(0, 1);
    text = [...statements, firstQuestion].join(' ').replace(/\s+/g, ' ').trim();
  }
  if (!MEETING_PUSH.test(text) || !/[?？]/.test(text)) return text;
  const nextId = openQualificationQuestionIds(setting, form, answeredIds)[0];
  const label = questionLabel(setting, nextId);
  if (!label) return text;
  const kept = text
    .split(/(?<=[.!?？])\s+/)
    .filter((sentence) => sentence && !MEETING_PUSH.test(sentence))
    .join(' ')
    .trim();
  const ask = /[?？]\s*$/.test(label) ? label : `${label.replace(/[.!\s]+$/, '')}?`;
  return `${kept} ${ask}`.replace(/\s+/g, ' ').trim();
}

export function chatAnsweredQuestionIds(setting, history, userMessage) {
  const allowed = new Set(setting?.qualification_questions || []);
  const overrides = setting?.question_overrides || {};
  const closed = new Set();
  const turns = [...(Array.isArray(history) ? history : []), { role: 'user', content: userMessage }];
  let pending = [];
  for (const message of turns) {
    if (message?.role === 'assistant') pending = askedIds(message?.content, allowed, overrides);
    else if (message?.role === 'user' && answersQuestion(message?.content)) {
      pending.forEach((id) => closed.add(id));
      pending = [];
    }
  }
  return [...closed];
}

/** Quick-reply chips for the template question the assistant just asked, if that question has answer options. */
export function quickRepliesForReply(setting, reply, answeredIds = []) {
  const overrides = setting?.question_overrides || {};
  const allowed = new Set((setting?.qualification_questions || []).filter((id) => !answeredIds.includes(id)));
  const asked = askedIds(reply, allowed, overrides);
  for (const id of asked) {
    const options = overrides[id]?.options;
    if (Array.isArray(options) && options.length) return { question_id: id, options: options.slice(0, 8) };
  }
  return null;
}

/** Returns { questionId: visitorAnswerText } for saved questions answered inside the chat. */
export function chatAnswersByQuestion(setting, history, userMessage) {
  const allowed = new Set(setting?.qualification_questions || []);
  const overrides = setting?.question_overrides || {};
  const answers = {};
  const turns = [...(Array.isArray(history) ? history : []), { role: 'user', content: userMessage }];
  let pending = [];
  for (const message of turns) {
    if (message?.role === 'assistant') pending = askedIds(message?.content, allowed, overrides);
    else if (message?.role === 'user' && answersQuestion(message?.content)) {
      const text = String(message.content || '').trim().slice(0, 160);
      pending.forEach((id) => { if (!answers[id]) answers[id] = text; });
      pending = [];
    }
  }
  return answers;
}

const LAWYER_FORM_IDS = new Set(['legal_service', 'transaction_type', 'location', 'closing_date']);

export function openQualificationQuestionIds(setting, form, answeredIds = []) {
  const answered = new Set(answeredIds);
  const hasForm = form && typeof form === 'object';
  return (setting?.qualification_questions || []).filter((id) => {
    if (answered.has(id)) return false;
    if (!hasForm) {
      return !(setting.role === 'lawyer' && LAWYER_FORM_IDS.has(id));
    }
    return !filled(intakeValueFor(setting.role, id, form));
  });
}

export function qualificationStillOpen(setting, form, answeredIds = []) {
  if (!setting?.applied) return false;
  return openQualificationQuestionIds(setting, form, answeredIds).length > 0;
}

const AGENT_INTAKE_ASK_IDS = [
  'location',
  'budget',
  'timeline',
  'property_type',
  'preapproval',
  'realtor_status',
  'motivation_reason',
  'living_situation',
  'viewing_readiness',
  'urgency_readiness',
  'investment_type',
  'investment_goal',
  'owns_investments',
  'down_payment',
  'preferred_contact_method',
  'buying_another',
  'expected_price',
];

/** Drop model questions that re-ask intake/chat answers already on file. */
export function stripAnsweredIntakeAsks(reply, role, form, answeredIds = []) {
  const text = String(reply || '').trim();
  if (!text || !form || typeof form !== 'object') return text;
  const answered = new Set(answeredIds);
  const filledIds = (role === 'agent' ? AGENT_INTAKE_ASK_IDS : Object.keys(FORM_VALUE[role] || {}))
    .filter((id) => answered.has(id) || filled(intakeValueFor(role, id, form)));
  if (!filledIds.length) return text;

  const sentences = text.split(/(?<=[.!?？])\s+/).filter(Boolean);
  const kept = sentences.filter((sentence) => {
    if (!/[?？]/.test(sentence)) return true;
    const asked = latestAsked(sentence, filledIds, {});
    return !asked.length;
  });
  if (!kept.length) {
    const statements = sentences.filter((sentence) => !/[?？]/.test(sentence));
    return statements.join(' ').replace(/\s+/g, ' ').trim() || text;
  }
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

export function intakeHasHelloAnswer(setting, form) {
  if (!form || typeof form !== 'object') return false;
  if (setting?.role === 'lawyer') return filled(form.legal_services_needed) || filled(form.transaction_type);
  if (setting?.role === 'mortgage_broker') return filled(form.purchase_purpose) || filled(form.purpose);
  if (setting?.role === 'agent') return filled(form.intent);
  return false;
}
