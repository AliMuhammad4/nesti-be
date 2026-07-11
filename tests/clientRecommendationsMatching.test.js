import test from 'node:test';
import assert from 'node:assert/strict';
import { mapClientProfileToLeadShape, calculateClientProfileCompleteness } from '../services/matching/clientProfileMapper.js';
import {
  calculateAiCompatibilityScore,
  calculatePreferenceMatchScore,
  isClientProfileReadyForRecommendations,
  isRecommendationQualified,
  paginateRecommendations,
  resolveRecommendationPool,
  sanitizeRecommendationItem,
} from '../services/matching/matchRankingService.js';
import {
  expandSemanticTokens,
  locationMatchScore,
  passesLanguageRequirement,
} from '../services/matching/matchScoringUtils.js';
import { PROFESSIONAL_TYPE } from '../constants/roles.js';

const baseClient = {
  home_goals: ['first_time_buyer'],
  dream_home_price: 650_000,
  preferred_locations: ['Toronto', 'Mississauga'],
  purchase_timeline: 'asap',
  working_styles: ['patient_supportive'],
  priority_tags: ['family_neighbourhoods', 'great_schools'],
  languages: ['english', 'punjabi'],
  preferred_experience: 'experienced_agent',
  comfort_preferences: ['no_preference'],
  employment_status: 'full_time',
};

const strongAgent = {
  professional_type: PROFESSIONAL_TYPE.AGENT,
  full_name: 'Alex Agent',
  location: 'Toronto',
  target_neighborhoods: 'Mississauga, Etobicoke',
  availability: 'Available immediately',
  response_time: 'Within 24 hours',
  specializations: ['first_time_buyers', 'family homes'],
  core_specialization_tags: ['first_time_home_buyers', 'family_home_buyers'],
  specialty_strength_tags: ['first_time_buyer_expert', 'family_housing_expert'],
  service_area_primary_zones: ['Toronto'],
  service_area_secondary_zones: ['Mississauga'],
  preferred_clients: ['first_time_buyers'],
  languages_spoken: ['english', 'punjabi'],
  working_style_structured: 'educational_advisor',
  working_style_tags: ['educational_advisor', 'calm_patient_guide', 'high_responsiveness'],
  personality_style_tags: ['friendly_and_warm', 'calm_and_patient'],
  experience_level: 'senior',
  experience: '12 years',
  bio: 'Helping first-time buyers in Toronto and Mississauga.',
};

const weakAgent = {
  professional_type: PROFESSIONAL_TYPE.AGENT,
  full_name: 'Sparse Agent',
};

const strongLawyer = {
  professional_type: PROFESSIONAL_TYPE.LAWYER,
  full_name: 'Priya Lawyer',
  location: 'Toronto',
  target_neighborhoods: 'Toronto, Mississauga',
  availability: 'Available immediately',
  response_time: 'Same day',
  core_specialization_tags: ['purchase_transactions', 'closing_document_review'],
  specialty_strength_tags: ['first_time_buyer_expert'],
  service_area_primary_zones: ['Toronto'],
  service_area_secondary_zones: ['Mississauga'],
  languages_spoken: ['english', 'punjabi'],
  working_style_tags: ['calm_patient_guide', 'high_responsiveness'],
  personality_style_tags: ['calm_and_patient'],
  experience_level: 'senior',
  experience: '10 years',
  bio: 'Real estate lawyer for first-time home purchase closings.',
};

const unrelatedLawyer = {
  ...strongLawyer,
  full_name: 'Dispute Lawyer',
  location: 'Vancouver',
  target_neighborhoods: 'Vancouver',
  core_specialization_tags: ['real_estate_disputes', 'landlord_tenant_matters'],
  specialty_strength_tags: [],
  service_area_primary_zones: ['Vancouver'],
  service_area_secondary_zones: [],
  languages_spoken: ['english'],
  experience_level: 'junior',
  experience: '1 year',
  bio: 'Focused on landlord tenant disputes and real estate litigation.',
};

test('client profile mapper produces lead-compatible shape', () => {
  const lead = mapClientProfileToLeadShape(baseClient);
  assert.equal(lead.intent, 'buy');
  assert.equal(lead.budget_profile.max_budget, 650_000);
  assert.equal(lead.property.location, 'Toronto, Mississauga');
  assert.equal(lead.qualification.lawyer.property_value, '400k_700k');
  assert.deepEqual(lead.preferences.language_preference, ['english', 'punjabi']);
});

