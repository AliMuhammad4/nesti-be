import LeadProfile from '../../../models/LeadProfile.js';
import LeadMatch from '../../../models/LeadMatch.js';
import LeadAttribution from '../../../models/LeadAttribution.js';
import {
  leadAttributionCreateSchema,
  leadMatchCreateSchema,
  leadProfileCreateSchema,
} from '../../../schemas/leadSchemas.js';

const JOI_OPTIONS = {
  abortEarly: false,
  stripUnknown: true,
};

function toIdString(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (typeof value?.toString === 'function') return value.toString();
  return value;
}

function validateOrThrow(schema, payload, label) {
  const { error, value } = schema.validate(payload, JOI_OPTIONS);
  if (!error) return value;
  const details = error.details.map((d) => d.message).join('; ');
  throw new Error(`${label} validation failed: ${details}`);
}

export async function createValidatedLeadProfile(payload) {
  const validated = validateOrThrow(leadProfileCreateSchema, payload, 'LeadProfile');
  return LeadProfile.create(validated);
}

export async function createValidatedLeadMatch(payload) {
  const candidate = {
    ...payload,
    user_id: toIdString(payload.user_id),
    professional_profile_id: toIdString(payload.professional_profile_id),
    lead_profile_id: toIdString(payload.lead_profile_id),
    conversation_id: toIdString(payload.conversation_id),
  };
  const validated = validateOrThrow(leadMatchCreateSchema, candidate, 'LeadMatch');
  return LeadMatch.create(validated);
}

export async function createValidatedLeadAttribution(payload) {
  const candidate = {
    ...payload,
    lead_profile_id: toIdString(payload.lead_profile_id),
  };
  const validated = validateOrThrow(leadAttributionCreateSchema, candidate, 'LeadAttribution');
  return LeadAttribution.create(validated);
}
