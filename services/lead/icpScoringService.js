import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import IcpProfile from '../../models/IcpProfile.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

const ICP_WEIGHTS = {
  client_type: 25,
  price_range: 25,
  property_type: 20,
  service_area: 15,
  timeline: 15,
};
const TIMELINE_MAP = {
  asap: 'immediate',
  immediately: 'immediate',
  '1-3 months': '3_6_months',
  '3-6 months': '3_6_months',
  '6-12 months': 'long_term',
  browsing: 'long_term',
};

function normalizeTimeline(value) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return null;
  if (TIMELINE_MAP[v]) return TIMELINE_MAP[v];
  if (/immediate|asap|urgent|right away|within 1 month|this month/.test(v)) return 'immediate';
  if (/1.?3|3.?6|few months/.test(v)) return '3_6_months';
  if (/6.?12|year|long|browsing|just looking/.test(v)) return 'long_term';
  return null;
}

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

function bestBudgetValue(leadProfile) {
  const bp = leadProfile?.budget_profile;
  const fromProfile = bp?.max_budget ?? bp?.min_budget ?? null;
  if (fromProfile != null && fromProfile > 0) return fromProfile;
  const raw = String(leadProfile?.property?.budget || leadProfile?.property?.expected_price || '').replace(/,/g, '');
  const nums = raw.match(/\d+(\.\d+)?/g)?.map(Number).filter(Number.isFinite);
  if (nums?.length) return Math.max(...nums);
  return null;
}

function inRangeWithTolerance(value, min, max) {
  if (value == null) return false;
  const lo = min == null ? 0 : min * 0.8;
  const hi = max == null ? Infinity : max * 1.2;
  return value >= lo && value <= hi;
}

function intentToAgentClientTags(intent) {
  if (intent === 'sell') return ['sellers'];
  return [];
}

function qualToClientTypes(qualification) {
  const types = [];
  const q = qualification?.agent || {};
  const motivation = norm(q.motivation_reason);
  if (motivation === 'investment') types.push('investors');
  if (motivation === 'downsizing') types.push('downsizers');
  if (motivation === 'upgrading') types.push('luxury_buyers');
  if (motivation === 'relocation' || motivation === 'family_change' || motivation === 'divorce') {
    types.push('first_time_buyers');
  }
  const living = norm(q.living_situation);
  if (living === 'renting' && !types.includes('first_time_buyers')) types.push('first_time_buyers');
  return types;
}

function agentPropertyTypeTags(raw) {
  const t = norm(String(raw || '')).replace(/-/g, ' ');
  if (!t) return [];
  const tags = new Set();
  if (t.includes('condo')) tags.add('condo');
  if (t.includes('townhouse')) tags.add('townhouse');
  if (t.includes('detached')) tags.add('detached');
  if (t.includes('multi') && t.includes('family')) tags.add('multi_family');
  if (t.includes('single family') || t.includes('singlefamily')) tags.add('detached');
  if (t.includes('land')) tags.add('land');
  if (t.includes('investment')) tags.add('investment');
  return [...tags];
}

function agentLeadTimelineBucket(leadProfile) {
  const fromProperty = normalizeTimeline(leadProfile.property?.timeline);
  if (fromProperty) return fromProperty;
  const vr = norm(leadProfile.qualification?.agent?.viewing_readiness);
  const fromViewing = {
    asap: 'immediate',
    few_weeks: '3_6_months',
    maybe_later: 'long_term',
    just_browsing: 'long_term',
  }[vr];
  return fromViewing || null;
}

function inferMortgageBrokerLoanTypes(leadProfile, q, options = {}) {
  const inferred = [];
  if (options?.reusedExisting === false) inferred.push('first_time_buyers');
  if (norm(q.purchase_purpose) === 'investment') inferred.push('investment_properties');
  if (norm(q.purchase_purpose) === 'refinance') inferred.push('refinances');
  if (norm(q.employment_status) === 'self_employed') inferred.push('self_employed_borrowers');
  return inferred;
}

function lawyerPropertyValueBounds(propertyValueEnum) {
  const k = norm(String(propertyValueEnum || '')).replace(/-/g, '_');
  const map = {
    under_400k: [0, 400_000],
    '400k_700k': [400_000, 700_000],
    '700k_1m': [700_000, 1_000_000],
    '1m_plus': [1_000_000, null],
  };
  return map[k] || null;
}
function lawyerPropertyValueMatchesIcp(leadProfile, icpMin, icpMax) {
  const q = leadProfile?.qualification?.lawyer || {};
  const bounds = lawyerPropertyValueBounds(q.property_value);
  if (bounds) {
    const [leadMin, leadMax] = bounds;
    const icpLo = icpMin == null ? 0 : icpMin * 0.8;
    const icpHi = icpMax == null ? Infinity : icpMax * 1.2;
    const lHi = leadMax == null ? Infinity : leadMax;
    return lHi >= icpLo && leadMin <= icpHi;
  }
  const v = bestBudgetValue(leadProfile);
  return inRangeWithTolerance(v, icpMin, icpMax);
}
function buildFitResult(totalScore, totalWeight, factors) {
  if (totalWeight === 0) return null;
  const fitScore = Math.round((totalScore / totalWeight) * 100);
  const fitTier = fitScore >= 75 ? 'perfect_match' : fitScore >= 45 ? 'good_match' : 'low_match';
  return {
    fit_score: fitScore,
    fit_tier: fitTier,
    matched_factors: factors.filter((f) => f.matched).map((f) => f.dimension),
    missing_factors: factors.filter((f) => !f.matched).map((f) => f.dimension),
    factors,
  };
}

