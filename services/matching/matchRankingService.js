import { getPlacementPriority } from '../billing/plans.js';
import ClientProfile from '../../models/ClientProfile.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import PublicProfile from '../../models/PublicProfile.js';
import IcpProfile from '../../models/IcpProfile.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { scoreLeadAgainstIcp } from '../lead/icpScoringService.js';
import {
  calculateClientProfileCompleteness,
  mapClientProfileToLeadShape,
} from './clientProfileMapper.js';
import {
  calculateProfessionalDataConfidence,
  clampScore,
  expandSemanticTokens,
  locationMatchScore,
  normalizeProfessionalLanguages,
  scoreCategory,
  scoreWorkingStyleMatch,
  toArray,
  toText,
  tokenOverlapScore,
} from './matchScoringUtils.js';

const ROLE_WEIGHTS = Object.freeze({
  [PROFESSIONAL_TYPE.AGENT]: {
    location_fit: 25,
    timeline_fit: 15,
    specialization_fit: 25,
    communication_language_fit: 15,
    experience_fit: 10,
    personality_preference_fit: 10,
  },
  [PROFESSIONAL_TYPE.MORTGAGE_BROKER]: {
    location_fit: 25,
    timeline_fit: 15,
    specialization_fit: 25,
    communication_language_fit: 15,
    experience_fit: 10,
    personality_preference_fit: 10,
  },
  [PROFESSIONAL_TYPE.LAWYER]: {
    location_fit: 25,
    timeline_fit: 15,
    specialization_fit: 25,
    communication_language_fit: 15,
    experience_fit: 10,
    personality_preference_fit: 10,
  },
});

const DEFAULT_WEIGHTS = ROLE_WEIGHTS[PROFESSIONAL_TYPE.AGENT];
const ICP_BLEND_RATIO = 0.4;
const MIN_RECOMMENDED_MATCH_SCORE = 60;
const MIN_CLIENT_PROFILE_COMPLETENESS_FOR_RECOMMENDATIONS = 70;
const RECOMMENDATION_PROFILE_FIELDS = [
  'professional_type',
  'full_name',
  'company_name',
  'phone',
  'location',
  'target_neighborhoods',
  'experience',
  'experience_level',
  'specializations',
  'languages_spoken',
  'active_icp_profile_id',
  'service_area_primary_zones',
  'service_area_secondary_zones',
  'service_area_cities',
  'service_area_regions',
  'availability',
  'response_time',
  'working_style_structured',
  'working_style_tags',
  'core_specialization_tags',
  'specialty_strength_tags',
  'preferred_clients',
  'bio',
  'personality_style_tags',
  'personality_tag',
  'energy_style',
  'sales_approach',
  'support_level',
  'awards',
].join(' ');

function getRoleWeights(professionalType) {
  return ROLE_WEIGHTS[professionalType] || DEFAULT_WEIGHTS;
}

function scoreLocationFit(client, professional, max) {
  const locations = [...toArray(client?.preferred_locations), ...toArray(client?.preferred_location)];
  const primaryZones = toArray(professional?.service_area_primary_zones);
  const secondaryZones = toArray(professional?.service_area_secondary_zones);
  const cities = toArray(professional?.service_area_cities);
  const regions = toArray(professional?.service_area_regions);
  const professionalText = [
    professional?.location || '',
    professional?.target_neighborhoods || '',
    ...primaryZones,
    ...secondaryZones,
    ...cities,
    ...regions,
  ].join(' ');
  const clientReady = locations.length > 0;
  const proReady = Boolean(String(professionalText).trim());
  if (!clientReady) return scoreCategory({ clientReady, proReady, ratio: 0 });
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };
  const joinedClient = locations.join(' ');
  const primaryRatio = primaryZones.length ? locationMatchScore(locations, primaryZones.join(' ')) : 0;
  const secondaryRatio = secondaryZones.length ? locationMatchScore(locations, secondaryZones.join(' ')) : 0;
  const cityRatio = cities.length ? locationMatchScore(locations, cities.join(' ')) : 0;
  const regionRatio = regions.length ? locationMatchScore(locations, regions.join(' ')) : 0;
  const fallbackRatio = locationMatchScore(locations, professionalText);

  const weightedPrimary = primaryRatio * 1;
  const weightedSecondary = secondaryRatio * 0.7;
  const weightedCity = cityRatio * 0.85;
  const weightedRegion = regionRatio * 0.6;
  const weightedFallback = (fallbackRatio || 0) * 0.5;
  const ratio = Math.min(
    1,
    Math.max(weightedPrimary, weightedSecondary, weightedCity, weightedRegion, weightedFallback),
  );
  const exactPrimary = primaryZones.length > 0 && locationMatchScore([joinedClient], primaryZones.join(' ')) === 1;
  const detail = exactPrimary
    ? 'serves your preferred area directly'
    : ratio >= 0.8
      ? 'strong service area overlap'
      : ratio >= 0.5
        ? 'secondary area overlap'
        : 'limited area overlap';
  return {
    score: Math.round((ratio || 0) * max),
    applicable: true,
    reason: 'scored',
    detail,
  };
}

