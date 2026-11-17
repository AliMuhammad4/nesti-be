import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { Joi, anyObj, objectId, str } from './common.js';
import { PERSON_NAME_MAX, PERSON_NAME_MESSAGE, PERSON_NAME_PATTERN } from '../utils/personName.js';
import { isKnownServiceArea, isKnownServiceCity, isKnownServiceRegion, isPlausiblePlaceName } from '../utils/serviceAreaNames.js';

// Service areas must be names from the location picker, not free text.
// Shape check here; the controller checks new names against the location list and keeps
// names already saved on the profile.
const serviceAreaItem = (_check, kind) =>
  Joi.string()
    .trim()
    .max(160)
    .custom((value, helpers) => (isPlausiblePlaceName(value) ? value : helpers.error('any.invalid')))
    .messages({ 'any.invalid': `"{#value}" isn't a recognised ${kind}. Remove it and choose one from the list.` });

const personName = Joi.string().trim().min(1).max(PERSON_NAME_MAX).pattern(PERSON_NAME_PATTERN)
  .messages({ 'string.pattern.base': PERSON_NAME_MESSAGE });
const webImageUrl = Joi.string().uri({ scheme: ['http', 'https'] }).max(2048).allow(null, '');

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

/** Adds https:// when missing and checks it is a real web address (http or https only). */
export function normalizeWebUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null;
  let url = parsed.toString();
  if (parsed.pathname === '/' && !parsed.search && !parsed.hash) url = url.replace(/\/$/, '');
  return url.slice(0, 2048);
}

const SOCIAL_HOSTS = [
  'linkedin.com', 'instagram.com', 'facebook.com', 'fb.com', 'x.com', 'twitter.com',
  'youtube.com', 'tiktok.com', 'threads.net', 'pinterest.com',
];
const socialHostOf = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^(www\.|m\.|[a-z]{2}\.)/, '');
    return SOCIAL_HOSTS.find((item) => host === item || host.endsWith(`.${item}`)) || '';
  } catch {
    return '';
  }
};

/** A social link must point at a profile or page, not the site's home, feed or a search. */
export function isSocialProfileUrl(url) {
  const host = socialHostOf(url);
  if (!host) return true;
  const path = new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
  if (!path || path === '/') return false;
  if (/^\/(feed|home|search|explore|notifications|messages|watch|login|signup)(\/|$)/.test(path)) return false;
  if (host === 'linkedin.com') return /^\/(in|company|school|pub)\/[^/]+/.test(path);
  return true;
}

const websiteField = Joi.string()
  .allow('', null)
  .custom((value, helpers) => {
    if (value === '' || value === null) return value;
    const url = normalizeWebUrl(value);
    if (!url) return helpers.message('Enter a valid website address, for example https://yourcompany.com');
    if (!isSocialProfileUrl(url)) {
      return helpers.message('Use your company website here, or a link to your own profile, not a feed or home page');
    }
    return url;
  });

const socialMediaField = Joi.string()
  .allow('', null)
  .custom((value, helpers) => {
    if (value === '' || value === null) return value;
    const url = normalizeWebUrl(value);
    if (!url) return helpers.message('Enter a valid profile link, for example https://www.linkedin.com/in/your-name');
    if (!isSocialProfileUrl(url)) {
      return helpers.message('Link to your own profile or page, for example https://www.linkedin.com/in/your-name');
    }
    return url;
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
  website: websiteField,
  company_name: str,
  certificates: Joi.array().items(Joi.string()).default([]),
  phone: str,
  location: str,
  target_neighborhoods: str,
  experience: str,
  license_number: str,
  country: Joi.string().valid('CA', 'US').allow(null, ''),
  jurisdiction: Joi.string().trim().max(12).allow('', null),
  nmls_id: Joi.string().trim().max(40).allow('', null),
  social_media: socialMediaField,
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
  // Up to 15 cities can be picked; the server keeps the first 8 as primary and 12 as secondary.
  service_area_primary_zones: Joi.array().items(serviceAreaItem(isKnownServiceArea, 'service area')).max(15).default([]),
  service_area_secondary_zones: Joi.array().items(serviceAreaItem(isKnownServiceArea, 'service area')).max(15).default([]),
  service_area_cities: Joi.array().items(serviceAreaItem(isKnownServiceCity, 'city')).max(15).default([]),
  service_area_regions: Joi.array().items(serviceAreaItem(isKnownServiceRegion, 'region')).max(15).default([]),
  property_match_scoring: anyObj,
});

const professionalProfileUpdateSchema = professionalProfileCreateSchema.fork(
  ['user_id'],
  (s) => s.optional()
);

export const professionalUpsertBodySchema = professionalProfileUpdateSchema
  .fork(['professional_type'], (s) => s.forbidden())
  .append({
    first_name: personName,
    last_name: personName,
    profile_image: webImageUrl,
    cover_image: webImageUrl,
  });