export function scoreLeadAgainstIcp(leadProfile, icp, options = {}) {
  if (!icp?.is_configured) return null;
  const professionalType = leadProfile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
  if (professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return scoreMortgageLeadAgainstIcp(leadProfile, icp, options);
  }
  if (professionalType === PROFESSIONAL_TYPE.LAWYER) {
    return scoreLawyerLeadAgainstIcp(leadProfile, icp, options);
  }
  return scoreAgentLeadAgainstIcp(leadProfile, icp, options);
}

function scoreAgentLeadAgainstIcp(leadProfile, icp, options = {}) {
  const factors = [];
  let totalScore = 0;
  let totalWeight = 0;

  const leadClientTypes = [
    ...intentToAgentClientTags(leadProfile.intent),
    ...qualToClientTypes(leadProfile.qualification),
  ]
    .map(norm)
    .filter(Boolean);
  if (leadProfile.intent === 'buy' && !leadClientTypes.length) {
    leadClientTypes.push('first_time_buyers');
  }
  const icpClientTypes = (icp.client_types || []).map(norm);
  if (icpClientTypes.length) {
    totalWeight += ICP_WEIGHTS.client_type;
    const matched = leadClientTypes.some((t) => icpClientTypes.includes(t));
    totalScore += matched ? ICP_WEIGHTS.client_type : 0;
    factors.push({
      dimension: 'client_type',
      matched,
      lead_value: leadClientTypes,
      icp_value: icpClientTypes,
    });
  }

  const icpMin = icp.price_range?.min;
  const icpMax = icp.price_range?.max;
  if (icpMin != null || icpMax != null) {
    totalWeight += ICP_WEIGHTS.price_range;
    const leadBudgetMin = leadProfile.budget_profile?.min_budget;
    const leadBudgetMax = leadProfile.budget_profile?.max_budget;
    const leadBudget = leadBudgetMax || leadBudgetMin;
    const matched = inRangeWithTolerance(leadBudget, icpMin, icpMax);
    totalScore += matched ? ICP_WEIGHTS.price_range : 0;
    factors.push({
      dimension: 'price_range',
      matched,
      lead_value: { min: leadBudgetMin, max: leadBudgetMax },
      icp_value: { min: icpMin, max: icpMax },
    });
  }

  const icpPropertyTypes = (icp.property_types || []).map(norm);
  if (icpPropertyTypes.length) {
    totalWeight += ICP_WEIGHTS.property_type;
    const leadTags = agentPropertyTypeTags(leadProfile.property?.property_type);
    const matched = leadTags.some((tag) => icpPropertyTypes.includes(tag));
    totalScore += matched ? ICP_WEIGHTS.property_type : 0;
    factors.push({
      dimension: 'property_type',
      matched,
      lead_value: leadTags.length ? leadTags : norm(leadProfile.property?.property_type) || null,
      icp_value: icpPropertyTypes,
    });
  }

  const icpAreas = (icp.service_areas || []).map(norm);
  if (icpAreas.length) {
    totalWeight += ICP_WEIGHTS.service_area;
    const leadLocation = norm(leadProfile.property?.location || leadProfile.property?.address);
    const matched = leadLocation && icpAreas.some((a) => leadLocation.includes(a) || a.includes(leadLocation));
    totalScore += matched ? ICP_WEIGHTS.service_area : 0;
    factors.push({
      dimension: 'service_area',
      matched: !!matched,
      lead_value: leadLocation || null,
      icp_value: icpAreas,
    });
  }

  const icpTimelines = (icp.timeline_preference || []).map(norm);
  if (icpTimelines.length) {
    totalWeight += ICP_WEIGHTS.timeline;
    const leadTimeline = agentLeadTimelineBucket(leadProfile);
    const matched = leadTimeline && icpTimelines.some((t) => norm(t).includes(leadTimeline) || leadTimeline.includes(norm(t)));
    totalScore += matched ? ICP_WEIGHTS.timeline : 0;
    factors.push({
      dimension: 'timeline',
      matched: !!matched,
      lead_value: leadTimeline || null,
      icp_value: icpTimelines,
    });
  }

  return buildFitResult(totalScore, totalWeight, factors);
}