function scoreTimelineFit(client, professional, max) {
  const timeline = toText(client?.purchase_timeline);
  const availability = toText(`${professional?.availability || ''} ${professional?.response_time || ''}`);
  const clientReady = Boolean(timeline);
  const proReady = Boolean(availability.trim());
  if (!clientReady) return scoreCategory({ clientReady, proReady, ratio: 0 });
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };

  const fastClient = timeline.includes('asap') || timeline.includes('1-3');
  const fastPro = /immediate|same|24|quick|fast|available|asap/.test(availability);
  if (fastClient && fastPro) {
    return { score: max, applicable: true, reason: 'scored', detail: 'matches your urgent timeline' };
  }
  if (!fastClient && availability.trim()) {
    return { score: Math.round(max * 0.75), applicable: true, reason: 'scored', detail: 'fits your buying timeline' };
  }
  return { score: Math.round(max * 0.35), applicable: true, reason: 'scored', detail: 'timeline may need confirmation' };
}

function scoreAgentSpecialization(client, professional, max) {
  const clientTokens = expandSemanticTokens(
    client?.home_goals,
    client?.home_goal,
    client?.priority_tags,
    client?.purchase_purpose,
    client?.motivation_reason,
  );
  const professionalTokens = expandSemanticTokens(
    professional?.core_specialization_tags,
    professional?.specialty_strength_tags,
    professional?.specializations,
    professional?.preferred_clients,
    professional?.bio,
  );
  const clientReady = clientTokens.size > 0;
  const proReady = professionalTokens.size > 0;
  if (!clientReady) return scoreCategory({ clientReady, proReady, ratio: 0 });
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };
  const ratio = tokenOverlapScore(clientTokens, professionalTokens) ?? 0;
  return {
    score: Math.round(ratio * max),
    applicable: true,
    reason: 'scored',
    detail: ratio >= 0.75 ? 'strong specialization match' : ratio >= 0.45 ? 'relevant experience' : 'limited specialization overlap',
  };
}

function scoreBrokerSpecialization(client, professional, max) {
  const clientGoalText = toText([
    ...(Array.isArray(client?.home_goals) ? client.home_goals : [client?.home_goals]),
    client?.home_goal,
    ...(Array.isArray(client?.priority_tags) ? client.priority_tags : [client?.priority_tags]),
    client?.purchase_purpose,
  ].filter(Boolean).join(' '));
  const goals = expandSemanticTokens(client?.home_goals, client?.home_goal, client?.priority_tags);
  const isInvestorGoal = /\b(invest|investor|investment|rental|commercial)\b/.test(clientGoalText);
  const isFirstTimeGoal = /first[_\s-]*time|new[_\s-]*(buyer|borrower)|beginner|starter/.test(clientGoalText);
  const proTokens = expandSemanticTokens(
    professional?.core_specialization_tags,
    professional?.specialty_strength_tags,
    professional?.specializations,
    professional?.preferred_clients,
    professional?.bio,
  );
  const clientReady = goals.size > 0 || Boolean(client?.employment_status);
  const proReady = proTokens.size > 0;
  if (!clientReady) return scoreCategory({ clientReady, proReady, ratio: 0 });
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };

  const clientLoanTokens = expandSemanticTokens(
    client?.employment_status === 'self_employed' ? 'self_employed' : '',
    isInvestorGoal ? 'investment' : '',
    isFirstTimeGoal ? 'first_time' : '',
    client?.purchase_purpose,
    client?.mortgage_status,
  );
  const ratio = tokenOverlapScore(clientLoanTokens, proTokens) ?? 0;
  return {
    score: Math.round(ratio * max),
    applicable: true,
    reason: 'scored',
    detail: ratio >= 0.75 ? 'strong financing specialization match' : 'relevant lending experience',
  };
}

