import { Joi, passthrough } from './common.js';
import {
  nurtureLogCreateSchema,
  referralCreateSchema,
  referralUpdateSchema,
} from './opsSchemas.js';

export const chatBodySchema = Joi.object({
  id: Joi.string().optional(),
  message: Joi.string().trim().max(10000).required(),
  embedToken: Joi.string().trim().required(),
  visitorId: Joi.string().optional(),
  agentType: Joi.string().optional(),
  channel: Joi.string().optional(),
  clientIp: Joi.string().optional(),
  userAgent: Joi.string().optional(),
  referer: Joi.string().optional(),
  formContact: Joi.object().optional(),
});

export const propertyMatchesSchema = Joi.object({
  id: Joi.string().optional(),
  embedToken: Joi.string().trim().required(),
  visitorId: Joi.string().optional(),
  formContact: Joi.object().unknown(true).optional(),
});

export const scorePreviewSchema = Joi.object({
  professionalType: Joi.string().optional(),
  formContact: Joi.object().unknown(true).optional(),
}).unknown(true);

export const referralCreateBodySchema = referralCreateSchema.fork(
  ['user_id', 'target_user_id', 'conversation_id', 'target_vertical'],
  (s) => s.optional()
);

export const referralUpdateBodySchema = referralUpdateSchema.fork(
  ['user_id', 'target_user_id', 'conversation_id', 'target_vertical'],
  (s) => s.optional()
);

export const nurtureSendBodySchema = nurtureLogCreateSchema.fork(
  ['user_id', 'conversation_id', 'to_email', 'subject', 'body'],
  (s) => s.optional()
);

export const calculatorSchema = passthrough;
