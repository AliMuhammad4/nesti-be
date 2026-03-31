import { partitionBuyerBudgetInputs } from '../../agent/propertyMatch/parsing.js';
const MORTGAGE_STORED_QUALIFICATION_KEYS = [
  'mortgage_timeline',
  'pre_approval_status',
  'credit_score_range',
  'employment_status',
  'household_income',
  'down_payment_readiness',
  'property_budget',
  'purchase_purpose',
  'urgency_signal',
  'budget',
];
export function pickStoredFormQualification(storedForm) {
  if (!storedForm) return {};
  const o = {};
  for (const k of MORTGAGE_STORED_QUALIFICATION_KEYS) {
    o[k] = storedForm[k] || null;
  }
  return o;
}
export function pickStoredFormSignals(storedForm) {
  if (!storedForm) return {};
  return {
    timeline: storedForm.timeline || storedForm.mortgage_timeline || null,
    budget: storedForm.budget || storedForm.price || null,
    location: storedForm.location || storedForm.address || null,
    beds: storedForm.beds ? parseInt(storedForm.beds, 10) || null : null,
    baths: storedForm.baths ? parseInt(storedForm.baths, 10) || null : null,
    area: null,
  };
}
export function parseBedBathAreaFromAi(ai) {
  if (!ai) return { beds: null, baths: null, area: null };
  const beds =
    ai.bedrooms != null && ai.bedrooms !== '' ? parseInt(ai.bedrooms, 10) || null : null;
  const baths =
    ai.bathrooms != null && ai.bathrooms !== '' ? parseInt(ai.bathrooms, 10) || null : null;
  const area =
    ai.area != null && String(ai.area).trim() !== '' ? String(ai.area).trim() : null;
  return { beds, baths, area };
}
export function locationFromAi(ai) {
  if (!ai) return null;
  return ai.property_address || ai.location || null;
}
export function buildAiExtractedMortgageSignals(parsedAiDetails) {
  const ai = parsedAiDetails || {};
  const { budgetStr: mbSigBudget, financingStr: mbSigFin } = partitionBuyerBudgetInputs(
    ai.budget,
    ai.property_budget
  );
  const { beds, baths, area } = parseBedBathAreaFromAi(ai);
  return {
    location: locationFromAi(ai),
    budget: mbSigBudget || null,
    financing_signal: mbSigFin || null,
    timeline: ai.timeline || ai.mortgage_timeline || null,
    beds,
    baths,
    area,
  };
}
export function mergeMortgageLeadMetaSignals(leadMetaSignals, parsedAiDetails) {
  const ai = parsedAiDetails || {};
  const base = leadMetaSignals || {};
  const loc = locationFromAi(ai);
  const { beds, baths, area: areaVal } = parseBedBathAreaFromAi(ai);
  const out = {
    location: loc || base.location || null,
    timeline: ai.timeline || ai.mortgage_timeline || base.timeline || null,
    beds: beds ?? base.beds ?? null,
    baths: baths ?? base.baths ?? null,
    area: areaVal || base.area || null,
  };
  if (
    Object.prototype.hasOwnProperty.call(ai, 'budget') ||
    Object.prototype.hasOwnProperty.call(ai, 'property_budget')
  ) {
    const { budgetStr, financingStr } = partitionBuyerBudgetInputs(ai.budget, ai.property_budget);
    out.budget = budgetStr || null;
    out.financing_signal = financingStr || base.financing_signal || null;
  } else {
    out.budget = base.budget ?? null;
  }
  return out;
}

export function mergeMortgageAiDetailsForMeta(parsedAiDetails, derivedQual) {
  const p = parsedAiDetails || {};
  const d = derivedQual || {};
  return {
    ...p,
    mortgage_timeline: p.mortgage_timeline || d.mortgage_timeline || '',
    pre_approval_status: p.pre_approval_status || d.pre_approval_status || '',
    credit_score_range: p.credit_score_range || d.credit_score_range || '',
    employment_status: p.employment_status || d.employment_status || '',
    household_income: p.household_income || d.household_income || '',
    down_payment_readiness: p.down_payment_readiness || d.down_payment_readiness || '',
    purchase_purpose: p.purchase_purpose || d.purchase_purpose || '',
    urgency_signal: p.urgency_signal || d.urgency_signal || '',
    property_budget: p.property_budget || d.property_budget || '',
  };
}

export function buildMortgageLeadProfileUpdate(parsedAiDetails, derivedQual, formContact) {
  const p = parsedAiDetails || {};
  const d = derivedQual || {};
  const f = formContact || {};
  return {
    mortgage_timeline: p.mortgage_timeline || d.mortgage_timeline || f.mortgage_timeline,
    pre_approval_status: p.pre_approval_status || d.pre_approval_status || f.pre_approval_status,
    credit_score_range: p.credit_score_range || d.credit_score_range || f.credit_score_range,
    employment_status: p.employment_status || d.employment_status || f.employment_status,
    household_income: p.household_income || d.household_income || f.household_income,
    down_payment_readiness: p.down_payment_readiness || d.down_payment_readiness || f.down_payment_readiness,
    purchase_purpose: p.purchase_purpose || d.purchase_purpose || f.purchase_purpose,
    urgency_signal: p.urgency_signal || d.urgency_signal || f.urgency_signal,
    budget: p.budget || d.budget || f.budget,
    mortgage_property_budget: p.property_budget || d.property_budget || f.property_budget,
  };
}