function scoreLawyerSpecialization(client, professional, max) {
  const goals = expandSemanticTokens(client?.home_goals, client?.home_goal, client?.purchase_purpose, client?.motivation_reason);
  const proTokens = expandSemanticTokens(
    professional?.core_specialization_tags,
    professional?.specialty_strength_tags,
    professional?.specializations,
    professional?.preferred_clients,
    professional?.bio,
  );
  const clientReady = goals.size > 0;
  const proReady = proTokens.size > 0;
  if (!clientReady) return scoreCategory({ clientReady, proReady, ratio: 0 });
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };

  const isInvestment = goals.has('investor') || goals.has('investment') || goals.has('commercial');
  const isFirstTime = goals.has('first_time');
  const clientTxTokens = expandSemanticTokens(
    isInvestment
      ? ['investment', 'commercial', 'commercial_real_estate_closings', 'private_lending_files', 'assignment_sales']
      : ['home_purchase', 'purchase_transactions', 'closing_document_review'],
    isFirstTime ? ['first_time', 'purchase_transactions', 'closing_document_review'] : '',
  );
  const ratio = tokenOverlapScore(clientTxTokens, proTokens) ?? 0;
  return {
    score: Math.round(ratio * max),
    applicable: true,
    reason: 'scored',
    detail: ratio >= 0.75 ? 'strong legal specialization match' : 'relevant transaction experience',
  };
}

function scoreSpecializationFit(client, professional, max) {
  const role = professional?.professional_type || PROFESSIONAL_TYPE.AGENT;
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return scoreBrokerSpecialization(client, professional, max);
  if (role === PROFESSIONAL_TYPE.LAWYER) return scoreLawyerSpecialization(client, professional, max);
  return scoreAgentSpecialization(client, professional, max);
}

function scoreCommunicationFit(client, professional, max) {
  const clientLanguages = toArray(client?.languages).filter((lang) => lang && lang !== 'other');
  const proLanguages = normalizeProfessionalLanguages(professional?.languages_spoken);
  const clientReady = clientLanguages.length > 0 || (client?.working_styles || []).length > 0;
  const proReady =
    proLanguages.length > 0 ||
    Boolean(
      professional?.working_style_structured ||
        (Array.isArray(professional?.working_style_tags) && professional.working_style_tags.length) ||
        professional?.bio,
    );

  if (!clientReady) return scoreCategory({ clientReady, proReady, ratio: 0 });
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };

  let languageRatio = null;
  if (clientLanguages.length) {
    const matched = clientLanguages.some((lang) => proLanguages.includes(lang));
    languageRatio = matched ? 1 : proLanguages.length ? 0 : clientLanguages.every((l) => l === 'english') ? 0.5 : 0;
  }

  const styleRatio = scoreWorkingStyleMatch(client?.working_styles || [], professional);
  const parts = [languageRatio, styleRatio].filter((v) => v != null);
  const ratio = parts.length ? parts.reduce((sum, v) => sum + v, 0) / parts.length : 0;

  return {
    score: Math.round(ratio * max),
    applicable: true,
    reason: 'scored',
    detail: ratio >= 0.8 ? 'communication style and language align' : 'partial communication alignment',
  };
}

function scoreExperienceFit(client, professional, max) {
  const preference = toText(client?.preferred_experience);
  const level = toText(`${professional?.experience_level || ''} ${professional?.experience || ''} ${professional?.awards || ''}`);
  const clientReady = Boolean(preference);
  const proReady = Boolean(level.trim());
  if (!clientReady) return scoreCategory({ clientReady, proReady, ratio: 0 });
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };

  let ratio = 0.2;
  if (preference.includes('beginner') && /junior|mid|educational|advisor|support/.test(level)) ratio = 1;
  else if (preference.includes('top') && /elite|senior|award|top|volume/.test(level)) ratio = 1;
  else if (preference.includes('luxury') && /elite|luxury|senior/.test(level)) ratio = 1;
  else if (preference.includes('investor') && /invest|elite|senior|mid/.test(level)) ratio = 1;
  else if (preference.includes('experienced') && /mid|senior|elite|year/.test(level)) ratio = 0.85;

  return {
    score: Math.round(ratio * max),
    applicable: true,
    reason: 'scored',
    detail: ratio >= 0.85 ? 'experience level matches your preference' : 'experience level partially matches',
  };
}

