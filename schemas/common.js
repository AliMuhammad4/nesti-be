import Joi from 'joi';
import { LEAD_TYPES } from '../constants/validationEnums.js';

export { Joi };

export const objectId = Joi.string().hex().length(24);
export const isoDate = Joi.alternatives(Joi.date(), Joi.string().isoDate());
export const anyObj = Joi.object().unknown(true);
export const str = Joi.string().allow('', null);
export const leadType = Joi.string().valid(...LEAD_TYPES);
export const passthrough = Joi.object().unknown(true).required();
