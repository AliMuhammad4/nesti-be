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

export const cancelSubscriptionSchema = Joi.object({}).unknown(false).default({});

export const resumeSubscriptionSchema = Joi.object({}).unknown(false).default({});