test('profile completeness reflects filled onboarding signals', () => {
  const completeClient = {
    ...baseClient,
    annual_income: 120_000,
    current_savings: 40_000,
    monthly_savings: 1_500,
    preferred_contact_method: 'email',
    best_time_to_contact: 'evening',
    mortgage_status: 'fully_pre_approved',
    realtor_status: 'no_agent',
    viewing_readiness: 'asap',
    living_situation: 'renting',
    offer_readiness: 'maybe',
    motivation_reason: 'relocation',
  };
  assert.equal(calculateClientProfileCompleteness(completeClient), 100);
  assert.ok(calculateClientProfileCompleteness({}) < 30);
  assert.ok(calculateClientProfileCompleteness(baseClient) < 100);
});

test('semantic token expansion improves specialization overlap', () => {
  const clientTokens = expandSemanticTokens('first_time_buyer', 'family_neighbourhoods');
  const proTokens = expandSemanticTokens('first_time_buyers', 'family homes');
  const overlap = [...clientTokens].filter((token) => proTokens.has(token));
  assert.ok(overlap.length >= 1);
});

test('location matching handles partial overlap', () => {
  assert.equal(locationMatchScore(['Toronto'], 'Serving Toronto and GTA'), 1);
  assert.equal(locationMatchScore(['Vancouver'], 'Toronto'), 0);
});

test('language hard requirement blocks incompatible professionals', () => {
  assert.equal(passesLanguageRequirement(['punjabi'], ['english', 'punjabi']), true);
  assert.equal(passesLanguageRequirement(['punjabi'], ['english']), false);
  assert.equal(passesLanguageRequirement(['english', 'punjabi'], []), true);
  assert.equal(passesLanguageRequirement(['english'], []), true);
  assert.equal(passesLanguageRequirement(['mandarin'], ['english']), false);
});

test('strong agent scores higher than sparse agent for same client', () => {
  const strong = calculateAiCompatibilityScore(baseClient, strongAgent);
  const weak = calculateAiCompatibilityScore(baseClient, weakAgent);
  assert.ok(strong.ai_match_score > weak.ai_match_score);
  assert.ok(strong.data_confidence_score > weak.data_confidence_score);
  assert.ok(strong.preference_score > 50);
});

test('strong purchase lawyer scores higher than unrelated lawyer for same client', () => {
  const strong = calculateAiCompatibilityScore(baseClient, strongLawyer);
  const unrelated = calculateAiCompatibilityScore(baseClient, unrelatedLawyer);
  const strongSpecialization = strong.ai_match_breakdown.find((item) => item.key === 'specialization_fit');
  const unrelatedSpecialization = unrelated.ai_match_breakdown.find((item) => item.key === 'specialization_fit');

  assert.ok(strong.ai_match_score > unrelated.ai_match_score);
  assert.ok(strongSpecialization.score > unrelatedSpecialization.score);
  assert.ok(strong.ai_match_score >= 60);
});

test('mortgage broker business tags drive borrower matching', () => {
  const mortgageClient = {
    ...baseClient,
    home_goals: ['first_time_buyer'],
    employment_status: 'self_employed',
    mortgage_status: 'needs_pre_approval',
  };
  const strongBroker = {
    ...strongAgent,
    professional_type: PROFESSIONAL_TYPE.MORTGAGE_BROKER,
    core_specialization_tags: ['first_time_home_buyer_financing', 'pre_approval_guidance', 'self_employed_borrowers'],
    specialty_strength_tags: ['fast_pre_approval_turnaround', 'income_document_strategist'],
    specializations: ['first_time_home_buyer_financing', 'self_employed_borrowers'],
    preferred_clients: ['first_time_buyers', 'self_employed_borrowers'],
  };
  const genericBroker = {
    ...strongBroker,
    core_specialization_tags: ['commercial_mortgage_financing'],
    specialty_strength_tags: ['debt_service_optimization'],
    specializations: ['commercial_mortgage_financing'],
    preferred_clients: [],
    bio: 'Commercial mortgage files for experienced investors.',
  };

  const strong = calculateAiCompatibilityScore(mortgageClient, strongBroker);
  const generic = calculateAiCompatibilityScore(mortgageClient, genericBroker);
  const strongSpecialization = strong.ai_match_breakdown.find((item) => item.key === 'specialization_fit');
  const genericSpecialization = generic.ai_match_breakdown.find((item) => item.key === 'specialization_fit');

  assert.ok(strongSpecialization.score > genericSpecialization.score);
  assert.ok(strong.ai_match_score > generic.ai_match_score);
});

