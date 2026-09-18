import { Joi, objectId, str } from './common.js';
import { USER_ROLE_VALUES } from '../constants/roles.js';
import { MATCH_STATUSES, REFERRAL_STATUSES } from '../constants/validationEnums.js';
import { SUBSCRIPTION_PLAN_KEYS, SUBSCRIPTION_STATUSES } from '../models/Subscription.js';
import { CLIENT_TIER_KEYS, CLIENT_SUBSCRIPTION_STATUSES } from '../models/ClientSubscription.js';
import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';

export const adminAnalyticsQuerySchema = Joi.object({
  range: Joi.string()
    .valid('7d', '30d', '90d', '180d', '365d', '1m', '3m', '6m', '1y')
    .default('30d'),
});

export const adminListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  q: str.optional(),
  role: Joi.string().valid(...USER_ROLE_VALUES, '').optional(),
  audience: Joi.string().valid('professionals', 'clients', 'all', '').optional(),
  status: str.optional(),
  professional_type: Joi.string().valid(...PROFESSIONAL_TYPE_VALUES, '').optional(),
  kind: Joi.string().valid('professional', 'client', 'all', '').optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  sort: Joi.string().max(40).optional(),
  order: Joi.string().valid('asc', 'desc', '1', '-1', '').optional(),
  credential_status: str.optional(),
  is_verified: Joi.boolean().optional(),
  source: str.optional(),
});

export const adminSuspendUserSchema = Joi.object({
  reason: str.max(500).optional().default(''),
});

export const adminPatchProfessionalSchema = Joi.object({
  full_name: str.max(120).optional(),
  company_name: str.max(160).optional(),
  phone: str.max(40).optional(),
  location: str.max(160).optional(),
  professional_type: Joi.string().valid(...PROFESSIONAL_TYPE_VALUES).optional(),
  website: str.max(300).optional(),
  license_number: str.max(80).optional(),
}).min(1);

export const adminPatchClientSchema = Joi.object({
  preferred_location: str.max(160).optional(),
  purchase_timeline: str.max(40).optional(),
  dream_home_price: Joi.number().min(0).allow(null).optional(),
  current_savings: Joi.number().min(0).allow(null).optional(),
  home_goal: str.max(200).optional(),
  employment_status: str.max(40).optional(),
}).min(1);

export const adminPatchLeadSchema = Joi.object({
  match_status: Joi.string().valid(...MATCH_STATUSES).optional(),
  user_id: objectId.optional(),
  lead_type: str.max(80).optional(),
}).min(1);

export const adminPatchPropertySchema = Joi.object({
  admin_hidden: Joi.boolean().optional(),
  admin_notes: str.max(500).optional(),
  title: str.max(200).optional(),
}).min(1);

export const adminPatchSubscriptionSchema = Joi.object({
  kind: Joi.string().valid('professional', 'client').required(),
  plan_key: Joi.string().valid(...SUBSCRIPTION_PLAN_KEYS).optional(),
  status: Joi.string().valid(...SUBSCRIPTION_STATUSES, ...CLIENT_SUBSCRIPTION_STATUSES).optional(),
  tier: Joi.string().valid(...CLIENT_TIER_KEYS).optional(),
  trial_end: Joi.date().iso().allow(null).optional(),
  current_period_end: Joi.date().iso().allow(null).optional(),
  cancel_at_period_end: Joi.boolean().optional(),
}).min(2);

export const adminPatchReferralSchema = Joi.object({
  status: Joi.string().valid(...REFERRAL_STATUSES).required(),
  notes: str.max(1000).optional(),
});

export const adminRejectVerificationSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
});
