import Joi from 'joi';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import {
  LAWYER_INVESTOR_BLOCK_TYPES,
  LAWYER_INVESTOR_TEMPLATE_ID,
} from './lawyerInvestorStorefrontContract.js';
import {
  LAWYER_NEWCOMER_BLOCK_TYPES,
  LAWYER_NEWCOMER_TEMPLATE_ID,
} from './lawyerNewcomerStorefrontContract.js';

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
    'mortgage-rates',
    'lender-network',
    'broker-compensation',
    'alternative-lending',
    'credentials',
    'practice-snapshot',
    'faq',
  ],
  [PROFESSIONAL_TYPE.LAWYER]: [
    'practice-areas',
    'credentials',
    'who-we-help',
    'document-checklist',
    'fee-guidance',
    'consultation-options',
    'faq',
  ],
});

const SHARED_PROOF_BLOCK_TYPES = Object.freeze([
  'seller-performance',
  'seller-sold-results',
  'seller-case-study',
  'seller-credentials',
]);

const AGENT_SHARED_PROOF_TEMPLATE_IDS = new Set([
  'agent-seller-expert',
  'agent-luxury-advisor',
  'agent-first-home',
  'agent-community-expert',
  'agent-newcomer',
]);

const LAWYER_FIRST_HOME_TEMPLATE_ID = 'lawyer-first-home-closing';
const LAWYER_COMMERCIAL_TEMPLATE_ID = 'lawyer-commercial';
const LAWYER_FIRST_HOME_BLOCK_TYPES = Object.freeze([
  'engagement-scope',
  'practice-snapshot',
  'practice-logistics',
]);
const BROKER_CLASSIC_TEMPLATE_ID = 'mortgage_broker-classic';
const BROKER_CLASSIC_BLOCK_TYPES = Object.freeze([
  'hero',
  'about',
  'practice-snapshot',
  'mortgage-programs',
  'services',
  'role-details',
  'broker-compensation',
  'faq',
  'cta',
  'footer',
]);
const BROKER_RENEWAL_TEMPLATE_ID = 'mortgage_broker-renewal';
/** Free/default broker template — exactly 10 layers. */
const BROKER_RENEWAL_BLOCK_TYPES = Object.freeze([
  'hero',
  'practice-snapshot',
  'mortgage-programs',
  'services',
  'about',
  'guidance',
  'testimonials',
  'faq',
  'cta',
  'footer',
]);
const BROKER_FIRST_HOME_TEMPLATE_ID = 'mortgage_broker-first-home';
const BROKER_FIRST_HOME_BLOCK_TYPES = Object.freeze([
  'hero',
  'practice-snapshot',
  'mortgage-programs',
  'services',
  'about',
  'guidance',
  'mortgage-rates',
  'mortgage-calculator',
  'lender-network',
  'broker-compensation',
  'alternative-lending',
  'credentials',
  'testimonials',
  'faq',
  'cta',
  'footer',
]);
const BROKER_COMMERCIAL_TEMPLATE_ID = 'mortgage_broker-commercial';
const BROKER_COMMERCIAL_BLOCK_TYPES = Object.freeze([
  'hero',
  'practice-snapshot',
  'who-we-help',
  'mortgage-programs',
  'services',
  'role-details',
  'expertise',
  'about',
  'guidance',
  'mortgage-rates',
  'mortgage-calculator',
  'lender-network',
  'alternative-lending',
  'broker-compensation',
  'credentials',
  'testimonials',
  'faq',
  'cta',
  'footer',
]);
const BROKER_CLARITY_TEMPLATE_ID = 'mortgage_broker-clarity';
const BROKER_CLARITY_BLOCK_TYPES = Object.freeze([
  'hero',
  'mortgage-calculator',
  'about',
  'mortgage-programs',
  'services',
  'guidance',
  'credentials',
  'testimonials',
  'faq',
  'cta',
  'footer',
]);
const BROKER_BEACON_TEMPLATE_ID = 'mortgage_broker-beacon';
const BROKER_BEACON_BLOCK_TYPES = Object.freeze([
  'hero',
  'about',
  'mortgage-programs',
  'services',
  'guidance',
  'mortgage-calculator',
  'testimonials',
  'faq',
  'cta',
  'footer',
]);
const BROKER_EMBER_TEMPLATE_ID = 'mortgage_broker-ember';
const BROKER_EMBER_BLOCK_TYPES = Object.freeze([
  'hero',
  'about',
  'mortgage-programs',
  'services',
  'credentials',
  'guidance',
  'testimonials',
  'faq',
  'cta',
  'footer',
]);
const AGENT_REALEST_PRIME_TEMPLATE_ID = 'agent-realest-prime';
const AGENT_REALEST_PRIME_BLOCK_TYPES = Object.freeze([
  'hero',
  'role-details',
  'about',
  'services',
  'featured-listings',
  'expertise',
  'testimonials',
  'guidance',
  'cta',
  'footer',
]);
const AGENT_REALEST_PATH_TEMPLATE_ID = 'agent-realest-path';
const AGENT_REALEST_PATH_BLOCK_TYPES = Object.freeze([
  'hero',
  'about',
  'expertise',
  'guidance',
  'services',
  'featured-listings',
  'testimonials',
  'role-details',
  'cta',
  'footer',
]);
const MAX_CONTENT_DEPTH = 4;
// Heroes and specialty sections accumulate dual CTAs, design versions, slides,
// proof fields, and migration leftovers. 30 was rejecting newer templates.
const MAX_CONTENT_KEYS = 60;
const MAX_CONTENT_ITEMS = 30;
const MAX_CONTENT_TEXT_LENGTH = 2000;
const MAX_URL_LENGTH = 2048;
const COLOR_VALUE_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const EMPTY_SURFACE_COLORS = new Set(['transparent', 'none', 'inherit', 'initial']);
const SAFE_BLOCK_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const URL_KEY_PATTERN = /(?:url|uri|href|link|image|logo|target)$/i;
const MEDIA_URL_KEY_PATTERN = /(?:image|logo|photo|avatar|cover)(?:[_-]?(?:url|uri|href|link))?$/i;
const COLOR_KEY_PATTERN = /(?:color|colour|background)$/i;
const CSS_VAR_HEX_FALLBACK_PATTERN = /^var\(\s*--[a-zA-Z0-9_-]+\s*,\s*(#[0-9A-Fa-f]{3,8})\s*\)$/;

/** Normalize editable surface colors to #RRGGBB, or '' for empty tokens. null = invalid. */
function normalizeHexColorValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw || EMPTY_SURFACE_COLORS.has(raw.toLowerCase())) return '';

  const varFallback = raw.match(CSS_VAR_HEX_FALLBACK_PATTERN);
  const hexSource = varFallback ? varFallback[1] : raw;
  const withHash = hexSource.startsWith('#') ? hexSource : `#${hexSource}`;

  if (/^#[0-9A-Fa-f]{3}$/.test(withHash)) {
    const r = withHash[1];
    const g = withHash[2];
    const b = withHash[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(withHash)) return withHash;
  // Drop alpha from 8-digit hex so content/style stay on the shared #RRGGBB contract.
  if (/^#[0-9A-Fa-f]{8}$/.test(withHash)) return withHash.slice(0, 7);
  return null;
}

function coerceOptionalColor(value, helpers) {
  const normalized = normalizeHexColorValue(value);
  if (normalized === null) return helpers.error('string.pattern.base');
  return normalized;
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isSafeNavigationValue(value) {
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return false;
  if (value.startsWith('#')) return value.length > 1;
  if (value.startsWith('/')) {
    if (value.startsWith('//')) return false;
    try {
      const resolved = new URL(value, 'https://storefront.invalid');
      return resolved.origin === 'https://storefront.invalid';
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeStorefrontContent(value, depth = 0, key = '') {
  if (value === null || typeof value === 'boolean') {
    return { value, error: null };
  }

  if (typeof value === 'string') {
    if (value.length > (URL_KEY_PATTERN.test(key) ? MAX_URL_LENGTH : MAX_CONTENT_TEXT_LENGTH)) {
      return { value, error: 'contains text that is too long' };
    }
    if (URL_KEY_PATTERN.test(key) && value) {
      if (!MEDIA_URL_KEY_PATTERN.test(key) && isSafeNavigationValue(value)) {
        return { value, error: null };
      }
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return { value, error: 'contains a URL with an unsupported protocol' };
        }
      } catch {
        return { value, error: 'contains an invalid URL' };
      }
    }
    if (COLOR_KEY_PATTERN.test(key) && value) {
      const normalized = normalizeHexColorValue(value);
      if (normalized === null) {
        const field = key ? `"${key}"` : 'a color field';
        return { value, error: `${field} contains an invalid color` };
      }
      return { value: normalized, error: null };
    }
    return { value, error: null };
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= -1000000 && value <= 1000000
      ? { value, error: null }
      : { value, error: 'contains a number outside the supported range' };
  }

  if (depth >= MAX_CONTENT_DEPTH) {
    return { value, error: 'is nested too deeply' };
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_CONTENT_ITEMS) {
      return { value, error: 'contains too many items' };
    }
    const next = [];
    for (const item of value) {
      const result = sanitizeStorefrontContent(item, depth + 1, key);
      if (result.error) return result;
      next.push(result.value);
    }
    return { value: next, error: null };
  }

  if (!isPlainObject(value)) {
    return { value, error: 'must contain only JSON-compatible values' };
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_CONTENT_KEYS) {
    return { value, error: 'contains too many fields' };
  }
  const next = {};
  for (const [childKey, childValue] of entries) {
    if (!childKey || childKey.length > 80 || ['__proto__', 'constructor', 'prototype'].includes(childKey)) {
      return { value, error: 'contains an invalid field name' };
    }
    const result = sanitizeStorefrontContent(childValue, depth + 1, childKey);
    if (result.error) return result;
    next[childKey] = result.value;
  }
  return { value: next, error: null };
}

const storefrontContentSchema = Joi.object()
  .custom((value, helpers) => {
    const { value: next, error } = sanitizeStorefrontContent(value);
    return error ? helpers.message(`{{#label}} ${error}`) : next;
  })
  .default({});

const storefrontCssColorSchema = Joi.string()
  .max(40)
  .pattern(/^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/);
const storefrontCssLengthSchema = Joi.string()
  .max(24)
  .pattern(/^\d{1,4}(?:\.\d+)?(?:px|rem|em|%)$/);
const storefrontStyleMapKeyPattern = /^(?!__proto__$|constructor$|prototype$)[\s\S]{1,240}$/;
const storefrontElementStyleSchema = Joi.object({
  fontFamily: Joi.string().max(80).pattern(/^[a-zA-Z0-9 ,"'._-]+$/).optional(),
  fontSize: storefrontCssLengthSchema.optional(),
  fontWeight: Joi.string().valid('300', '400', '500', '600', '650', '700', '800').optional(),
  fontStyle: Joi.string().valid('normal', 'italic').optional(),
  textDecoration: Joi.string().max(24).pattern(/^(?:underline|line-through)(?: (?:underline|line-through))*$/).optional(),
  color: storefrontCssColorSchema.optional(),
  backgroundColor: storefrontCssColorSchema.optional(),
  lineHeight: Joi.string().max(8).pattern(/^(?:0|[1-9]\d?)(?:\.\d+)?$/).optional(),
  letterSpacing: Joi.string().max(24).pattern(/^-?\d{1,4}(?:\.\d+)?(?:px|rem|em|%)$/).optional(),
  textTransform: Joi.string().valid('none', 'uppercase', 'lowercase', 'capitalize').optional(),
  textAlign: Joi.string().valid('left', 'center', 'right', 'justify').optional(),
  borderRadius: storefrontCssLengthSchema.optional(),
  width: storefrontCssLengthSchema.optional(),
  height: storefrontCssLengthSchema.optional(),
  objectFit: Joi.string().valid('cover', 'contain', 'fill', 'none', 'scale-down').optional(),
  aspectRatio: Joi.string().valid('1 / 1', '4 / 3', '3 / 4', '16 / 9', '9 / 16').optional(),
  padding: storefrontCssLengthSchema.optional(),
  borderWidth: storefrontCssLengthSchema.optional(),
  borderColor: storefrontCssColorSchema.optional(),
  paddingLeft: storefrontCssLengthSchema.optional(),
  textRole: Joi.string().valid('p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote').optional(),
  linkHref: Joi.string().trim().max(500)
    .custom((value, helpers) => (
      isSafeNavigationValue(value) ? value : helpers.error('any.invalid')
    ))
    .optional(),
}).min(1).unknown(false);
const storefrontElementStylesSchema = Joi.object()
  .pattern(storefrontStyleMapKeyPattern, storefrontElementStyleSchema)
  .max(80)
  .unknown(false);
const storefrontRichTextSchema = Joi.object()
  .pattern(
    storefrontStyleMapKeyPattern,
    Joi.string().max(20000).custom((value, helpers) => (
      /<\s*script|javascript:|on\w+\s*=/i.test(value)
        ? helpers.error('any.invalid')
        : value
    )),
  )
  .max(80)
  .unknown(false);
const storefrontChromeSchema = Joi.object({
  background: storefrontCssColorSchema.optional(),
  radius: storefrontCssLengthSchema.optional(),
  marginY: storefrontCssLengthSchema.optional(),
  borderWidth: storefrontCssLengthSchema.optional(),
  borderColor: storefrontCssColorSchema.optional(),
  minHeight: storefrontCssLengthSchema.optional(),
}).min(1).unknown(false);

const storefrontLayoutSchema = Joi.object({
  alignment: Joi.string().valid('left', 'center', 'right').optional(),
  contentAlignment: Joi.string().valid('left', 'center', 'right').optional(),
  padding: Joi.string().valid('none', 'small', 'medium', 'large').optional(),
  width: Joi.string().valid('full', 'contained', 'narrow').optional(),
  hiddenOn: Joi.array().items(Joi.string().valid('desktop', 'tablet', 'mobile')).unique().max(3).optional(),
  hiddenFields: Joi.array()
    .items(Joi.string().pattern(/^content\.[a-z_]+(::[A-Za-z0-9_-]+)?$/))
    .unique()
    .max(24)
    .optional(),
  variant: Joi.string().valid('standard', 'editorial', 'split', 'feature-grid', 'lead-magnet', 'premium', 'minimal').optional(),
  mediaPosition: Joi.string().valid('none', 'left', 'right', 'background', 'portrait', 'cover').optional(),
  columns: Joi.alternatives().try(
    Joi.string().valid('1', '2', '3', '4'),
    Joi.number().integer().min(1).max(4),
  ).optional(),
  cardStyle: Joi.string().valid('flat', 'bordered', 'elevated', 'glass').optional(),
  animationType: Joi.string().valid('none', 'fade', 'slide-up', 'slide-left', 'zoom').optional(),
  animationTrigger: Joi.string().valid('load', 'scroll').optional(),
  animationDuration: Joi.string().valid('fast', 'medium', 'slow').optional(),
  animationDelay: Joi.alternatives().try(
    Joi.string().valid('0', '80', '160', '240', '320', '480'),
    Joi.number().integer().min(0).max(10000),
  ).optional(),
  animationIntensity: Joi.string().valid('subtle', 'medium', 'strong').optional(),
  buttonLayout: Joi.string().valid('inline', 'stacked').optional(),
  navigator: Joi.object({
    labels: Joi.object()
      .pattern(/^[A-Za-z0-9_.:-]{1,80}$/, Joi.string().trim().max(80))
      .max(48)
      .optional(),
    hidden: Joi.array()
      .items(Joi.string().pattern(/^[A-Za-z0-9_.:-]{1,80}$/))
      .unique()
      .max(48)
      .optional(),
    devices: Joi.object()
      .pattern(
        /^[A-Za-z0-9_.:-]{1,80}$/,
        Joi.array().items(Joi.string().valid('desktop', 'tablet', 'mobile')).unique().max(3),
      )
      .max(48)
      .optional(),
  }).optional(),
  elementStyles: storefrontElementStylesSchema.optional(),
  richText: storefrontRichTextSchema.optional(),
  chrome: storefrontChromeSchema.optional(),
}).unknown(false);

const storefrontStyleSchema = Joi.object({
  background: Joi.string().allow('').max(32).custom(coerceOptionalColor).optional(),
  textColor: Joi.string().allow('').max(32).custom(coerceOptionalColor).optional(),
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
  id: Joi.string().trim().max(100).pattern(SAFE_BLOCK_IDENTIFIER_PATTERN).required(),
  type: Joi.string().trim().max(80).pattern(SAFE_BLOCK_IDENTIFIER_PATTERN).required(),
  data: storefrontBlockDataSchema,
}).unknown(false);

const storefrontBrandKitSchema = Joi.object({
  logo_url: Joi.string().uri({ scheme: ['http', 'https'] }).max(MAX_URL_LENGTH).allow(null, '').optional(),
  logo_dark_url: Joi.string().uri({ scheme: ['http', 'https'] }).max(MAX_URL_LENGTH).allow(null, '').optional(),
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
  page_background: Joi.string().pattern(COLOR_VALUE_PATTERN).allow(null, '').optional(),
  font_family: Joi.string().trim().max(120).allow(null, '').optional(),
  business_name: Joi.string().trim().max(160).allow(null, '').optional(),
  button_shape: Joi.string().valid('square', 'rounded', 'pill').allow(null, '').optional(),
  image_style: Joi.string().trim().max(80).allow(null, '').optional(),
  essentials: Joi.object().unknown(true).max(20).optional(),
  show_chatbot: Joi.boolean().optional(),
}).unknown(false);

const storefrontTemplateSchema = Joi.object({
  id: Joi.string().trim().max(100).allow(null, '').optional(),
  name: Joi.string().trim().max(120).allow(null, '').optional(),
  version: Joi.string().trim().max(40).allow(null, '').optional(),
}).unknown(false);

const storefrontSeoSchema = Joi.object({
  title: Joi.string().trim().max(60).allow(null, '').optional(),
  description: Joi.string().trim().max(160).allow(null, '').optional(),
  keywords: Joi.array().items(Joi.string().trim().max(50)).unique().max(8).optional(),
}).unknown(false);

function assertSafeWebsiteHref(value, helpers) {
  if (value === undefined || value === null || value === '') return value || '';
  const href = String(value);
  const allowed = (href.startsWith('/') && !href.startsWith('//'))
    || /^https?:\/\//i.test(href)
    || /^(mailto|tel):/i.test(href);
  if (!allowed) return helpers.error('any.invalid');
  return href;
}

const websiteFieldSchema = Joi.object({
  key: Joi.string().trim().max(40).pattern(/^[a-z][a-z0-9_]*$/).required(),
  label: Joi.string().trim().max(80).required(),
  type: Joi.string().valid('text', 'email', 'tel', 'textarea', 'select').required(),
  required: Joi.boolean().optional(),
  options: Joi.array().items(Joi.string().trim().max(80)).max(12).optional(),
}).unknown(false);

const websiteFormSchema = Joi.object({
  intent: Joi.string().trim().max(40).required(),
  submit_label: Joi.string().trim().max(80).allow('').optional(),
  success_message: Joi.string().trim().max(400).allow('').optional(),
  redirect_page_id: Joi.string().trim().max(80).allow('', null).optional(),
  fields: Joi.array().items(websiteFieldSchema).max(12).required(),
}).unknown(false);

const websiteNavLeafSchema = Joi.object({
  id: Joi.string().trim().max(80).pattern(SAFE_BLOCK_IDENTIFIER_PATTERN).required(),
  label: Joi.string().trim().max(80).required(),
  kind: Joi.string().valid('page', 'external').required(),
  page_id: Joi.string().trim().max(80).allow('').optional(),
  href: Joi.string().trim().max(500).allow('').custom(assertSafeWebsiteHref).optional(),
  visible: Joi.boolean().optional(),
}).unknown(false);

const websiteNavItemSchema = websiteNavLeafSchema.keys({
  children: Joi.array().items(websiteNavLeafSchema).max(8).optional(),
});

const websitePageSchema = Joi.object({
  id: Joi.string().trim().max(80).pattern(SAFE_BLOCK_IDENTIFIER_PATTERN).required(),
  name: Joi.string().trim().max(80).required(),
  slug: Joi.string().trim().max(60).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).required(),
  type: Joi.string().trim().max(40).required(),
  status: Joi.string().valid('draft', 'published').optional(),
  updated_at: Joi.string().isoDate().allow(null, '').optional(),
  seo: storefrontSeoSchema.optional(),
  form: websiteFormSchema.allow(null).optional(),
  blocks: Joi.array().items(storefrontBlockSchema).unique('id').max(40).default([]),
}).unknown(false);

const websiteSchema = Joi.object({
  name: Joi.string().trim().max(160).allow('').optional(),
  active_page_id: Joi.string().trim().max(80).allow('').optional(),
  styles: Joi.object({
    container: Joi.string().valid('narrow', 'standard', 'wide').optional(),
    section_spacing: Joi.string().valid('compact', 'comfortable', 'spacious').optional(),
    radius: Joi.string().valid('none', 'small', 'medium', 'large').optional(),
    shadow: Joi.string().valid('none', 'small', 'medium', 'large').optional(),
  }).unknown(false).optional(),
  settings: Joi.object({
    favicon_url: Joi.string().uri({ scheme: ['http', 'https'] }).max(MAX_URL_LENGTH).allow('', null).optional(),
    seo_title: Joi.string().trim().max(60).allow('').optional(),
    seo_description: Joi.string().trim().max(160).allow('').optional(),
    header_variant: Joi.string().valid('standard', 'contact_bar', 'editorial', 'modern', 'atelier').optional(),
    footer_variant: Joi.string().valid('signature', 'editorial', 'columns', 'contact', 'minimal').optional(),
    header_phone: Joi.string().trim().max(80).allow('', null).optional(),
    header_email: Joi.string().trim().email().max(160).allow('', null).optional(),
    header_location: Joi.string().trim().max(160).allow('', null).optional(),
  }).unknown(false).optional(),
  navigation: Joi.object({
    header: Joi.array().items(websiteNavItemSchema).max(24).default([]),
    footer: Joi.array().items(websiteNavItemSchema).max(24).default([]),
  }).unknown(false).optional(),
  pages: Joi.array().items(websitePageSchema).unique('id').max(24).required(),
}).unknown(false);

export const storefrontDraftSchema = Joi.object({
  blocks: Joi.array().items(storefrontBlockSchema).unique('id').max(60).optional(),
  brandKit: storefrontBrandKitSchema.optional(),
  template: storefrontTemplateSchema.optional(),
  seo_meta: storefrontSeoSchema.optional(),
  website: websiteSchema.optional(),
  revision_id: Joi.string().trim().max(80).allow(null, '').optional(),
  revision_version: Joi.number().integer().min(0).optional(),
}).min(1);

export function allowedStorefrontBlockTypes(role, templateId = '') {
  if (
    role === PROFESSIONAL_TYPE.LAWYER
    && templateId === LAWYER_INVESTOR_TEMPLATE_ID
  ) {
    return [...LAWYER_INVESTOR_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.LAWYER
    && templateId === LAWYER_NEWCOMER_TEMPLATE_ID
  ) {
    return [...LAWYER_NEWCOMER_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.MORTGAGE_BROKER
    && templateId === BROKER_CLASSIC_TEMPLATE_ID
  ) {
    return [...BROKER_CLASSIC_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.MORTGAGE_BROKER
    && templateId === BROKER_RENEWAL_TEMPLATE_ID
  ) {
    return [...BROKER_RENEWAL_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.MORTGAGE_BROKER
    && templateId === BROKER_FIRST_HOME_TEMPLATE_ID
  ) {
    return [...BROKER_FIRST_HOME_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.MORTGAGE_BROKER
    && templateId === BROKER_COMMERCIAL_TEMPLATE_ID
  ) {
    return [...BROKER_COMMERCIAL_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.MORTGAGE_BROKER
    && templateId === BROKER_CLARITY_TEMPLATE_ID
  ) {
    return [...BROKER_CLARITY_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.MORTGAGE_BROKER
    && templateId === BROKER_BEACON_TEMPLATE_ID
  ) {
    return [...BROKER_BEACON_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.MORTGAGE_BROKER
    && templateId === BROKER_EMBER_TEMPLATE_ID
  ) {
    return [...BROKER_EMBER_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.AGENT
    && templateId === AGENT_REALEST_PRIME_TEMPLATE_ID
  ) {
    return [...AGENT_REALEST_PRIME_BLOCK_TYPES];
  }
  if (
    role === PROFESSIONAL_TYPE.AGENT
    && templateId === AGENT_REALEST_PATH_TEMPLATE_ID
  ) {
    return [...AGENT_REALEST_PATH_BLOCK_TYPES];
  }
  return [
    ...SHARED_BLOCK_TYPES,
    ...(ROLE_BLOCK_TYPES[role] || []),
    ...(role === PROFESSIONAL_TYPE.AGENT && AGENT_SHARED_PROOF_TEMPLATE_IDS.has(templateId)
      ? SHARED_PROOF_BLOCK_TYPES
      : []),
    ...(role === PROFESSIONAL_TYPE.LAWYER && templateId === LAWYER_FIRST_HOME_TEMPLATE_ID
      ? LAWYER_FIRST_HOME_BLOCK_TYPES
      : []),
    ...(role === PROFESSIONAL_TYPE.LAWYER && templateId === LAWYER_COMMERCIAL_TEMPLATE_ID
      ? ['practice-snapshot']
      : []),
  ];
}

const INVESTOR_COLLECTION_POLICY = Object.freeze({
  services: { key: 'items', limit: 6, requiredText: 'title' },
  'practice-areas': { key: 'items', limit: 6, requiredText: 'title' },
  'role-details': { key: 'highlights', limit: 6, requiredText: 'title' },
  guidance: { key: 'steps', limit: 6, requiredText: 'title' },
  footer: { key: 'items', limit: 8, requiredText: 'label' },
});

const NEWCOMER_COLLECTION_POLICY = Object.freeze({
  services: { key: 'items', limit: 6, requiredText: 'title' },
  'practice-areas': { key: 'items', limit: 6, requiredText: 'title' },
  guidance: { key: 'steps', limit: 6, requiredText: 'title' },
  testimonials: { key: 'items', limit: 8, requiredText: 'client_name' },
  footer: { key: 'items', limit: 8, requiredText: 'label' },
});

function investorCollectionError(block) {
  const policy = INVESTOR_COLLECTION_POLICY[block.type];
  if (!policy) return null;
  const content = block?.data?.content || {};
  if (!Object.hasOwn(content, policy.key)) return null;
  const items = content[policy.key];
  if (!Array.isArray(items)) {
    return `${block.type}.${policy.key} must be an array`;
  }
  if (items.length > policy.limit) {
    return `${block.type}.${policy.key} must contain no more than ${policy.limit} items`;
  }
  const itemIds = new Set();
  for (const item of items) {
    if (!isPlainObject(item)) {
      return `${block.type}.${policy.key} items must be objects`;
    }
    if (
      typeof item[policy.requiredText] !== 'string'
      || !item[policy.requiredText].trim()
      || item[policy.requiredText].length > 120
    ) {
      return `${block.type}.${policy.key} items require a valid ${policy.requiredText}`;
    }
    if (
      typeof item.id !== 'string'
      || item.id.length > 100
      || !SAFE_BLOCK_IDENTIFIER_PATTERN.test(item.id)
    ) {
      return `${block.type}.${policy.key} items contain an invalid id`;
    }
    if (itemIds.has(item.id)) {
      return `${block.type}.${policy.key} item ids must be unique`;
    }
    itemIds.add(item.id);
    for (const textKey of ['description', 'text', 'cta_text', 'icon', 'label', 'target', 'url', 'href']) {
      if (item[textKey] !== undefined && typeof item[textKey] !== 'string') {
        return `${block.type}.${policy.key} item ${textKey} must be a string`;
      }
    }
    for (const booleanKey of ['link_disabled', 'enabled']) {
      if (item[booleanKey] !== undefined && typeof item[booleanKey] !== 'boolean') {
        return `${block.type}.${policy.key} item ${booleanKey} must be a boolean`;
      }
    }
    if (block.type === 'footer') {
      const destination = item.target ?? item.url ?? item.href;
      if (destination !== undefined && destination !== '' && !isSafeNavigationValue(destination)) {
        return 'footer.items contains an unsafe link';
      }
    }
    if (block.type === 'testimonials') {
      if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 1000) {
        return 'testimonials.items require valid text';
      }
      if (item.rating !== undefined && (
        !Number.isFinite(Number(item.rating))
        || Number(item.rating) < 1
        || Number(item.rating) > 5
      )) {
        return 'testimonials.items rating must be between 1 and 5';
      }
    }
  }
  return null;
}

const INVESTOR_METRICS = Object.freeze(['pipeline', 'experience', 'clients', 'cases']);
const INVESTOR_METRIC_SET = new Set(INVESTOR_METRICS);
const INVESTOR_SNAPSHOT_TEXT_FIELDS = Object.freeze([
  'practice_focus_label',
  'practice_focus_subtitle',
  'markets_label',
  'markets_subtitle',
  'languages_label',
  'languages_subtitle',
]);

function investorMetricArrayError(content, key) {
  if (!Object.hasOwn(content, key)) return null;
  const value = content[key];
  if (!Array.isArray(value) || value.length > INVESTOR_METRICS.length) {
    return `credentials.${key} must be an array with no more than ${INVESTOR_METRICS.length} items`;
  }
  if (new Set(value).size !== value.length || value.some((metric) => !INVESTOR_METRIC_SET.has(metric))) {
    return `credentials.${key} must contain unique supported metric names`;
  }
  return null;
}

function investorMetricMapError(content, key) {
  if (!Object.hasOwn(content, key)) return null;
  const value = content[key];
  if (!isPlainObject(value)) return `credentials.${key} must be an object`;
  for (const [metric, label] of Object.entries(value)) {
    if (!INVESTOR_METRIC_SET.has(metric) || typeof label !== 'string' || label.length > 120) {
      return `credentials.${key} must contain supported metric string values`;
    }
  }
  return null;
}

function investorBlockSemanticError(block) {
  const content = block?.data?.content || {};
  const collectionError = investorCollectionError(block);
  if (collectionError) return collectionError;

  if (block.type === 'hero' && Object.hasOwn(content, 'investor_design_version')) {
    if (typeof content.investor_design_version !== 'number'
      || !Number.isFinite(content.investor_design_version)
      || content.investor_design_version < 0) {
      return 'hero.investor_design_version must be a finite non-negative number';
    }
  }
  if (block.type === 'practice-snapshot') {
    for (const key of INVESTOR_SNAPSHOT_TEXT_FIELDS) {
      if (content[key] !== undefined && typeof content[key] !== 'string') {
        return `practice-snapshot.${key} must be a string`;
      }
    }
  }
  if (block.type === 'credentials') {
    return investorMetricArrayError(content, 'metric_order')
      || investorMetricArrayError(content, 'hidden_metrics')
      || investorMetricMapError(content, 'metric_icons')
      || investorMetricMapError(content, 'metric_labels');
  }
  if (block.type === 'footer') {
    for (const key of ['show_email', 'show_phone', 'show_booking']) {
      if (content[key] !== undefined && typeof content[key] !== 'boolean') {
        return `footer.${key} must be a boolean`;
      }
    }
  }
  return null;
}

function newcomerCollectionError(block) {
  const policy = NEWCOMER_COLLECTION_POLICY[block.type];
  if (!policy) return null;
  const content = block?.data?.content || {};
  if (!Object.hasOwn(content, policy.key)) return null;
  const items = content[policy.key];
  if (!Array.isArray(items)) {
    return `${block.type}.${policy.key} must be an array`;
  }
  if (items.length > policy.limit) {
    return `${block.type}.${policy.key} must contain no more than ${policy.limit} items`;
  }
  const itemIds = new Set();
  for (const item of items) {
    if (!isPlainObject(item)) {
      return `${block.type}.${policy.key} items must be objects`;
    }
    if (
      typeof item[policy.requiredText] !== 'string'
      || !item[policy.requiredText].trim()
      || item[policy.requiredText].length > 120
    ) {
      return `${block.type}.${policy.key} items require a valid ${policy.requiredText}`;
    }
    if (
      typeof item.id !== 'string'
      || item.id.length > 100
      || !SAFE_BLOCK_IDENTIFIER_PATTERN.test(item.id)
    ) {
      return `${block.type}.${policy.key} items contain an invalid id`;
    }
    if (itemIds.has(item.id)) {
      return `${block.type}.${policy.key} item ids must be unique`;
    }
    itemIds.add(item.id);
    if (block.type === 'footer') {
      const destination = item.target ?? item.url ?? item.href;
      if (destination !== undefined && destination !== '' && !isSafeNavigationValue(destination)) {
        return 'footer.items contains an unsafe link';
      }
    }
  }
  return null;
}

function newcomerBlockSemanticError(block) {
  const content = block?.data?.content || {};
  const collectionError = newcomerCollectionError(block);
  if (collectionError) return collectionError;
  if (block.type === 'hero' && Object.hasOwn(content, 'newcomer_design_version')) {
    if (
      typeof content.newcomer_design_version !== 'number'
      || !Number.isFinite(content.newcomer_design_version)
      || content.newcomer_design_version < 0
    ) {
      return 'hero.newcomer_design_version must be a finite non-negative number';
    }
  }
  if (block.type === 'footer') {
    for (const key of ['show_email', 'show_phone', 'show_booking']) {
      if (content[key] !== undefined && typeof content[key] !== 'boolean') {
        return `footer.${key} must be a boolean`;
      }
    }
  }
  return null;
}

export function validateStorefrontDraftForRole(draft, role) {
  const { error, value } = storefrontDraftSchema.validate(draft, {
    abortEarly: false,
    convert: false,
  });
  if (error) return { error, value };

  const allowedBlockTypes = new Set([
    ...allowedStorefrontBlockTypes(role, value.template?.id),
    'ui-element',
  ]);
  const invalidBlockTypes = (value.blocks || [])
    .filter((block) => !allowedBlockTypes.has(block.type))
    .map((block) => block.type);
  if (invalidBlockTypes.length) {
    return {
      error: new Error(`Unsupported storefront block type for ${role}: ${invalidBlockTypes.join(', ')}`),
      value,
    };
  }

  for (const page of value.website?.pages || []) {
    const invalidPageBlocks = (page.blocks || [])
      .filter((block) => !allowedBlockTypes.has(block.type))
      .map((block) => block.type);
    if (invalidPageBlocks.length) {
      return {
        error: new Error(`Unsupported storefront block type on ${page.name}: ${invalidPageBlocks.join(', ')}`),
        value,
      };
    }
  }

  if (
    role === PROFESSIONAL_TYPE.LAWYER
    && value.template?.id === LAWYER_INVESTOR_TEMPLATE_ID
  ) {
    for (const requiredType of ['hero', 'footer']) {
      const count = (value.blocks || []).filter((block) => block.type === requiredType).length;
      if (count !== 1) {
        return {
          error: new Error(`Lawyer Investor storefront requires exactly one ${requiredType} block`),
          value,
        };
      }
    }
    for (const block of value.blocks || []) {
      const semanticError = investorBlockSemanticError(block);
      if (semanticError) {
        return { error: new Error(semanticError), value };
      }
    }
  }
  if (
    role === PROFESSIONAL_TYPE.LAWYER
    && value.template?.id === LAWYER_NEWCOMER_TEMPLATE_ID
  ) {
    for (const block of value.blocks || []) {
      const semanticError = newcomerBlockSemanticError(block);
      if (semanticError) {
        return { error: new Error(semanticError), value };
      }
    }
  }

  return { error: undefined, value };
}
