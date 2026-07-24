import Joi from 'joi';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

const SHARED_BLOCK_TYPES = Object.freeze([
  'hero',
  'expertise',
  'role-details',
  'about',
  'testimonials',
  'services',
  'guidance',
  'cta',
  'footer',
]);

const ROLE_BLOCK_TYPES = Object.freeze({
  [PROFESSIONAL_TYPE.AGENT]: [
    'properties',
    'featured-listings',
    'top-listings',
    'sold-listings',
  ],
  [PROFESSIONAL_TYPE.MORTGAGE_BROKER]: [
    'mortgage-calculator',
    'mortgage-programs',
  ],
  [PROFESSIONAL_TYPE.LAWYER]: [
    'closing-cost-estimator',
    'practice-areas',
    'credentials',
  ],
});

const MAX_CONTENT_DEPTH = 4;
const MAX_CONTENT_KEYS = 30;
const MAX_CONTENT_ITEMS = 30;
const MAX_CONTENT_TEXT_LENGTH = 2000;
const MAX_URL_LENGTH = 2048;
const COLOR_VALUE_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const URL_KEY_PATTERN = /(?:url|uri|href|link|image|logo)$/i;
const COLOR_KEY_PATTERN = /(?:color|colour)$/i;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function contentValidationError(value, depth = 0, key = '') {
  if (value === null || typeof value === 'boolean') return null;

  if (typeof value === 'string') {
    if (value.length > (URL_KEY_PATTERN.test(key) ? MAX_URL_LENGTH : MAX_CONTENT_TEXT_LENGTH)) {
      return 'contains text that is too long';
    }
    if (URL_KEY_PATTERN.test(key) && value) {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return 'contains a URL with an unsupported protocol';
        }
      } catch {
        return 'contains an invalid URL';
      }
    }
    if (COLOR_KEY_PATTERN.test(key) && value && !COLOR_VALUE_PATTERN.test(value)) {
      return 'contains an invalid color';
    }
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= -1000000 && value <= 1000000
      ? null
      : 'contains a number outside the supported range';
  }

  if (depth >= MAX_CONTENT_DEPTH) {
    return 'is nested too deeply';
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_CONTENT_ITEMS) {
      return 'contains too many items';
    }
    for (const item of value) {
      const error = contentValidationError(item, depth + 1, key);
      if (error) return error;
    }
    return null;
  }

  if (!isPlainObject(value)) {
    return 'must contain only JSON-compatible values';
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_CONTENT_KEYS) {
    return 'contains too many fields';
  }
  for (const [childKey, childValue] of entries) {
    if (!childKey || childKey.length > 80 || ['__proto__', 'constructor', 'prototype'].includes(childKey)) {
      return 'contains an invalid field name';
    }
    const error = contentValidationError(childValue, depth + 1, childKey);
    if (error) return error;
  }
  return null;
}

const storefrontContentSchema = Joi.object()
  .custom((value, helpers) => {
    const error = contentValidationError(value);
    return error ? helpers.message(`{{#label}} ${error}`) : value;
  })
  .default({});

const storefrontLayoutSchema = Joi.object({
  alignment: Joi.string().valid('left', 'center', 'right').optional(),
  padding: Joi.string().valid('none', 'small', 'medium', 'large').optional(),
  width: Joi.string().valid('full', 'contained', 'narrow').optional(),
  hiddenOn: Joi.array().items(Joi.string().valid('desktop', 'tablet', 'mobile')).unique().max(3).optional(),
  variant: Joi.string().valid('standard', 'editorial', 'split', 'feature-grid', 'lead-magnet', 'premium', 'minimal').optional(),
  mediaPosition: Joi.string().valid('none', 'left', 'right', 'background').optional(),
  columns: Joi.alternatives().try(Joi.string().valid('1', '2', '3'), Joi.number().integer().min(1).max(3)).optional(),
  cardStyle: Joi.string().valid('flat', 'bordered', 'elevated', 'glass').optional(),
}).unknown(false);