test('weights align with revised unified model', () => {
  const broker = {
    ...strongAgent,
    professional_type: PROFESSIONAL_TYPE.MORTGAGE_BROKER,
    specializations: ['first_time_buyers', 'self_employed_borrowers'],
  };
  const agentPref = calculatePreferenceMatchScore(baseClient, strongAgent);
  const brokerPref = calculatePreferenceMatchScore(baseClient, broker);
  const agentLocation = agentPref.breakdown.find((item) => item.key === 'location_fit');
  const brokerLocation = brokerPref.breakdown.find((item) => item.key === 'location_fit');
  const agentSpec = agentPref.breakdown.find((item) => item.key === 'specialization_fit');
  const brokerSpec = brokerPref.breakdown.find((item) => item.key === 'specialization_fit');
  assert.equal(agentPref.breakdown.some((item) => item.key === 'financial_fit'), false);
  assert.equal(brokerPref.breakdown.some((item) => item.key === 'financial_fit'), false);
  assert.equal(agentLocation.weight, 25);
  assert.equal(brokerLocation.weight, 25);
  assert.equal(agentSpec.weight, 25);
  assert.equal(brokerSpec.weight, 25);
});

test('icp fit blend adjusts score and exposes icp fit metadata', () => {
  const lowerPreferenceAgent = {
    ...strongAgent,
    location: 'Hamilton',
    target_neighborhoods: '',
    service_area_primary_zones: ['Hamilton'],
    service_area_secondary_zones: [],
    specializations: ['commercial'],
    core_specialization_tags: ['commercial_clients'],
    specialty_strength_tags: [],
    preferred_clients: ['investors'],
    languages_spoken: ['english'],
    working_style_structured: 'fast_deal_closer',
    working_style_tags: ['transactional_efficient'],
    personality_style_tags: ['direct_transactional'],
    experience_level: 'junior',
    experience: '1 year',
    bio: 'Commercial investor specialist outside the GTA.',
  };
  const icpFit = {
    fit_score: 96,
    matched_factors: ['price_range', 'service_area', 'timeline'],
    missing_factors: [],
  };
  const withoutIcp = calculateAiCompatibilityScore(baseClient, lowerPreferenceAgent);
  const withIcp = calculateAiCompatibilityScore(baseClient, lowerPreferenceAgent, { icpFit });
  assert.equal(withIcp.icp_fit_score, 96);
  assert.deepEqual(withIcp.ai_match_factors, ['price_range', 'service_area', 'timeline']);
  assert.ok(withIcp.ai_match_score > withoutIcp.ai_match_score);
  assert.equal(withIcp.preference_score, withoutIcp.preference_score);
});

test('missing client data does not inflate score via fallback defaults', () => {
  const sparseClient = { languages: ['english'] };
  const result = calculateAiCompatibilityScore(sparseClient, strongAgent);
  assert.ok(result.ai_match_score < 75);
  assert.ok(result.client_profile_completeness < 30);
});

test('primary zones score higher than secondary zones', () => {
  const secondaryOnly = {
    ...strongAgent,
    service_area_primary_zones: ['Hamilton'],
    service_area_secondary_zones: ['Toronto'],
    location: 'Hamilton',
    target_neighborhoods: 'Hamilton',
  };
  const primary = calculatePreferenceMatchScore(baseClient, strongAgent);
  const secondary = calculatePreferenceMatchScore(baseClient, secondaryOnly);
  const primaryLocation = primary.breakdown.find((item) => item.key === 'location_fit');
  const secondaryLocation = secondary.breakdown.find((item) => item.key === 'location_fit');
  assert.ok(primaryLocation.score > secondaryLocation.score);
});

test('expanded language taxonomy supports non-legacy language choices', () => {
  const hindiPro = { ...strongAgent, languages_spoken: ['hindi'] };
  assert.equal(passesLanguageRequirement(['hindi'], hindiPro.languages_spoken), true);
  assert.equal(passesLanguageRequirement(['vietnamese'], hindiPro.languages_spoken), false);
});

