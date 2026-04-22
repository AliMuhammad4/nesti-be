import { Joi, objectId } from './common.js';

/** Embed-only routes (body must identify the embed + target URL). */
export const webhookSubscriptionBodySchema = Joi.object({
  embedToken: Joi.string().trim().required(),
  webhookUrl: Joi.string().uri({ scheme: ['https'] }).required(),
});

/** Bearer-auth settings UI — optional public webhook URL (https, e.g. Render). */
export const webhookSubscriptionBearerBodySchema = Joi.object({
  webhookUrl: Joi.string().uri({ scheme: ['https', 'http'] }).optional().allow(''),
});

export const simulateInviteeBodySchema = Joi.object({
  embedToken: Joi.string().trim().required(),
  conversationId: objectId.required(),
  email: Joi.string().email().optional(),
});

export const calendlyCancelBookingBodySchema = Joi.object({
  lead_match_id: objectId.required(),
  reason: Joi.string().trim().max(500).optional().allow(''),
});
