import { isGreetingOnly } from './visitorMessage.js';

const QUESTION_CUES = {
  intent: /\b(buying or selling|buy or sell|looking to buy|looking to sell|exploring)\b/i,
  location: /\b(where|location|city|area|jurisdiction|located|neighbou?rhood|markets?)\b/i,
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
  down_payment: /\b(down ?payment)\b/i,
  household_income: /\b(household income|annual income|income)\b/i,
  mortgage_balance: /\b(currently have a mortgage|existing mortgage|mortgage on the property)\b/i,
  term_end: /\b(term end|term ends|renewal date|maturity)\b/i,
  owns_investments: /\b(other investment|own other|portfolio)\b/i,
  via_company: /\b(personally|through a company|corporation|holding company)\b/i,
};

const SHARED_FORM_VALUE = {
  expected_price: (form) => form.price || form.expected_price,
  buying_another: (form) => (form.living_situation === 'own_need_to_sell' ? 'yes' : ''),
  investment_type: (form) => form.investment_type,
  investment_goal: (form) => form.investment_goal,
  down_payment: (form) => form.down_payment_readiness || form.down_payment,
  household_income: (form) => form.household_income,
  mortgage_balance: (form) => form.mortgage_status || form.mortgage_balance,
  term_end: (form) => form.term_end,
  owns_investments: (form) => form.owns_investments,
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
  return Boolean(value) && !isGreetingOnly(value);
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

function askedIds(text, allowed, overrides = {}) {
  const source = String(text || '');
  if (!source.includes('?') && !source.includes('？')) return [];
  return [...allowed].filter((id) => QUESTION_CUES[id]?.test(source) || labelAsked(source, overrides?.[id]?.label));
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

export function intakeHasHelloAnswer(setting, form) {
  if (!form || typeof form !== 'object') return false;
  if (setting?.role === 'lawyer') return filled(form.legal_services_needed) || filled(form.transaction_type);
  if (setting?.role === 'mortgage_broker') return filled(form.purchase_purpose) || filled(form.purpose);
  if (setting?.role === 'agent') return filled(form.intent);
  return false;
}
