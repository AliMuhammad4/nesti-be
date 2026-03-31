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
  full_name: str,
  email: str,
  phone: str,
  property_address: str,
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
  preferred_contact_method: str,
  best_time_to_contact: str,
  mortgage_status: str,
  realtor_status: str,
  motivation_reason: str,
  viewing_readiness: str,
  living_situation: str,
  urgency_readiness: str,
  mortgage_timeline: str,
  transaction_stage: str,
  closing_timeline: str,
  transaction_type: str,
  property_value: str,
  realtor_involved: str,
  first_time_buyer: str,
  legal_services_needed: str,
  pre_approval_status: str,
  credit_score_range: str,
  employment_status: str,
  household_income: str,
  down_payment_readiness: str,
  purchase_purpose: str,
  urgency_signal: str,
  mortgage_property_budget: str,
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