function scorePersonalityFit(client, professional, max) {
  if (!max) return { score: 0, applicable: false, reason: 'not_used' };
  const preferences = toArray(client?.comfort_preferences);
  const text = toText(
    `${professional?.personality_style_tags || ''} ${professional?.personality_tag || ''} ${professional?.energy_style || ''} ${professional?.sales_approach || ''} ${professional?.support_level || ''} ${professional?.working_style_tags || ''} ${professional?.bio || ''}`,
  );
  const clientReady = preferences.length > 0 && !preferences.includes('no_preference');
  const proReady = Boolean(text.trim());
  if (!clientReady) return scoreCategory({ clientReady, proReady, ratio: 0 });
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };

  const overlap = preferences.some((pref) => [...expandSemanticTokens(pref)].some((word) => text.includes(word)));
  return {
    score: overlap ? max : Math.round(max * 0.2),
    applicable: true,
    reason: 'scored',
    detail: overlap ? 'comfort preferences align' : 'limited comfort preference overlap',
  };
}

function empathyCompatibilityBoost(client, professional) {
  const clientSignals = expandSemanticTokens(client?.comfort_preferences, client?.working_styles, client?.priority_tags);
  const proSignals = expandSemanticTokens(
    professional?.personality_style_tags,
    professional?.working_style_tags,
    professional?.personality_tag,
    professional?.support_level,
    professional?.bio,
  );
  if (!clientSignals.size || !proSignals.size) return 1;
  const overlapRatio = tokenOverlapScore(clientSignals, proSignals) ?? 0;
  if (overlapRatio >= 0.75) return 1.05;
  if (overlapRatio >= 0.45) return 1.02;
  if (overlapRatio >= 0.2) return 1;
  return 0.97;
}

function buildBreakdownItem(key, label, weight, result) {
  const applicable = result.applicable !== false;
  const score = applicable && result.score != null ? result.score : 0;
  return {
    key,
    label,
    weight: applicable ? weight : 0,
    score,
    applicable,
    detail: result.detail || '',
    reason: result.reason || '',
  };
}

function buildMatchExplanation({ score, breakdown, matchedFactors, confidence }) {
  const strongItems = breakdown
    .filter((item) => item.applicable && item.score > 0)
    .sort((a, b) => b.score / Math.max(b.weight, 1) - a.score / Math.max(a.weight, 1))
    .slice(0, 3);

  const highlights = strongItems
    .map((item) => {
      const text = item.detail || item.label.toLowerCase();
      return text.replace(/^(fits|matches)\s+/i, '');
    })
    .filter(Boolean);
  const highlightText = highlights.length
    ? highlights.join(', ')
    : matchedFactors?.length
      ? `${matchedFactors.slice(0, 2).join(' and ')} alignment`
      : 'your profile preferences';

  let explanation = `${score}% compatibility from ${highlightText}.`;
  if (confidence < 60) {
    explanation += ' Complete your profile preferences for sharper recommendations.';
  } else if (confidence < 80) {
    explanation += ' Some profile details are still being refined for this match.';
  }
  return explanation;
}

export function calculatePreferenceMatchScore(clientProfile, professionalProfile) {
  const role = professionalProfile?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const weights = getRoleWeights(role);

  const rawResults = {
    location_fit: scoreLocationFit(clientProfile, professionalProfile, weights.location_fit),
    timeline_fit: scoreTimelineFit(clientProfile, professionalProfile, weights.timeline_fit),
    specialization_fit: scoreSpecializationFit(clientProfile, professionalProfile, weights.specialization_fit),
    communication_language_fit: scoreCommunicationFit(clientProfile, professionalProfile, weights.communication_language_fit),
    experience_fit: scoreExperienceFit(clientProfile, professionalProfile, weights.experience_fit),
    personality_preference_fit: scorePersonalityFit(clientProfile, professionalProfile, weights.personality_preference_fit),
  };

  const breakdown = [
    buildBreakdownItem('location_fit', 'Location Fit', weights.location_fit, rawResults.location_fit),
    buildBreakdownItem('timeline_fit', 'Timeline Fit', weights.timeline_fit, rawResults.timeline_fit),
    buildBreakdownItem('specialization_fit', 'Specialization Fit', weights.specialization_fit, rawResults.specialization_fit),
    buildBreakdownItem('communication_language_fit', 'Communication & Language Fit', weights.communication_language_fit, rawResults.communication_language_fit),
    buildBreakdownItem('experience_fit', 'Experience Fit', weights.experience_fit, rawResults.experience_fit),
    buildBreakdownItem('personality_preference_fit', 'Personality & Preference Fit', weights.personality_preference_fit, rawResults.personality_preference_fit),
  ].filter((item) => item.weight > 0);

  const applicableWeight = breakdown.reduce((sum, item) => sum + item.weight, 0);
  const earnedScore = breakdown.reduce((sum, item) => sum + item.score, 0);
  const preferenceScore = applicableWeight > 0 ? clampScore((earnedScore / applicableWeight) * 100) : 0;

  return {
    preference_score: preferenceScore,
    breakdown,
    applicable_weight: applicableWeight,
    earned_score: earnedScore,
  };
}