const storefrontStyleSchema = Joi.object({
  background: Joi.string().pattern(COLOR_VALUE_PATTERN).allow('').max(7).optional(),
  textColor: Joi.string().pattern(COLOR_VALUE_PATTERN).allow('').max(7).optional(),
  radius: Joi.string().valid('none', 'small', 'medium', 'large', 'full', 'default').optional(),
  shadow: Joi.string().valid('none', 'small', 'medium', 'large').optional(),
}).unknown(false);

export const storefrontBlockDataSchema = Joi.object({
  enabled: Joi.boolean().optional(),
  content: storefrontContentSchema.optional(),
  layout: storefrontLayoutSchema.optional(),
  style: storefrontStyleSchema.optional(),
}).unknown(false).default({});

const storefrontBlockSchema = Joi.object({
  id: Joi.string().trim().max(100).required(),
  type: Joi.string().trim().max(80).required(),
  data: storefrontBlockDataSchema,
}).unknown(false);

const storefrontBrandKitSchema = Joi.object({
  logo_url: Joi.string().uri({ scheme: ['http', 'https'] }).max(MAX_URL_LENGTH).allow(null, '').optional(),
  cover_url: Joi.string().uri({ scheme: ['http', 'https'] }).max(MAX_URL_LENGTH).allow(null, '').optional(),
  profile_photo_url: Joi.string().uri({ scheme: ['http', 'https'] }).max(MAX_URL_LENGTH).allow(null, '').optional(),
  logo_size: Joi.number().integer().min(24).max(72).allow(null).optional(),
  cover_position_x: Joi.number().min(0).max(100).optional(),
  cover_position_y: Joi.number().min(0).max(100).optional(),
  cover_zoom: Joi.number().min(1).max(3).optional(),
  profile_position_x: Joi.number().min(0).max(100).optional(),
  profile_position_y: Joi.number().min(0).max(100).optional(),
  profile_zoom: Joi.number().min(1).max(3).optional(),
  primary_color: Joi.string().pattern(COLOR_VALUE_PATTERN).allow(null, '').optional(),
  secondary_color: Joi.string().pattern(COLOR_VALUE_PATTERN).allow(null, '').optional(),
  accent_color: Joi.string().pattern(COLOR_VALUE_PATTERN).allow(null, '').optional(),
  font_family: Joi.string().trim().max(120).allow(null, '').optional(),
  business_name: Joi.string().trim().max(160).allow(null, '').optional(),
  button_shape: Joi.string().valid('square', 'rounded', 'pill').allow(null, '').optional(),
}).unknown(false);

const storefrontTemplateSchema = Joi.object({
  id: Joi.string().trim().max(100).allow(null, '').optional(),
  name: Joi.string().trim().max(120).allow(null, '').optional(),
  version: Joi.string().trim().max(40).allow(null, '').optional(),
}).unknown(false);

export const storefrontDraftSchema = Joi.object({
  blocks: Joi.array().items(storefrontBlockSchema).unique('id').max(60).optional(),
  brandKit: storefrontBrandKitSchema.optional(),
  template: storefrontTemplateSchema.optional(),
}).min(1);

export function allowedStorefrontBlockTypes(role) {
  return [...SHARED_BLOCK_TYPES, ...(ROLE_BLOCK_TYPES[role] || [])];
}

export function validateStorefrontDraftForRole(draft, role) {
  const { error, value } = storefrontDraftSchema.validate(draft, {
    abortEarly: false,
    convert: false,
  });
  if (error) return { error, value };

  const allowedBlockTypes = new Set(allowedStorefrontBlockTypes(role));
  const invalidBlockTypes = (value.blocks || [])
    .filter((block) => !allowedBlockTypes.has(block.type))
    .map((block) => block.type);
  if (!invalidBlockTypes.length) return { error: undefined, value };

  return {
    error: new Error(`Unsupported storefront block type for ${role}: ${invalidBlockTypes.join(', ')}`),
    value,
  };
}
