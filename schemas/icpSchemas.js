import { Joi } from './common.js';

const moneyRange = Joi.object({
  min: Joi.number().min(0).allow(null).required(),
  max: Joi.number().min(0).allow(null).required(),
}).custom((value, helpers) => {
  if (value.min != null && value.max != null && value.min > value.max) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'min <= max');

export const agentIcpSchema = Joi.object({
  client_types: Joi.array()
    .items(
      Joi.string().valid(
        'first_time_buyers',
        'luxury_buyers',
        'investors',
        'sellers',
        'downsizers'
      )
    )
    .min(1)
    .required(),
  price_range: moneyRange.required(),
  property_types: Joi.array()
    .items(
      Joi.string().valid('condo', 'detached', 'multi_family', 'investment', 'townhouse', 'land')
    )
    .min(1)
    .required(),
  service_areas: Joi.array().items(Joi.string().trim().min(1)).min(1).required(),
  timeline_preference: Joi.array()
    .items(Joi.string().valid('immediate', '3_6_months', 'long_term'))
    .min(1)
    .required(),
}).messages({ 'any.invalid': 'Range min cannot be greater than max' });

export const mortgageBrokerIcpSchema = Joi.object({
  loan_types: Joi.array()
    .items(Joi.string().valid('first_time_buyers', 'investment_properties', 'refinances', 'self_employed_borrowers'))
    .min(1)
    .required(),
  credit_range_preference: Joi.array()
    .items(Joi.string().valid('750_plus', '700_749', '650_699', '600_649', 'under_600'))
    .min(1)
    .required(),
  income_preference: Joi.array()
    .items(Joi.string().valid('200k_plus', '150k_200k', '100k_150k', '70k_100k', 'under_70k'))
    .min(1)
    .required(),
  loan_size_range: moneyRange.required(),
}).messages({ 'any.invalid': 'Range min cannot be greater than max' });

export const lawyerIcpSchema = Joi.object({
  transaction_types: Joi.array()
    .items(Joi.string().valid('home_purchases', 'home_sales', 'refinances', 'title_transfers'))
    .min(1)
    .required(),
  preferred_property_values: moneyRange.required(),
  service_areas: Joi.array().items(Joi.string().trim().min(1)).min(1).required(),
}).messages({ 'any.invalid': 'Range min cannot be greater than max' });

export const ICP_SCHEMA_BY_ROLE = {
  agent: agentIcpSchema,
  mortgage_broker: mortgageBrokerIcpSchema,
  lawyer: lawyerIcpSchema,
};
