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
  user_id: objectId.required(),
  company_name: Joi.string().required(),
  team_size: Joi.number().integer().min(0),
  message: str,
  status: Joi.string().valid(...ENTERPRISE_INQUIRY_STATUSES).default('pending'),
});

export const enterpriseInquiryUpdateSchema = enterpriseInquiryCreateSchema.fork(
  ['user_id', 'company_name'],
  (s) => s.optional()
);

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
