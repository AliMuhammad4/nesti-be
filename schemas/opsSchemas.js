import {
  CALENDAR_PROVIDERS,
  ENTERPRISE_INQUIRY_STATUSES,
  NURTURE_LOG_STATUSES,
  REFERRAL_STATUSES,
} from '../constants/validationEnums.js';
import { Joi, isoDate, objectId, str } from './common.js';

export const referralCreateSchema = Joi.object({
  user_id: objectId.required(),
  target_user_id: objectId.required(),
  conversation_id: objectId.required(),
  target_vertical: Joi.string().required(),
  status: Joi.string().valid(...REFERRAL_STATUSES).default('pending'),
  notes: str,
});

export const referralUpdateSchema = referralCreateSchema.fork(
  ['user_id', 'target_user_id', 'conversation_id', 'target_vertical'],
  (s) => s.optional()
);

export const nurtureLogCreateSchema = Joi.object({
  user_id: objectId.required(),
  conversation_id: objectId.required(),
  to_email: Joi.string().email().required(),
  subject: Joi.string().required(),
  body: Joi.string().required(),
  sent_at: isoDate,
  status: Joi.string().valid(...NURTURE_LOG_STATUSES).default('sent'),
});

export const nurtureLogUpdateSchema = nurtureLogCreateSchema.fork(
  ['user_id', 'conversation_id', 'to_email', 'subject', 'body'],
  (s) => s.optional()
);

export const enterpriseInquiryCreateSchema = Joi.object({
  user_id: objectId.optional().allow(null, ''),
  company_name: Joi.string().allow('', null),
  team_size: Joi.number().integer().min(0),
  message: str,
  status: Joi.string().valid(...ENTERPRISE_INQUIRY_STATUSES).default('pending'),
  email: Joi.string().email().allow('', null),
  phone: str.max(40),
  full_name: str.max(160),
  interest_role: Joi.string().valid('agent', 'mortgage_broker', 'lawyer', 'client', '').allow(null, ''),
  source: Joi.string().valid('demo', 'contact', 'inquiry', 'support', 'direct_inquiry').default('inquiry'),
  city: Joi.string().allow('', null).max(120),
  country: Joi.string().allow('', null).max(80),
  inquiry_topic: Joi.string().valid('demo', 'inquiry', 'support', '').allow(null),
});

export const enterpriseInquiryUpdateSchema = enterpriseInquiryCreateSchema.fork(
  ['user_id', 'company_name'],
  (s) => s.optional()
);

export const adminPipelineStageSchema = Joi.object({
  stage: Joi.string().valid('new', 'calling', 'ready', 'closed').required(),
});

export const adminPipelineRoleSchema = Joi.object({
  role: Joi.string().valid('client', 'agent', 'broker', 'mortgage_broker', 'lawyer', 'visitor').required(),
});

export const adminSalesLeadCloseSchema = Joi.object({
  outcome: Joi.string().valid('won', 'lost').required(),
  note: Joi.string().trim().allow('', null).max(1000),
});

export const adminSalesLeadEmailSendSchema = Joi.object({
  subject: Joi.string().trim().min(1).max(200).required(),
  body: Joi.string().trim().min(1).max(6000).required(),
});