test('paginateRecommendations returns expected slice and flags', () => {
  const items = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }));
  const paged = paginateRecommendations(items, 2, 12);

  assert.equal(paged.page, 2);
  assert.equal(paged.limit, 12);
  assert.equal(paged.total, 25);
  assert.equal(paged.total_pages, 3);
  assert.equal(paged.has_prev_page, true);
  assert.equal(paged.has_next_page, true);
  assert.deepEqual(paged.items.map((item) => item.id), [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
});

test('paginateRecommendations clamps page to last page', () => {
  const items = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }));
  const paged = paginateRecommendations(items, 99, 3);

  assert.equal(paged.page, 3);
  assert.equal(paged.total_pages, 3);
  assert.equal(paged.has_prev_page, true);
  assert.equal(paged.has_next_page, false);
  assert.deepEqual(paged.items.map((item) => item.id), [7]);
});

test('paginateRecommendations returns stable metadata for empty lists', () => {
  const paged = paginateRecommendations([], 4, 12);

  assert.equal(paged.page, 1);
  assert.equal(paged.limit, 12);
  assert.equal(paged.total, 0);
  assert.equal(paged.total_pages, 1);
  assert.equal(paged.has_prev_page, false);
  assert.equal(paged.has_next_page, false);
  assert.deepEqual(paged.items, []);
});

test('recommendation qualification enforces minimum score threshold', () => {
  assert.equal(isRecommendationQualified({ ai_match_score: 60 }), true);
  assert.equal(isRecommendationQualified({ ai_match_score: 59 }), false);
  assert.equal(isRecommendationQualified({ ai_match_score: 75 }), true);
});

test('profile readiness requires minimum completeness for recommendations', () => {
  assert.equal(isClientProfileReadyForRecommendations(70), true);
  assert.equal(isClientProfileReadyForRecommendations(69), false);
  assert.equal(isClientProfileReadyForRecommendations(0), false);
});

test('recommendation pool keeps qualified matches when available', () => {
  const scored = [{ id: 'a', ai_match_score: 72 }, { id: 'b', ai_match_score: 58 }];
  const resolved = resolveRecommendationPool(scored, { topUpTo: 1 });

  assert.equal(resolved.usingLowScoreFallback, false);
  assert.deepEqual(resolved.qualified.map((item) => item.id), ['a']);
  assert.deepEqual(resolved.pool.map((item) => item.id), ['a']);
});

test('recommendation pool falls back to lower scores when no qualified matches', () => {
  const scored = [{ id: 'a', ai_match_score: 45 }, { id: 'b', ai_match_score: 39 }];
  const resolved = resolveRecommendationPool(scored, { topUpTo: 12 });

  assert.equal(resolved.usingLowScoreFallback, true);
  assert.deepEqual(resolved.qualified, []);
  assert.deepEqual(resolved.pool.map((item) => item.id), ['a', 'b']);
});

test('recommendation pool tops up with lower scores when qualified are below page size', () => {
  const scored = [{ id: 'a', ai_match_score: 75 }, { id: 'b', ai_match_score: 59 }, { id: 'c', ai_match_score: 40 }];
  const resolved = resolveRecommendationPool(scored, { topUpTo: 12 });

  assert.equal(resolved.usingLowScoreFallback, true);
  assert.deepEqual(resolved.qualified.map((item) => item.id), ['a']);
  assert.deepEqual(resolved.pool.map((item) => item.id), ['a', 'b', 'c']);
});

test('sanitizeRecommendationItem normalizes output types', () => {
  const item = sanitizeRecommendationItem({
    id: 123,
    user_id: 456,
    full_name: '  ',
    professional_name: '  Jane Doe  ',
    professional_type: 'agent',
    email: null,
    specializations: [' first_time ', '', 'investor'],
    ai_match_score: '72',
    icp_fit_score: undefined,
    ai_match_breakdown: [{ key: 'location_fit', label: 'Location Fit', weight: '20', score: '15', detail: 'good' }],
    ai_match_factors: [' timeline ', null],
  });

  assert.equal(item.id, '123');
  assert.equal(item.user_id, '456');
  assert.equal(item.full_name, 'Jane Doe');
  assert.equal(item.ai_match_score, 72);
  assert.equal(item.icp_fit_score, null);
  assert.deepEqual(item.specializations, ['first_time', 'investor']);
  assert.deepEqual(item.ai_match_factors, ['timeline']);
  assert.equal(item.ai_match_breakdown[0].weight, 20);
});