export function calculateAiCompatibilityScore(clientProfile, professionalProfile, options = {}) {
  const { icpFit = null } = options;
  const preference = calculatePreferenceMatchScore(clientProfile, professionalProfile);
  const clientConfidence = calculateClientProfileCompleteness(clientProfile);
  const proConfidence = calculateProfessionalDataConfidence(professionalProfile);
  const dataConfidence = Math.round((clientConfidence * 0.55 + proConfidence * 0.45));

  let blendedScore = preference.preference_score;
  let icpFitScore = null;
  if (icpFit?.fit_score != null) {
    icpFitScore = icpFit.fit_score;
    blendedScore = clampScore(
      preference.preference_score * (1 - ICP_BLEND_RATIO) + icpFitScore * ICP_BLEND_RATIO,
    );
  }

  const role = professionalProfile?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const maxWeight = Object.values(getRoleWeights(role)).reduce((sum, value) => sum + value, 0);
  const signalCoverage = maxWeight > 0 ? preference.applicable_weight / maxWeight : 0;
  const coverageMultiplier = 0.42 + signalCoverage * 0.38 + (clientConfidence / 100) * 0.2;
  const proMultiplier = 0.78 + (proConfidence / 100) * 0.22;
  const empathyBoost = empathyCompatibilityBoost(clientProfile, professionalProfile);
  const confidenceAdjustedScore = clampScore(blendedScore * coverageMultiplier * proMultiplier * empathyBoost);

  const explanation = buildMatchExplanation({
    score: confidenceAdjustedScore,
    breakdown: preference.breakdown,
    matchedFactors: icpFit?.matched_factors || [],
    confidence: dataConfidence,
  });

  return {
    ai_match_score: confidenceAdjustedScore,
    preference_score: preference.preference_score,
    icp_fit_score: icpFitScore,
    data_confidence_score: dataConfidence,
    client_profile_completeness: clientConfidence,
    professional_profile_completeness: proConfidence,
    ai_match_breakdown: preference.breakdown.map(({ key, label, weight, score, detail }) => ({
      key,
      label,
      weight,
      score,
      detail,
    })),
    ai_match_explanation: explanation,
    ai_match_factors: icpFit?.matched_factors || [],
    ai_match_tier:
      confidenceAdjustedScore >= 80 ? 'excellent_match' : confidenceAdjustedScore >= 60 ? 'strong_match' : confidenceAdjustedScore >= 40 ? 'good_match' : 'explore_match',
  };
}

/** Resolve configured ICP fit for a client ↔ professional pair (shared by list + detail scoring). */
export async function resolveIcpFitForClientMatch(clientProfile, professionalProfile) {
  const icpId = professionalProfile?.active_icp_profile_id;
  if (!icpId) return null;

  const icp = await IcpProfile.findOne({ _id: icpId, is_configured: true }).lean();
  if (!icp) return null;

  const leadShape = mapClientProfileToLeadShape(clientProfile || {});
  return scoreLeadAgainstIcp(
    { ...leadShape, ownership: { professional_type: professionalProfile.professional_type } },
    icp,
  );
}

/** Client-facing match score aligned with recommendation list scoring (includes ICP blend). */
export async function calculateClientProfessionalAiMatch(clientProfile, professionalProfile) {
  const icpFit = await resolveIcpFitForClientMatch(clientProfile, professionalProfile);
  return calculateAiCompatibilityScore(clientProfile || {}, professionalProfile, { icpFit });
}

