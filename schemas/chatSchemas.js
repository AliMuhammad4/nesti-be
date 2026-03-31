import { PROFESSIONAL_TYPE_VALUES, WIDGET_AGENT_TYPE_VALUES } from '../constants/roles.js';
import {
  CALENDLY_BOOKING_STATUSES,
  CHAT_INTENTS,
  CHAT_MESSAGE_ROLES,
  LEAD_CLASSIFICATIONS,
  LEAD_GRADES,
  POST_BOOKING_RUN_STATUSES,
} from '../constants/validationEnums.js';
import { Joi, anyObj, isoDate, objectId, str } from './common.js';

export const chatConversationCreateSchema = Joi.object({
  session_id: Joi.string().required(),
  user_id: objectId.required(),
  visitor_id: objectId,
  embed_id: objectId,
  embed_token: str,
  embed_flow_role: Joi.string().valid(...PROFESSIONAL_TYPE_VALUES),
  agent_type: Joi.string().valid(...WIDGET_AGENT_TYPE_VALUES).default('agent'),
  channel: str.default('web'),
  intent: Joi.string().valid(...CHAT_INTENTS).default('buy'),
  lead_score: Joi.number().min(0).max(100).default(0),
  lead_grade: Joi.string().valid(...LEAD_GRADES).default('unscored'),
  lead_classification: Joi.string().valid(...LEAD_CLASSIFICATIONS).default('unclassified'),
  lead_reasons: anyObj.default({}),
  is_qualified: Joi.boolean().default(false),
  emotional_state: str.default('neutral'),
  is_automated_booking_enabled: Joi.boolean().default(true),
  last_interaction_at: isoDate,
  form_data: anyObj.allow(null),
  calendly_booking_status: Joi.string().valid(...CALENDLY_BOOKING_STATUSES),
  calendly_booking_at: isoDate,
  post_booking_automation_runs: Joi.array().items(
    Joi.object({
      key: Joi.string().required(),
      dedupe_key: Joi.string().required(),
      ran_at: isoDate,
      status: Joi.string().valid(...POST_BOOKING_RUN_STATUSES).required(),
      detail: str,
    })
  ),
  post_booking_digest_dedupes: Joi.array().items(Joi.string()),
});

export const chatConversationUpdateSchema = chatConversationCreateSchema.fork(
  ['session_id', 'user_id'],
  (s) => s.optional()
);

export const chatMessageCreateSchema = Joi.object({
  conversation_id: objectId.required(),
  session_id: str,
  role: Joi.string().valid(...CHAT_MESSAGE_ROLES).required(),
  content: Joi.string().required(),
  agent_type: str,
  intent: str,
  channel: str.default('web'),
  lead_score: Joi.number().default(0),
  lead_grade: Joi.string().valid(...LEAD_GRADES).default('unscored'),
  meta: anyObj.default({}),
});

export const chatMessageUpdateSchema = chatMessageCreateSchema.fork(
  ['conversation_id', 'role', 'content'],
  (s) => s.optional()
);

export const chatbotEmbedUrlCreateSchema = Joi.object({
  user_id: objectId.required(),
  token: Joi.string().required(),
  widget_role: Joi.string().valid(...PROFESSIONAL_TYPE_VALUES),
  allowed_domains: Joi.array().items(Joi.string()).default([]),
  widget_settings: anyObj.default({}),
});

export const chatbotEmbedUrlUpdateSchema = chatbotEmbedUrlCreateSchema.fork(
  ['user_id', 'token'],
  (s) => s.optional()
);

export const embedGenerateBodySchema = chatbotEmbedUrlCreateSchema.fork(
  ['user_id', 'token'],
  (s) => s.optional()
);

export const embedPatchBodySchema = chatbotEmbedUrlUpdateSchema.fork(
  ['user_id', 'token'],
  (s) => s.optional()
);
