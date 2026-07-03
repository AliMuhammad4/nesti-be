import test from 'node:test';
import assert from 'node:assert/strict';
import { mapClientProfileToLeadShape, calculateClientProfileCompleteness } from '../services/matching/clientProfileMapper.js';
import {
  calculateAiCompatibilityScore,
  calculatePreferenceMatchScore,
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
  avg_home_price: 640_000,
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

test('client profile mapper produces lead-compatible shape', () => {
  const lead = mapClientProfileToLeadShape(baseClient);
  assert.equal(lead.intent, 'buy');
  assert.equal(lead.budget_profile.max_budget, 650_000);
  assert.equal(lead.property.location, 'Toronto, Mississauga');
  assert.equal(lead.qualification.lawyer.property_value, '400k_700k');
  assert.deepEqual(lead.preferences.language_preference, ['english', 'punjabi']);
});

test('profile completeness reflects filled onboarding signals', () => {
  assert.equal(calculateClientProfileCompleteness(baseClient), 100);
  assert.ok(calculateClientProfileCompleteness({}) < 30);
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
  assert.equal(agentLocation.weight, 20);
  assert.equal(brokerLocation.weight, 20);
  assert.equal(agentSpec.weight, 15);
  assert.equal(brokerSpec.weight, 15);
});

test('icp fit blend adjusts score and exposes icp fit metadata', () => {
  const lowerPreferenceAgent = {
    ...strongAgent,
    avg_home_price: 820_000,
    location: 'Hamilton',
    target_neighborhoods: '',
    specializations: ['commercial'],
    preferred_clients: ['investors'],
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
