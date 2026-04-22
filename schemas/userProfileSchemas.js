import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { Joi, anyObj, objectId, str } from './common.js';

const professionalProfileCreateSchema = Joi.object({
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

const professionalProfileUpdateSchema = professionalProfileCreateSchema.fork(
  ['user_id'],
  (s) => s.optional()
);

export const professionalUpsertBodySchema = professionalProfileUpdateSchema
  .fork(['professional_type'], (s) => s.forbidden())
  .append({
    first_name: Joi.string().trim().min(1),
    last_name: Joi.string().trim().min(1),
  });
