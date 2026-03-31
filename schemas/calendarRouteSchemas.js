import { Joi, objectId } from './common.js';

export const webhookSubscriptionBodySchema = Joi.object({
  embedToken: Joi.string().trim().required(),
  webhookUrl: Joi.string().uri({ scheme: ['https'] }).required(),
});

export const simulateInviteeBodySchema = Joi.object({
  embedToken: Joi.string().trim().required(),
  conversationId: objectId.required(),
  email: Joi.string().email().optional(),
});
