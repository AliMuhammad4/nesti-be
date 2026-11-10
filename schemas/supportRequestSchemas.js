import Joi from 'joi';
import { SUPPORT_REQUEST_STATUSES } from '../models/ProfessionalSupportRequest.js';

export const supportRequestPatchSchema = Joi.object({
  status: Joi.string().valid(...SUPPORT_REQUEST_STATUSES).optional(),
  is_unread: Joi.boolean().optional(),
}).or('status', 'is_unread');

export const supportRequestNoteSchema = Joi.object({
  body: Joi.string().trim().min(1).max(4000).required(),
});

export const supportRequestReplySchema = Joi.object({
  subject: Joi.string().trim().max(200).allow('').optional(),
  message: Joi.string().trim().min(1).max(10000).required(),
});
