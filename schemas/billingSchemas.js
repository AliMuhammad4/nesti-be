import { Joi } from './common.js';
import { SUBSCRIPTION_PLAN_KEYS } from '../models/Subscription.js';

export const checkoutSessionSchema = Joi.object({
  plan_key: Joi.string()
    .valid(...SUBSCRIPTION_PLAN_KEYS)
    .required(),
});

export const storefrontTemplateCheckoutSessionSchema = Joi.object({
  template_id: Joi.string().trim().max(100).required(),
}).unknown(false);

export const storefrontTemplateCheckoutConfirmSchema = Joi.object({
  session_id: Joi.string().trim().max(255).required(),
  template_id: Joi.string().trim().max(100).required(),
}).unknown(false);

export const storefrontTemplateSubscriptionActionSchema = Joi.object({
  template_id: Joi.string().trim().max(100).required(),
  reason: Joi.string().trim().min(3).max(1000).optional().allow(''),
}).unknown(false);

export const changePlanSchema = Joi.object({
  plan_key: Joi.string()
    .valid(...SUBSCRIPTION_PLAN_KEYS)
    .required(),
});

export const cancelSubscriptionSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(1000).required(),
}).unknown(false);

export const resumeSubscriptionSchema = Joi.object({}).unknown(false).default({});