const LANDING_PERSONALITIES = ['friendly', 'executive', 'consultative', 'sales', 'luxury', 'caring'];
const LANDING_FORMALITIES = ['formal', 'professional', 'casual'];
const landingText = (max) => Joi.string().trim().allow('', null).max(max);
const landingStringList = (maxItems, maxLength) => Joi.array().items(
  Joi.string().trim().allow('').max(maxLength),
).max(maxItems);
const landingRoleCustomizationSchema = Joi.object({
  enabled: Joi.boolean(),
  personalities: landingStringList(8, 80),
  custom_tones: Joi.array().items(Joi.object({
    id: Joi.string().trim().max(80).allow(''),
    name: Joi.string().trim().max(80).allow(''),
    guidance: Joi.string().trim().max(500).allow(''),
  }).unknown(true)).max(12),
  languages: landingStringList(30, 80),
  auto_detect_language: Joi.boolean(),
  communication_style: Joi.string().trim().max(40).allow('', null),
  use_emojis: Joi.boolean(),
  address_by_first_name: Joi.boolean(),
  focus_areas: landingStringList(30, 200),
  differentiators: landingStringList(20, 200),
  difference_line: landingText(500),
  custom_guidance: landingText(4000),
  website_reference: landingText(4000),
  services_pricing: landingText(4000),
  qualification_questions: landingStringList(12, 80),
  contact_fields: landingStringList(8, 40),
  next_actions: landingStringList(12, 40),
  faqs: Joi.array().items(Joi.object({
    question: Joi.string().trim().allow('').max(240),
    answer: Joi.string().trim().allow('').max(1200),
  }).unknown(true)).max(20),
}).unknown(true);

const landingRoleCustomizationsSchema = Joi.object({
  client: landingRoleCustomizationSchema,
  investor: landingRoleCustomizationSchema,
  agent: landingRoleCustomizationSchema,
  broker: landingRoleCustomizationSchema,
  lawyer: landingRoleCustomizationSchema,
}).unknown(true);

const landingChatSettingsFields = {
  enabled: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')),
  welcome_message: landingText(2000),
  bot_name: landingText(40),
  display_name: landingText(80),
  bot_persona_title: landingText(80),
  personality: Joi.string().valid(...LANDING_PERSONALITIES),
  formality: Joi.string().valid(...LANDING_FORMALITIES),
  consent_line: landingText(400),
  signup_cta_copy: landingText(400),
  client_guide: landingText(2000),
  agent_guide: landingText(2000),
  broker_guide: landingText(2000),
  lawyer_guide: landingText(2000),
  role_customizations: landingRoleCustomizationsSchema,
  auto_welcome_followup: Joi.boolean(),
  dual_write_inquiry: Joi.boolean(),
};

// The admin UI echoes read-only view fields (seeds, personalities, ...) back;
// validateBody runs with stripUnknown so those are dropped rather than rejected.
export const landingChatSettingsSchema = Joi.object(landingChatSettingsFields);

export const landingChatPreviewSchema = Joi.object({
  role: Joi.string().valid('client', 'investor', 'agent', 'broker', 'mortgage_broker', 'lawyer').default('client'),
  message: Joi.string().trim().max(2000).allow('', null),
  conversation_history: Joi.array().items(Joi.object({
    speaker: Joi.string().valid('visitor', 'assistant').required(),
    text: Joi.string().trim().max(1200).required(),
  })).max(12).default([]),
  opening: Joi.boolean().default(false),
  visitor_name: landingText(60),
  settings: Joi.object().unknown(true).default({}),
});

export const landingChatFaqGenerateSchema = Joi.object({
  role: Joi.string().valid('client', 'investor', 'agent', 'broker', 'lawyer').required(),
  role_customization: landingRoleCustomizationSchema.default({}),
});

export const calendarIntegrationCreateSchema = Joi.object({
  user_id: objectId.required(),
  provider: Joi.string().valid(...CALENDAR_PROVIDERS).required(),
  access_token: Joi.string().required(),
  refresh_token: str,
  expires_at: isoDate,
  account_email: Joi.string().email().allow('', null),
  calendly_slug: str,
  calendly_slug_mismatch: Joi.boolean().default(false),
});

export const calendarIntegrationUpdateSchema = calendarIntegrationCreateSchema.fork(
  ['user_id', 'provider', 'access_token'],
  (s) => s.optional()
);

export const visitorCreateSchema = Joi.object({
  uuid: Joi.string().required(),
  embed_token: str,
  user_agent: str,
  client_ip: str,
  last_seen_at: isoDate,
});

export const visitorUpdateSchema = visitorCreateSchema.fork(['uuid'], (s) => s.optional());
