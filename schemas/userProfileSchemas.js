import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { Joi, anyObj, objectId, str } from './common.js';

const calendlyUrl = Joi.string()
  .trim()
  .custom((value, helpers) => {
    if (value === '' || value === null) return value;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return helpers.error('string.uri');
    }
    const hostname = String(parsed.hostname || '').toLowerCase();
    if (!hostname || (!hostname.endsWith('calendly.com') && hostname !== 'calendly.com')) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'Calendly URL validation')
  .allow('', null)
  .messages({
    'string.uri': 'calendly_link must be a valid URL',
    'any.invalid': 'calendly_link must be a Calendly URL (calendly.com)',
  });

const PROFESSIONAL_LANGUAGE_VALUES = [
  'english',
  'french',
  'punjabi',
  'tamil',
  'mandarin',
  'arabic',
  'spanish',
  'hindi',
  'urdu',
  'portuguese',
  'tagalog',
  'italian',
  'german',
  'japanese',
  'vietnamese',
  'other',
];

const EXPERIENCE_LEVEL_VALUES = ['junior', 'mid', 'senior', 'elite'];

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
  avg_home_price: Joi.number().min(0).allow(null).optional(),
  commission_rate_percent: Joi.number().min(0).max(100).allow(null).optional(),
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
  calendly_link: calendlyUrl,
  bio: str,
  languages_spoken: Joi.array()
    .items(Joi.string().valid(...PROFESSIONAL_LANGUAGE_VALUES))
    .max(8)
    .default([]),
  other_language_text: Joi.string().trim().max(80).allow('', null),
  working_style_structured: Joi.string()
    .valid('educational_advisor', 'fast_deal_closer', 'data_driven', 'relationship_focused', 'investor_oriented')
    .allow('', null),
  working_style_tags: Joi.array().items(Joi.string()).max(5).default([]),
  experience_level: Joi.string().valid(...EXPERIENCE_LEVEL_VALUES).allow('', null),
  core_specialization_tags: Joi.array().items(Joi.string()).max(5).default([]),
  specialty_strength_tags: Joi.array().items(Joi.string()).max(5).default([]),
  personality_style_tags: Joi.array().items(Joi.string()).max(5).default([]),
  service_area_primary_zones: Joi.array().items(Joi.string()).max(8).default([]),
  service_area_secondary_zones: Joi.array().items(Joi.string()).max(12).default([]),
  service_area_cities: Joi.array().items(Joi.string()).max(15).default([]),
  service_area_regions: Joi.array().items(Joi.string()).max(15).default([]),
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
    profile_image: Joi.string().uri().max(2048).allow(null, ''),
    cover_image: Joi.string().uri().max(2048).allow(null, ''),
  });
