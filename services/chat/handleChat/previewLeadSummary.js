import { getAgentActionFlow } from '../config/agentActionFlow.js';
import { getMortgageBrokerActionFlow } from '../config/mortgageBrokerActionFlow.js';
import { getLawyerActionFlow } from '../config/lawyerActionFlow.js';
import { questionLabel } from '../../professionalAssistant/assistantSettings.js';
import { chatAnswersByQuestion, intakeValueFor } from '../../professionalAssistant/qualificationProgress.js';

const DETAIL_KEYS = {
  location: ['property_address', 'location', 'buy_property_location', 'address'],
  budget: ['budget', 'price', 'property_budget'],
  expected_price: ['budget', 'price'],
  property_value: ['property_value', 'budget', 'price'],
  timeline: ['timeline', 'mortgage_timeline', 'closing_timeline'],
  closing_date: ['closing_timeline', 'timeline'],
  property_type: ['property_type'],
  preapproval: ['mortgage_status', 'pre_approval_status'],
  purpose: ['purchase_purpose', 'purpose'],
  legal_service: ['legal_services_needed'],
  transaction_type: ['transaction_stage', 'transaction_type'],
  amount: ['financing_amount', 'loan_amount'],
  down_payment: ['down_payment_readiness'],
  household_income: ['household_income'],
};

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function fromDetails(details, id) {
  const keys = DETAIL_KEYS[id] || [id];
  for (const key of keys) {
    const value = text(details?.[key]);
    if (value) return value;
  }
  return '';
}

export function suggestedNextAction(role, leadGrade, intent, ctaLabel, questionsRemaining) {
  if (questionsRemaining > 0) {
    return {
      action: 'continue_qualification',
      label: `Finish the ${questionsRemaining} remaining qualification question${questionsRemaining === 1 ? '' : 's'}`,
      cta_label: ctaLabel,
    };
  }
  const flow = role === 'mortgage_broker'
    ? getMortgageBrokerActionFlow(leadGrade)
    : role === 'lawyer'
      ? getLawyerActionFlow(leadGrade)
      : getAgentActionFlow(leadGrade, intent);
  return {
    action: 'book_consultation',
    label: ctaLabel || flow?.goal || 'Book a consultation',
    cta_label: ctaLabel,
    goal: flow?.goal || '',
    tier: flow?.tier || '',
  };
}

/** Additive lead extras written next to the normal pipeline fields (never changes upsert keys or scoring). */
export function leadClientTypeExtras({ role, setting, clientType, form, history, userMessage, leadGrade, intent }) {
  if (!setting?.applied || !clientType) return null;
  const questionIds = setting.qualification_questions || [];
  const chatAnswers = chatAnswersByQuestion(setting, history, userMessage);
  const remaining = questionIds.filter((id) => !text(intakeValueFor(role, id, form)) && !text(chatAnswers[id]));
  const templateAnswers = Object.fromEntries(
    Object.entries(chatAnswers).filter(([id, value]) => questionIds.includes(id) && text(value)),
  );
  return {
    client_type: clientType,
    suggested_next_action: suggestedNextAction(role, String(leadGrade || 'unscored'), intent, setting.cta_label || '', remaining.length),
    template_answers: templateAnswers,
  };
}

/**
 * In-memory CRM lead preview for Test My AI. Reads the same signals the live pipeline would store,
 * without touching LeadProfile, LeadMatch, notifications, or email.
 */
export function buildPreviewLeadSummary({
  role,
  setting,
  clientType,
  form,
  history,
  userMessage,
  details,
  contactInfo,
  leadGrade,
  leadScore,
  intent,
}) {
  const questionIds = setting?.qualification_questions || [];
  const chatAnswers = chatAnswersByQuestion(setting, history, userMessage);
  const collected = questionIds.map((id) => {
    const answer = text(intakeValueFor(role, id, form)) || fromDetails(details, id) || text(chatAnswers[id]);
    return { id, label: questionLabel(setting, id), answer };
  });
  const answered = collected.filter((item) => item.answer);
  const remaining = collected.filter((item) => !item.answer);
  const find = (...ids) => collected.find((item) => ids.includes(item.id) && item.answer)?.answer || '';
  const location = find('location') || fromDetails(details, 'location');
  const budget = find('budget', 'expected_price', 'property_value', 'amount') || fromDetails(details, 'budget');
  const service = find('legal_service', 'purpose', 'investment_type');
  const timeline = find('timeline', 'closing_date', 'term_end') || fromDetails(details, 'timeline');
  const grade = String(leadGrade || 'unscored');
  const ctaLabel = setting?.cta_label || '';
  return {
    client_type: clientType || '',
    role,
    lead_grade: grade,
    lead_score: Number.isFinite(Number(leadScore)) ? Number(leadScore) : 0,
    contact: {
      name: text(contactInfo?.name || contactInfo?.full_name || form?.name),
      email: text(contactInfo?.email || form?.email),
      phone: text(contactInfo?.phone || form?.phone),
    },
    location,
    budget,
    service_requirement: service,
    timeline,
    collected: answered,
    remaining: remaining.map(({ id, label }) => ({ id, label })),
    suggested_next_action: suggestedNextAction(role, grade, intent, ctaLabel, remaining.length),
    test_mode: true,
  };
}
