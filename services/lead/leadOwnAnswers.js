import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

/**
 * One person can send a lawyer / mortgage broker several inquiries (e.g. personal, then investor) that share one
 * LeadProfile. Each lead keeps its own client type and answers on the LeadMatch; the shared profile (always the
 * latest inquiry) is only the fallback for older leads that never saved their own.
 */

export const LEAD_ANSWER_KEYS = Object.freeze({
  [PROFESSIONAL_TYPE.LAWYER]: [
    'transaction_stage', 'closing_timeline', 'transaction_type', 'property_value', 'mortgage_status',
    'realtor_involved', 'first_time_buyer', 'legal_services_needed', 'via_company',
    'market_country', 'market_region', 'market_city', 'market_country_name',
  ],
  [PROFESSIONAL_TYPE.MORTGAGE_BROKER]: [
    'mortgage_timeline', 'pre_approval_status', 'credit_score_range', 'employment_status', 'household_income',
    'down_payment_readiness', 'purchase_purpose', 'urgency_signal', 'property_budget', 'investment_type',
    'owns_investments', 'investment_financing', 'borrower_entity',
    'market_country', 'market_region', 'market_city', 'market_country_name',
  ],
});

/** Answers that only belong to an investor inquiry (blanked on personal leads). */
export const INVESTOR_ONLY_ANSWER_KEYS = Object.freeze({
  [PROFESSIONAL_TYPE.LAWYER]: ['via_company'],
  [PROFESSIONAL_TYPE.MORTGAGE_BROKER]: ['investment_type', 'owns_investments', 'investment_financing', 'borrower_entity'],
});

/** Answers that only belong to a personal inquiry (blanked on investor leads). */
export const PERSONAL_ONLY_ANSWER_KEYS = Object.freeze({
  [PROFESSIONAL_TYPE.LAWYER]: ['first_time_buyer'],
  [PROFESSIONAL_TYPE.MORTGAGE_BROKER]: [],
});

const CLIENT_TYPES = new Set(['buyer', 'seller', 'investor']);

function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

function hasValue(value) {
  return value != null && String(value).trim() !== '';
}

export function isLawyerOrBroker(professionalType) {
  return professionalType === PROFESSIONAL_TYPE.LAWYER || professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER;
}

function roleOf(leadMatch, leadProfile, professionalType) {
  return professionalType
    || leadMatch?.compatibility_factors?.professional_type
    || leadProfile?.ownership?.professional_type
    || PROFESSIONAL_TYPE.AGENT;
}

/** Non-empty answers for one role section, ready to keep on the lead match (`compatibility_factors.lead_answers`). */
export function leadAnswersSnapshot(professionalType, section = {}) {
  const keys = LEAD_ANSWER_KEYS[professionalType];
  if (!keys || !section || typeof section !== 'object') return {};
  const out = {};
  for (const key of keys) {
    if (hasValue(section[key])) out[key] = String(section[key]).trim();
  }
  return out;
}

/**
 * Client type of this lead: `*_investor` lead type, else the lead's own saved client type, else (personal
 * `*_client` lead) none. The shared profile is used only when the lead itself says nothing.
 */
export function resolveLeadOwnClientType(leadMatch, leadProfile, professionalType) {
  const role = roleOf(leadMatch, leadProfile, professionalType);
  const profileType = CLIENT_TYPES.has(norm(leadProfile?.client_type)) ? norm(leadProfile.client_type) : null;
  if (!isLawyerOrBroker(role)) return profileType;
  const leadType = norm(leadMatch?.lead_type);
  if (/_investor$/.test(leadType)) return 'investor';
  const own = norm(leadMatch?.compatibility_factors?.client_type);
  if (CLIENT_TYPES.has(own)) return own;
  // A personal lead never shows an investor type picked up from the person's other inquiry.
  if (/_client$/.test(leadType)) return profileType === 'investor' ? null : profileType;
  return profileType;
}

/**
 * Lawyer / broker qualification (flat API shape) for this lead: its own saved answers over the shared profile,
 * with the investor-only / personal-only answers of the person's other inquiry blanked.
 */
export function applyLeadOwnAnswers(qualification, leadMatch, leadProfile, professionalType) {
  const role = roleOf(leadMatch, leadProfile, professionalType);
  if (!isLawyerOrBroker(role) || !qualification || typeof qualification !== 'object') return qualification;
  const cf = leadMatch?.compatibility_factors || {};
  const own = cf.lead_answers && typeof cf.lead_answers === 'object' ? cf.lead_answers : {};
  const out = { ...qualification };
  for (const key of LEAD_ANSWER_KEYS[role]) {
    // Saved snapshot first, then the per-lead fields older leads kept on the match.
    if (hasValue(own[key])) out[key] = own[key];
    else if (hasValue(cf[key]) && typeof cf[key] !== 'object') out[key] = cf[key];
  }
  const investor = resolveLeadOwnClientType(leadMatch, leadProfile, role) === 'investor';
  const blank = investor ? PERSONAL_ONLY_ANSWER_KEYS[role] : INVESTOR_ONLY_ANSWER_KEYS[role];
  for (const key of blank) if (key in out) out[key] = null;
  if (!investor && role === PROFESSIONAL_TYPE.MORTGAGE_BROKER && norm(out.purchase_purpose) === 'investment') {
    out.purchase_purpose = null;
  }
  if ('client_type' in out) out.client_type = investor ? 'investor' : resolveLeadOwnClientType(leadMatch, leadProfile, role);
  return out;
}

/** Template answers for this lead: its own, else the profile's when the profile is the same client type. */
export function resolveLeadOwnTemplateAnswers(leadMatch, leadProfile, professionalType) {
  const clean = (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([, value]) => hasValue(value)))
    : {});
  const role = roleOf(leadMatch, leadProfile, professionalType);
  const profileAnswers = clean(leadProfile?.template_answers);
  if (!isLawyerOrBroker(role)) return Object.keys(profileAnswers).length ? profileAnswers : null;
  const own = clean(leadMatch?.compatibility_factors?.template_answers);
  if (Object.keys(own).length) return own;
  const leadType = resolveLeadOwnClientType(leadMatch, leadProfile, role) || '';
  const profileType = CLIENT_TYPES.has(norm(leadProfile?.client_type)) ? norm(leadProfile.client_type) : '';
  if (leadType !== profileType) return null;
  return Object.keys(profileAnswers).length ? profileAnswers : null;
}