function rankByRoleGroups(scoredItems, limit) {
  if (!scoredItems.length) return [];

  // When everything fits, return the full ranked list (no artificial per-role cap).
  if (scoredItems.length <= limit) {
    return scoredItems.slice(0, limit);
  }

  const groups = new Map();
  for (const item of scoredItems) {
    const role = item.professional_type || 'agent';
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(item);
  }

  const roleCount = groups.size || 1;
  const perRole = Math.ceil(limit / roleCount);
  const selected = [];
  for (const [, items] of groups) {
    selected.push(...items.slice(0, perRole));
  }

  return selected.sort((a, b) => b.ai_match_score - a.ai_match_score).slice(0, limit);
}

function toSafeText(value) {
  return String(value ?? '').trim();
}

function toSafeNullableText(value) {
  const safe = toSafeText(value);
  return safe || null;
}

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toSafeBoolean(value) {
  return Boolean(value);
}

function toSafeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toSafeText(item)).filter(Boolean);
}

function toSafeBreakdown(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      key: toSafeText(item?.key),
      label: toSafeText(item?.label),
      weight: toSafeNumber(item?.weight),
      score: toSafeNumber(item?.score),
      detail: toSafeText(item?.detail),
    }))
    .filter((item) => item.key);
}

export function sanitizeRecommendationItem(item = {}) {
  const safeFullName = toSafeText(item.full_name);
  const safeProfessionalName = toSafeText(item.professional_name);
  const resolvedName = safeFullName || safeProfessionalName || 'Professional';
  return {
    id: toSafeText(item.id),
    user_id: toSafeText(item.user_id),
    full_name: resolvedName,
    professional_name: resolvedName,
    professional_type: toSafeText(item.professional_type || 'agent'),
    email: toSafeText(item.email),
    phone: toSafeText(item.phone),
    company_name: toSafeText(item.company_name),
    location: toSafeText(item.location),
    target_neighborhoods: toSafeText(item.target_neighborhoods),
    experience: toSafeText(item.experience),
    experience_level: toSafeText(item.experience_level),
    specializations: toSafeStringArray(item.specializations),
    languages_spoken: toSafeStringArray(item.languages_spoken),
    profile_image: toSafeNullableText(item.profile_image),
    cover_image: toSafeNullableText(item.cover_image),
    headline: toSafeText(item.headline),
    slug: toSafeNullableText(item.slug),
    has_public_profile: toSafeBoolean(item.has_public_profile),
    has_icp_profile: toSafeBoolean(item.has_icp_profile),
    ai_match_score: toSafeNumber(item.ai_match_score),
    preference_score: toSafeNumber(item.preference_score),
    icp_fit_score: item.icp_fit_score == null ? null : toSafeNumber(item.icp_fit_score),
    data_confidence_score: toSafeNumber(item.data_confidence_score),
    client_profile_completeness: toSafeNumber(item.client_profile_completeness),
    professional_profile_completeness: toSafeNumber(item.professional_profile_completeness),
    ai_match_breakdown: toSafeBreakdown(item.ai_match_breakdown),
    ai_match_explanation: toSafeText(item.ai_match_explanation),
    ai_match_factors: toSafeStringArray(item.ai_match_factors),
    ai_match_tier: toSafeText(item.ai_match_tier || 'explore_match'),
  };
}

function sanitizeRecommendationsMeta(meta = {}) {
  return {
    algorithm_version: toSafeText(meta.algorithm_version || 'v2'),
    role_filter: toSafeText(meta.role_filter || 'all'),
    icp_blend_ratio: toSafeNumber(meta.icp_blend_ratio),
    matching_enabled: toSafeBoolean(meta.matching_enabled),
    min_profile_completeness: toSafeNumber(meta.min_profile_completeness),
    total_candidates: toSafeNumber(meta.total_candidates),
    min_recommended_score: toSafeNumber(meta.min_recommended_score),
    qualified_candidates: toSafeNumber(meta.qualified_candidates),
    recommendation_candidates: toSafeNumber(meta.recommendation_candidates),
    used_low_score_fallback: toSafeBoolean(meta.used_low_score_fallback),
  };
}

function sanitizeRecommendationsPagination(pagination = {}) {
  return {
    page: Math.max(1, Math.trunc(toSafeNumber(pagination.page, 1))),
    limit: Math.max(1, Math.trunc(toSafeNumber(pagination.limit, 24))),
    total: Math.max(0, Math.trunc(toSafeNumber(pagination.total))),
    total_pages: Math.max(1, Math.trunc(toSafeNumber(pagination.total_pages, 1))),
    has_prev_page: toSafeBoolean(pagination.has_prev_page),
    has_next_page: toSafeBoolean(pagination.has_next_page),
    qualified_total: Math.max(0, Math.trunc(toSafeNumber(pagination.qualified_total))),
    recommendation_total: Math.max(0, Math.trunc(toSafeNumber(pagination.recommendation_total))),
  };
}