function scoreMortgageLeadAgainstIcp(leadProfile, icp, options = {}) {
  const factors = [];
  let totalScore = 0;
  let totalWeight = 0;
  const q = leadProfile?.qualification?.mortgage_broker || {};

  const icpLoanTypes = (icp.loan_types || []).map(norm);
  if (icpLoanTypes.length) {
    totalWeight += 30;
    const inferred = inferMortgageBrokerLoanTypes(leadProfile, q, options);
    const matched = inferred.some((t) => icpLoanTypes.includes(norm(t)));
    if (matched) totalScore += 30;
    factors.push({ dimension: 'loan_type', matched, lead_value: inferred, icp_value: icpLoanTypes });
  }

  const icpCredit = (icp.credit_range_preference || []).map(norm);
  if (icpCredit.length) {
    totalWeight += 20;
    const leadCredit = norm(q.credit_score_range);
    const matched = !!leadCredit && icpCredit.includes(leadCredit);
    if (matched) totalScore += 20;
    factors.push({ dimension: 'credit_range', matched, lead_value: q.credit_score_range || null, icp_value: icpCredit });
  }

  const icpIncome = (icp.income_preference || []).map(norm);
  if (icpIncome.length) {
    totalWeight += 20;
    const leadIncome = norm(q.household_income);
    const matched = !!leadIncome && icpIncome.includes(leadIncome);
    if (matched) totalScore += 20;
    factors.push({ dimension: 'income', matched, lead_value: q.household_income || null, icp_value: icpIncome });
  }

  const loanMin = icp.loan_size_range?.min;
  const loanMax = icp.loan_size_range?.max;
  if (loanMin != null || loanMax != null) {
    totalWeight += 30;
    const leadLoanSize = bestBudgetValue(leadProfile);
    const matched = inRangeWithTolerance(leadLoanSize, loanMin, loanMax);
    if (matched) totalScore += 30;
    factors.push({
      dimension: 'loan_size',
      matched,
      lead_value: leadLoanSize,
      icp_value: { min: loanMin, max: loanMax },
    });
  }

  return buildFitResult(totalScore, totalWeight, factors);
}

function scoreLawyerLeadAgainstIcp(leadProfile, icp, _options = {}) {
  const factors = [];
  let totalScore = 0;
  let totalWeight = 0;
  const q = leadProfile?.qualification?.lawyer || {};

  const icpTxTypes = (icp.transaction_types || []).map(norm);
  if (icpTxTypes.length) {
    totalWeight += 40;
    const mapTx = {
      home_purchase: 'home_purchases',
      home_sale: 'home_sales',
      refinance: 'refinances',
      title_transfer: 'title_transfers',
    };
    const leadTx = mapTx[norm(q.transaction_type)] || null;
    const matched = !!leadTx && icpTxTypes.includes(leadTx);
    if (matched) totalScore += 40;
    factors.push({ dimension: 'transaction_type', matched, lead_value: leadTx, icp_value: icpTxTypes });
  }

  const propMin = icp.preferred_property_values?.min;
  const propMax = icp.preferred_property_values?.max;
  if (propMin != null || propMax != null) {
    totalWeight += 35;
    const matched = lawyerPropertyValueMatchesIcp(leadProfile, propMin, propMax);
    if (matched) totalScore += 35;
    const qPv = leadProfile?.qualification?.lawyer?.property_value || null;
    const fallbackNum = bestBudgetValue(leadProfile);
    factors.push({
      dimension: 'property_value',
      matched,
      lead_value: qPv || fallbackNum,
      icp_value: { min: propMin, max: propMax },
    });
  }

  const icpAreas = (icp.service_areas || []).map(norm);
  if (icpAreas.length) {
    totalWeight += 25;
    const leadLocation = norm(leadProfile?.property?.location || leadProfile?.property?.address);
    const matched = !!leadLocation && icpAreas.some((a) => leadLocation.includes(a) || a.includes(leadLocation));
    if (matched) totalScore += 25;
    factors.push({ dimension: 'service_area', matched, lead_value: leadLocation || null, icp_value: icpAreas });
  }

  return buildFitResult(totalScore, totalWeight, factors);
}

export async function computeIcpFitForLead(leadProfile, userId, options = {}) {
  const { activeIcpProfileId, ...scoreOptions } = options;

  let icpId = activeIcpProfileId;
  if (!icpId) {
    const profile = await ProfessionalProfile.findOne({ user_id: userId })
      .select('active_icp_profile_id')
      .lean();
    if (!profile?.active_icp_profile_id) return null;
    icpId = profile.active_icp_profile_id;
  }

  const icp = await IcpProfile.findById(icpId).lean();
  if (!icp?.is_configured) return null;
  return scoreLeadAgainstIcp(leadProfile, icp, scoreOptions);
}
