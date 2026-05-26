import { Joi, anyObj, objectId } from './common.js';

export const createInviteSchema = Joi.object({
  intended_role: Joi.string().allow('').optional(),
  intended_audience: Joi.string().valid('professional', 'client', 'any').optional(),
  source_channel: Joi.string().allow('').optional(),
  source_referral_id: objectId.optional(),
  source_conversation_id: objectId.optional(),
  attribution_window_days: Joi.number().integer().min(30).max(90).optional(),
  metadata: anyObj.optional(),
});

export const captureInviteSchema = Joi.object({
  token: Joi.string().min(12).required(),
  session_id: Joi.string().max(128).allow('').optional(),
  visitor_id: Joi.string().max(128).allow('').optional(),
  source_channel: Joi.string().allow('').optional(),
  source_referrer: Joi.string().max(512).allow('').optional(),
  landing_path: Joi.string().max(256).allow('').optional(),
});

export const finalizeInviteSchema = Joi.object({
  token: Joi.string().min(12).optional(),
  invite_token: Joi.string().min(12).optional(),
  method: Joi.string().allow('').optional(),
  path: Joi.string().allow('').optional(),
}).or('token', 'invite_token');