export function paginateRecommendations(items, page, limit) {
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 60);
  const safePage = Math.max(Number(page) || 1, 1);
  const total = items.length;
  const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
  const normalizedPage = Math.min(safePage, totalPages);
  const start = (normalizedPage - 1) * safeLimit;
  const end = start + safeLimit;

  return {
    items: items.slice(start, end),
    page: normalizedPage,
    limit: safeLimit,
    total,
    total_pages: totalPages,
    has_prev_page: normalizedPage > 1,
    has_next_page: normalizedPage < totalPages,
  };
}

export function isRecommendationQualified(item, minScore = MIN_RECOMMENDED_MATCH_SCORE) {
  return Number(item?.ai_match_score || 0) >= Number(minScore || 0);
}

export function resolveRecommendationPool(
  scoredItems,
  {
    minScore = MIN_RECOMMENDED_MATCH_SCORE,
    topUpTo = 0,
  } = {},
) {
  const qualified = scoredItems.filter((item) => isRecommendationQualified(item, minScore));
  const shouldTopUp = topUpTo > 0 && qualified.length > 0 && qualified.length < topUpTo && scoredItems.length > qualified.length;
  const usingLowScoreFallback = (qualified.length === 0 && scoredItems.length > 0) || shouldTopUp;
  return {
    qualified,
    pool: usingLowScoreFallback ? scoredItems : qualified,
    usingLowScoreFallback,
  };
}

export function isClientProfileReadyForRecommendations(
  profileCompleteness,
  minCompleteness = MIN_CLIENT_PROFILE_COMPLETENESS_FOR_RECOMMENDATIONS,
) {
  return Number(profileCompleteness || 0) >= Number(minCompleteness || 0);
}

