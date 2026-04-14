import { PROFESSIONAL_TYPE_VALUES, USER_ROLE_VALUES } from '../constants/roles.js';
import { ACCOUNT_STATUSES, SUBSCRIPTION_TIERS } from '../constants/validationEnums.js';
import { Joi, anyObj, isoDate, objectId, str } from './common.js';

export const userCreateSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  first_name: Joi.string().required(),
  last_name: Joi.string().required(),
  role: Joi.string().valid(...USER_ROLE_VALUES).default('agent'),
  is_verified: Joi.boolean().default(false),
  otp: str,
  otp_expires_at: isoDate,
  account_status: Joi.string().valid(...ACCOUNT_STATUSES).default('free_trial'),
  subscription_tier: Joi.string().valid(...SUBSCRIPTION_TIERS).default('starter'),
  trial_ends_at: isoDate,
  stripe_customer_id: str,
  stripe_subscription_id: str,
  reset_password_token: str,
  reset_password_expires: isoDate,
});

export const userUpdateSchema = userCreateSchema.fork(
  ['email', 'password', 'first_name', 'last_name'],
  (s) => s.optional()
);

export const professionalProfileCreateSchema = Joi.object({
  user_id: objectId.required(),
  professional_type: Joi.string().valid(...PROFESSIONAL_TYPE_VALUES),
  full_name: str,
  website: str,
  company_name: str,
  certificates: Joi.array().items(Joi.string()).default([]),
  phone: str,
  location: str,
  target_neighborhoods: str,
  experience: str,
  license_number: str,
  social_media: str,
  transaction_volume: str,
  avg_sale_price: str,
  response_time: str,
  availability: str,
  support_level: str,
  negotiation_style: str,
  sales_approach: str,
  energy_style: str,
  personality_tag: str,
  awards: str,
  specializations: Joi.array().items(Joi.string()).default([]),
  communication_channels: Joi.array().items(Joi.string()).default([]),
  preferred_clients: Joi.array().items(Joi.string()).default([]),
  calendly_link: str,
  bio: str,
  property_match_scoring: anyObj,
});

export const professionalProfileUpdateSchema = professionalProfileCreateSchema.fork(
  ['user_id'],
  (s) => s.optional()
);

export const professionalUpsertBodySchema = professionalProfileUpdateSchema
  .fork(['professional_type'], (s) => s.forbidden())
  .append({
    first_name: Joi.string().trim().min(1),
    last_name: Joi.string().trim().min(1),
  });
