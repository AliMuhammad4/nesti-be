import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

function hasText(value) {
  return String(value ?? '').trim().length > 0;
}

function hasNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeRole(role) {
  const raw = String(role || '')
    .trim()
    .toLowerCase();
  if (raw === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (raw === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  return PROFESSIONAL_TYPE.AGENT;
}

function getLatestAgentNote(leadMatch) {
  const notes = Array.isArray(leadMatch?.compatibility_factors?.agent_notes)
    ? leadMatch.compatibility_factors.agent_notes
    : [];
  if (!notes.length) return '';
  const latest = notes[notes.length - 1];
  return String(latest?.text || '').trim();
}

function buildChecklistItem({ key, label, isComplete }) {
  return { key, label, isComplete: Boolean(isComplete) };
}

function normalizeLawyerChecklistAnswers(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return {
    transaction_type: String(raw.transaction_type || '').trim(),
    property_or_legal_matter: String(raw.property_or_legal_matter || '').trim(),
    closing_date: String(raw.closing_date || '').trim(),
    agreement_and_docs_received: String(raw.agreement_and_docs_received || '').trim(),
    outstanding_legal_requirements: String(raw.outstanding_legal_requirements || '').trim(),
    next_step: String(raw.next_step || '').trim(),
  };
}

function normalizeAgentChecklistAnswers(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return {
    client_ready_to_proceed: String(raw.client_ready_to_proceed || '').trim(),
    property_identified: String(raw.property_identified || '').trim(),
    price_captured: String(raw.price_captured || '').trim(),
    target_closing_date: String(raw.target_closing_date || '').trim(),
    remaining_conditions: String(raw.remaining_conditions || '').trim(),
    next_step: String(raw.next_step || '').trim(),
  };
}

function normalizeMortgageChecklistAnswers(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return {
    client_ready_to_move_forward: String(raw.client_ready_to_move_forward || '').trim(),
    property_value_and_mortgage_need: String(raw.property_value_and_mortgage_need || '').trim(),
    financing_status: String(raw.financing_status || '').trim(),
    income_docs_ready: String(raw.income_docs_ready || '').trim(),
    funding_timeline: String(raw.funding_timeline || '').trim(),
    next_step: String(raw.next_step || '').trim(),
  };
}

function evaluateAgentChecklist({ leadProfile, leadMatch, pendingAgentChecklist = null }) {
  const property = leadProfile?.property || {};
  const qualification = leadProfile?.qualification?.agent || {};
  const inquiredProperty = leadMatch?.compatibility_factors?.inquired_property || {};
  const savedChecklist = normalizeAgentChecklistAnswers(
    leadMatch?.compatibility_factors?.close_summary?.agent_closing_checklist
  );
  const pendingChecklist = normalizeAgentChecklistAnswers(pendingAgentChecklist);
  const checklistAnswers = {
    ...savedChecklist,
    ...Object.fromEntries(
      Object.entries(pendingChecklist).filter(([, value]) => hasText(value))
    ),
  };
  const nextStepText =
    checklistAnswers.next_step || leadMatch?.compatibility_factors?.next_step || getLatestAgentNote(leadMatch);

  return [
    buildChecklistItem({
      key: 'client_ready_to_proceed',
      label: 'Confirm the client is ready to proceed',
      isComplete:
        hasText(checklistAnswers.client_ready_to_proceed) ||
        hasText(qualification.urgency_readiness) ||
        hasText(qualification.viewing_readiness) ||
        hasText(qualification.motivation_reason),
    }),
    buildChecklistItem({
      key: 'property_identified',
      label: 'Identify the property being purchased or sold',
      isComplete:
        hasText(checklistAnswers.property_identified) ||
        hasText(property.address) ||
        hasText(property.location) ||
        hasText(property.property_type) ||
        hasText(inquiredProperty.address) ||
        hasText(inquiredProperty.title),
    }),
    buildChecklistItem({
      key: 'price_captured',
      label: 'Capture the purchase/sale price',
      isComplete:
        hasText(checklistAnswers.price_captured) ||
        hasText(property.budget) ||
        hasText(property.expected_price) ||
        hasNumber(leadProfile?.budget_profile?.min_budget) ||
        hasNumber(leadProfile?.budget_profile?.max_budget),
    }),
    buildChecklistItem({
      key: 'target_closing_date',
      label: 'Confirm the target closing date',
      isComplete:
        hasText(checklistAnswers.target_closing_date) ||
        hasText(property.timeline),
    }),
    buildChecklistItem({
      key: 'remaining_conditions',
      label: 'Identify any conditions remaining (financing, inspection, etc.)',
      isComplete:
        hasText(checklistAnswers.remaining_conditions) ||
        hasText(qualification.mortgage_status),
    }),
    buildChecklistItem({
      key: 'next_step',
      label: 'Confirm the next step (offer, viewing, negotiation, etc.)',
      isComplete: hasText(nextStepText),
    }),
  ];
}

function evaluateMortgageChecklist({ leadProfile, leadMatch, pendingMortgageChecklist = null }) {
  const property = leadProfile?.property || {};
  const qualification = leadProfile?.qualification?.mortgage_broker || {};
  const savedChecklist = normalizeMortgageChecklistAnswers(
    leadMatch?.compatibility_factors?.close_summary?.mortgage_closing_checklist
  );
  const pendingChecklist = normalizeMortgageChecklistAnswers(pendingMortgageChecklist);
  const checklistAnswers = {
    ...savedChecklist,
    ...Object.fromEntries(
      Object.entries(pendingChecklist).filter(([, value]) => hasText(value))
    ),
  };
  const nextStepText =
    checklistAnswers.next_step || leadMatch?.compatibility_factors?.next_step || getLatestAgentNote(leadMatch);

  return [
    buildChecklistItem({
      key: 'client_ready_to_move_forward',
      label: 'Confirm the client is ready to move forward',
      isComplete:
        hasText(checklistAnswers.client_ready_to_move_forward) ||
        hasText(qualification.urgency_signal) ||
        hasText(qualification.pre_approval_status) ||
        hasText(qualification.mortgage_timeline),
    }),
    buildChecklistItem({
      key: 'property_value_and_mortgage_need',
      label: 'Capture the property value and required mortgage amount',
      isComplete:
        hasText(checklistAnswers.property_value_and_mortgage_need) ||
        hasText(property.budget) ||
        hasText(qualification.property_budget),
    }),
    buildChecklistItem({
      key: 'financing_status',
      label: 'Confirm pre-approval or financing status',
      isComplete:
        hasText(checklistAnswers.financing_status) ||
        hasText(qualification.pre_approval_status),
    }),
    buildChecklistItem({
      key: 'income_docs_ready',
      label: 'Verify income and document readiness',
      isComplete:
        hasText(checklistAnswers.income_docs_ready) ||
        hasText(qualification.household_income) && hasText(qualification.employment_status),
    }),
    buildChecklistItem({
      key: 'funding_timeline',
      label: 'Confirm the expected funding timeline',
      isComplete:
        hasText(checklistAnswers.funding_timeline) ||
        hasText(qualification.mortgage_timeline) ||
        hasText(property.timeline),
    }),
    buildChecklistItem({
      key: 'next_step',
      label: 'Confirm the next step (application, document collection, approval, etc.)',
      isComplete: hasText(nextStepText),
    }),
  ];
}

function evaluateLawyerChecklist({
  leadProfile,
  leadMatch,
  pendingLawyerChecklist = null,
}) {
  const property = leadProfile?.property || {};
  const qualification = leadProfile?.qualification?.lawyer || {};
  const savedChecklist = normalizeLawyerChecklistAnswers(
    leadMatch?.compatibility_factors?.close_summary?.lawyer_closing_checklist
  );
  const pendingChecklist = normalizeLawyerChecklistAnswers(pendingLawyerChecklist);
  const checklistAnswers = {
    ...savedChecklist,
    ...Object.fromEntries(
      Object.entries(pendingChecklist).filter(([, value]) => hasText(value))
    ),
  };
  const nextStepText =
    checklistAnswers.next_step || leadMatch?.compatibility_factors?.next_step || getLatestAgentNote(leadMatch);

  return [
    buildChecklistItem({
      key: 'transaction_type',
      label: 'Confirm the transaction type (purchase, sale, refinance, etc.)',
      isComplete: hasText(checklistAnswers.transaction_type) || hasText(qualification.transaction_type),
    }),
    buildChecklistItem({
      key: 'property_or_legal_matter',
      label: 'Identify the property or legal matter',
      isComplete:
        hasText(checklistAnswers.property_or_legal_matter) ||
        hasText(property.address) ||
        hasText(property.location) ||
        hasText(qualification.legal_services_needed),
    }),
    buildChecklistItem({
      key: 'closing_date',
      label: 'Confirm the closing date',
      isComplete:
        hasText(checklistAnswers.closing_date) ||
        hasText(qualification.closing_timeline) ||
        hasText(property.timeline),
    }),
    buildChecklistItem({
      key: 'agreement_and_docs_received',
      label: 'Confirm whether APS and required documents have been received',
      isComplete:
        hasText(checklistAnswers.agreement_and_docs_received) ||
        hasText(qualification.transaction_stage) &&
          String(qualification.transaction_stage) !== 'just_researching',
    }),
    buildChecklistItem({
      key: 'outstanding_legal_requirements',
      label: 'Identify any outstanding legal requirements',
      isComplete:
        hasText(checklistAnswers.outstanding_legal_requirements) ||
        hasText(qualification.legal_services_needed),
    }),
    buildChecklistItem({
      key: 'next_step',
      label: 'Confirm the next step (consultation, document review, closing preparation, etc.)',
      isComplete: hasText(nextStepText),
    }),
  ];
}

export function evaluateRoleConversionChecklist({
  role,
  leadProfile,
  leadMatch,
  pendingAgentChecklist = null,
  pendingLawyerChecklist = null,
  pendingMortgageChecklist = null,
}) {
  const normalizedRole = normalizeRole(role);
  let items;
  if (normalizedRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    items = evaluateMortgageChecklist({ leadProfile, leadMatch, pendingMortgageChecklist });
  } else if (normalizedRole === PROFESSIONAL_TYPE.LAWYER) {
    items = evaluateLawyerChecklist({
      leadProfile,
      leadMatch,
      pendingLawyerChecklist,
    });
  } else {
    items = evaluateAgentChecklist({ leadProfile, leadMatch, pendingAgentChecklist });
  }
  const missingItems = items.filter((item) => !item.isComplete);
  return {
    role: normalizedRole,
    items,
    canConvert: missingItems.length === 0,
    missingItems,
  };
}
