import { Joi } from './common.js';
import { SUBSCRIPTION_PLAN_KEYS } from '../models/Subscription.js';

export const checkoutSessionSchema = Joi.object({
  plan_key: Joi.string()
    .valid(...SUBSCRIPTION_PLAN_KEYS)
    .required(),
});

export const changePlanSchema = Joi.object({
  plan_key: Joi.string()
    .valid(...SUBSCRIPTION_PLAN_KEYS)
    .required(),
});

export const cancelSubscriptionSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(1000).required(),
}).unknown(false);

export const resumeSubscriptionSchema = Joi.object({}).unknown(false).default({});
