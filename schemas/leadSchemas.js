import {
  CHAT_INTENTS,
  LEAD_QUALITY_LEVELS,
  MATCH_STATUSES,
  YES_NO_EMPTY,
} from '../constants/validationEnums.js';
import { Joi, anyObj, isoDate, leadType, objectId, str } from './common.js';

export const leadMatchCreateSchema = Joi.object({
  user_id: objectId.required(),
  professional_profile_id: objectId.allow(null),
  lead_type: leadType.default('unknown'),
  lead_profile_id: objectId.allow(null),
  conversation_id: objectId,
  match_score: Joi.number().default(0),
  match_status: Joi.string().valid(...MATCH_STATUSES).default('new'),
  compatibility_factors: anyObj.default({}),
  contact_count: Joi.number().integer().min(0).default(0),
  first_contact_at: isoDate,
  last_contact_at: isoDate,
});

export const leadMatchUpdateSchema = leadMatchCreateSchema.fork(['user_id'], (s) => s.optional());

export const leadProfileCreateSchema = Joi.object({
  intent: Joi.string().valid(...CHAT_INTENTS).required(),
  ownership: Joi.object({
    user_id: objectId,
    professional_type: str,
    dedupe_key: str,
  }).default({}),
  identity: Joi.object({
    full_name: str,
    email: str,
    phone: str,
    canonical_email: str,
    canonical_phone: str,
  }).default({}),
  lifecycle: Joi.object({
    status: str,
    first_seen_at: isoDate,
    last_seen_at: isoDate,
    last_inquiry_at: isoDate,
  }).default({}),
  intent_summary: Joi.object({
    primary_intent: str,
    buy_count: Joi.number().integer().min(0),
    sell_count: Joi.number().integer().min(0),
    client_count: Joi.number().integer().min(0),
  }).default({}),
  budget_profile: Joi.object({
    latest_budget_text: str,
    min_budget: Joi.number().allow(null),
    max_budget: Joi.number().allow(null),
    currency: str,
    confidence: str,
  }).default({}),
  contact_preferences: Joi.object({
    preferred_contact_method: str,
    best_time_to_contact: str,
  }).default({}),
  property: Joi.object({
    address: str,
    location: str,
    budget: str,
    expected_price: str,
    timeline: str,
    bedrooms: str,
    bathrooms: str,
    square_footage: str,
    property_type: str,
    must_have_features: str,
    parking_required: Joi.string().valid(...YES_NO_EMPTY).default(''),
    backyard_needed: Joi.string().valid(...YES_NO_EMPTY).default(''),
    school_district_important: Joi.string().valid(...YES_NO_EMPTY).default(''),
  }).default({}),
  qualification: Joi.object({
    agent: anyObj.default({}),
    mortgage_broker: anyObj.default({}),
    lawyer: anyObj.default({}),
  }).default({}),
  scoring: Joi.object({
    current_score: Joi.number(),
    current_grade: str,
    score_trend: str,
    last_scored_at: isoDate,
    components: anyObj,
  }).default({}),
  stats: Joi.object({
    total_inquiries: Joi.number().integer().min(0),
    total_sessions: Joi.number().integer().min(0),
    total_matches: Joi.number().integer().min(0),
    buy_matches: Joi.number().integer().min(0),
    sell_matches: Joi.number().integer().min(0),
    client_matches: Joi.number().integer().min(0),
    last_seen_at: isoDate,
  }).default({}),
  lead_refs: Joi.array().items(objectId).default([]),
  source: str.default('chatbot'),
  total_score: Joi.number().default(0),
});

export const leadProfileUpdateSchema = leadProfileCreateSchema.fork(['intent'], (s) => s.optional());

export const leadAttributionCreateSchema = Joi.object({
  lead_type: leadType.default('unknown'),
  source: str.default('chatbot'),
  converted: Joi.boolean().default(false),
  lead_profile_id: objectId.allow(null),
  session_id: str,
  ip_address: str,
  user_agent: str,
  referrer_url: str,
  landing_page: str,
  utm_source: str,
  utm_medium: str,
  utm_campaign: str,
  utm_content: str,
  utm_term: str,
  initial_score: Joi.number().default(0),
  initial_quality: Joi.string().valid(...LEAD_QUALITY_LEVELS).default('cold'),
});

export const leadAttributionUpdateSchema = leadAttributionCreateSchema;