export async function getClientRecommendationsForUser(userId, { role, limit = 24, page = 1 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 60);
  const clientProfile = await ClientProfile.findOne({ user_id: userId }).lean();
  const leadShape = mapClientProfileToLeadShape(clientProfile || {});
  const profileCompleteness = calculateClientProfileCompleteness(clientProfile || {});
  const matchingEnabled = isClientProfileReadyForRecommendations(profileCompleteness);

  const filter = {};
  if (role && ['agent', 'lawyer', 'mortgage_broker'].includes(role)) {
    filter.professional_type = role;
  }

  const professionalProfiles = await ProfessionalProfile.find(filter)
    .select(RECOMMENDATION_PROFILE_FIELDS)
    .populate('user_id', 'first_name last_name email profile_image cover_image role')
    .sort({ updatedAt: -1 })
    .lean();

  const icpIds = professionalProfiles.map((p) => p.active_icp_profile_id).filter(Boolean);
  const icpProfiles = icpIds.length
    ? await IcpProfile.find({ _id: { $in: icpIds }, is_configured: true }).lean()
    : [];
  const icpById = new Map(icpProfiles.map((icp) => [icp._id.toString(), icp]));

  const userIds = professionalProfiles.map((profile) => profile.user_id?._id).filter(Boolean);
  const publicProfiles = await PublicProfile.find({ user_id: { $in: userIds } })
    .select('user_id slug enabled headline profile_photo_url cover_photo_url')
    .lean();
  const publicByUserId = new Map(publicProfiles.map((profile) => [profile.user_id.toString(), profile]));

  const scored = professionalProfiles
    .map((profile) => {
      const user = profile.user_id || {};
      if (!user._id) return null;

      const icp = profile.active_icp_profile_id
        ? icpById.get(profile.active_icp_profile_id.toString())
        : null;
      const icpFit = icp
        ? scoreLeadAgainstIcp(
            { ...leadShape, ownership: { professional_type: profile.professional_type } },
            icp,
          )
        : null;

      const publicProfile = publicByUserId.get(user._id.toString()) || null;
      const name =
        profile.full_name ||
        [user.first_name, user.last_name].filter(Boolean).join(' ') ||
        'Professional';
      const match = calculateAiCompatibilityScore(clientProfile || {}, profile, { icpFit });

      return {
        id: user._id.toString(),
        user_id: user._id.toString(),
        full_name: name,
        professional_name: name,
        professional_type: profile.professional_type,
        email: user.email || '',
        phone: profile.phone || '',
        company_name: profile.company_name || '',
        location: profile.location || '',
        target_neighborhoods: profile.target_neighborhoods || '',
        experience: profile.experience || '',
        experience_level: profile.experience_level || '',
        specializations: Array.isArray(profile.specializations) ? profile.specializations : [],
        languages_spoken: Array.isArray(profile.languages_spoken) ? profile.languages_spoken : [],
        profile_image: publicProfile?.profile_photo_url || user.profile_image || null,
        cover_image: publicProfile?.cover_photo_url || user.cover_image || null,
        headline: publicProfile?.headline || '',
        slug: publicProfile?.enabled ? publicProfile.slug : null,
        has_public_profile: Boolean(publicProfile?.enabled),
        has_icp_profile: Boolean(icpFit),
        ...match,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.ai_match_score - a.ai_match_score);

  const recommendationSet = resolveRecommendationPool(scored, { topUpTo: safeLimit });
  const rankedSource = recommendationSet.pool;
  const ranked = role ? rankedSource : rankByRoleGroups(rankedSource, rankedSource.length || safeLimit);
  const pagination = paginateRecommendations(ranked, page, limit);

  const matchingMeta = sanitizeRecommendationsMeta({
    algorithm_version: 'v2',
    role_filter: role || 'all',
    icp_blend_ratio: ICP_BLEND_RATIO,
    matching_enabled: matchingEnabled,
    min_profile_completeness: MIN_CLIENT_PROFILE_COMPLETENESS_FOR_RECOMMENDATIONS,
    total_candidates: professionalProfiles.length,
    min_recommended_score: MIN_RECOMMENDED_MATCH_SCORE,
    qualified_candidates: scored.length,
    recommendation_candidates: recommendationSet.pool.length,
    used_low_score_fallback: recommendationSet.usingLowScoreFallback,
  });

  const effectiveItems = matchingEnabled ? pagination.items : [];
  const effectivePagination = matchingEnabled
    ? pagination
    : sanitizeRecommendationsPagination({
        page: 1,
        limit: safeLimit,
        total: 0,
        total_pages: 1,
        has_prev_page: false,
        has_next_page: false,
        qualified_total: scored.length,
        recommendation_total: 0,
      });

  const paginationMeta = sanitizeRecommendationsPagination({
    page: effectivePagination.page,
    limit: effectivePagination.limit,
    total: effectivePagination.total,
    total_pages: effectivePagination.total_pages,
    has_prev_page: effectivePagination.has_prev_page,
    has_next_page: effectivePagination.has_next_page,
    qualified_total: scored.length,
    recommendation_total: matchingEnabled ? recommendationSet.pool.length : 0,
  });

  return {
    profile: clientProfile || null,
    client_profile_completeness: Math.max(0, Math.min(100, toSafeNumber(profileCompleteness))),
    matching_meta: matchingMeta,
    items: effectiveItems.map((item) => sanitizeRecommendationItem(item)).filter((item) => item.id),
    pagination: paginationMeta,
  };
}

export function calculateFinalMatchScore(icpFitScore, subscription) {
  let score = icpFitScore || 0;
  const planKey = subscription?.plan_key;
  if (planKey) {
    const priority = getPlacementPriority(planKey);
    const boost = Math.min(priority, 20);
    score += boost;
  }
  return Math.min(100, score);
}

export function sortProfessionalsByMatch(professionals) {
  return professionals.sort((a, b) => {
    const scoreA = a.final_match_score || a.icp_fit?.fit_score || 0;
    const scoreB = b.final_match_score || b.icp_fit?.fit_score || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const placementA = a.subscription?.placement_priority || 0;
    const placementB = b.subscription?.placement_priority || 0;
    if (placementB !== placementA) return placementB - placementA;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });
}

export function enrichMatchWithTierBoost(leadMatch, subscription) {
  if (!leadMatch) return null;
  const icpFitScore = leadMatch.icp_fit?.fit_score || 0;
  const finalScore = calculateFinalMatchScore(icpFitScore, subscription);
  return {
    ...leadMatch,
    final_match_score: finalScore,
    tier_boost: finalScore - icpFitScore,
    subscription_tier: subscription?.plan_key || 'none',
  };
}
