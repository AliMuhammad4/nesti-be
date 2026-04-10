import { Joi, objectId, passthrough } from './common.js';
import { referralCreateSchema, referralUpdateSchema } from './opsSchemas.js';

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

export const nurtureDraftBodySchema = Joi.object({
  lead_match_id: objectId.optional(),
  lead_profile_id: objectId.optional(),
  goal: Joi.string().trim().max(500).allow('', null),
  tone: Joi.string().trim().max(100).allow('', null),
})
  .xor('lead_match_id', 'lead_profile_id')
  .messages({ 'object.xor': 'Provide exactly one of lead_match_id or lead_profile_id' });

export const nurtureRefineBodySchema = Joi.object({
  lead_match_id: objectId.optional(),
  lead_profile_id: objectId.optional(),
  subject: Joi.string().trim().max(200).required(),
  body: Joi.string().trim().max(8000).required(),
  instruction: Joi.string().trim().max(2000).required(),
})
  .xor('lead_match_id', 'lead_profile_id')
  .messages({ 'object.xor': 'Provide exactly one of lead_match_id or lead_profile_id' });

export const nurtureSendBodySchema = Joi.object({
  lead_match_id: objectId.optional(),
  lead_profile_id: objectId.optional(),
  conversation_id: objectId.optional(),
  to_email: Joi.string().email().allow('', null),
  subject: Joi.string().trim().max(200).required(),
  /** Plain text; draft/refine responses use body_text — accept either for send. */
  body: Joi.string().trim().max(8000).allow('', null),
  body_text: Joi.string().trim().max(8000).allow('', null),
  body_html: Joi.string().trim().max(20000).allow('', null),
  /** When true (default), HTML email appends styled property cards from server-fetched matches. */
  include_property_cards: Joi.boolean().optional(),
})
  .xor('lead_match_id', 'lead_profile_id')
  .custom((value, helpers) => {
    const fromBody = value.body != null && String(value.body).trim() !== '' ? String(value.body).trim() : '';
    const fromBodyText =
      value.body_text != null && String(value.body_text).trim() !== ''
        ? String(value.body_text).trim()
        : '';
    const merged = fromBody || fromBodyText;
    if (!merged) {
      return helpers.error('any.custom', { message: '"body" or "body_text" is required' });
    }
    const { body_text: _bt, ...rest } = value;
    return { ...rest, body: merged };
  }, 'nurture send body')
  .messages({ 'object.xor': 'Provide exactly one of lead_match_id or lead_profile_id' });

export const calculatorSchema = passthrough;
