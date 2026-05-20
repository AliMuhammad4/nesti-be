import LeadProfile from '../../../models/LeadProfile.js';
import LeadMatch from '../../../models/LeadMatch.js';
import LeadAttribution from '../../../models/LeadAttribution.js';
import crypto from 'crypto';
import {
  leadAttributionCreateSchema,
  leadMatchCreateSchema,
  leadProfileCreateSchema,
} from '../../../schemas/leadSchemas.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';

const JOI_OPTIONS = {
  abortEarly: false,
  stripUnknown: true,
};

const LEGACY_LEAD_PROFILE_UNSET = {
  owner_user_id: '',
  professional_type: '',
  canonical_email: '',
  canonical_phone: '',
  dedupe_key: '',
  full_name: '',
  email: '',
  phone: '',
  property_address: '',
  location: '',
  budget: '',
  expected_price: '',
  timeline: '',
  bedrooms: '',
  bathrooms: '',
  square_footage: '',
  property_type: '',
  must_have_features: '',
  parking_required: '',
  backyard_needed: '',
  school_district_important: '',
  preferred_contact_method: '',
  best_time_to_contact: '',
  mortgage_status: '',
  realtor_status: '',
  motivation_reason: '',
  viewing_readiness: '',
  living_situation: '',
  urgency_readiness: '',
  mortgage_timeline: '',
  transaction_stage: '',
  closing_timeline: '',
  transaction_type: '',
  property_value: '',
  realtor_involved: '',
  first_time_buyer: '',
  legal_services_needed: '',
  pre_approval_status: '',
  credit_score_range: '',
  employment_status: '',
  household_income: '',
  down_payment_readiness: '',
  purchase_purpose: '',
  urgency_signal: '',
  mortgage_property_budget: '',
};

function normalizePropertyImages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const url = String(item.secure_url || item.url || '').trim();
      if (!url) return null;
      return {
        url,
        secure_url: String(item.secure_url || url).trim(),
        public_id: String(item.public_id || '').trim(),
        width: item.width != null && Number.isFinite(Number(item.width)) ? Number(item.width) : null,
        height: item.height != null && Number.isFinite(Number(item.height)) ? Number(item.height) : null,
        format: String(item.format || '').trim(),
        bytes: item.bytes != null && Number.isFinite(Number(item.bytes)) ? Number(item.bytes) : null,
        original_filename: String(item.original_filename || '').trim(),
        uploaded_at: item.uploaded_at || new Date(),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || '';
}

function normalizePhone(value) {
  const phone = String(value || '').replace(/[^\d+]/g, '');
  return phone || '';
}

function dedupeKey({ userId, professionalType, email, phone }) {
  const basis = `${toIdString(userId)}|${professionalType || 'agent'}|${email || ''}|${phone || ''}`;
  return crypto.createHash('sha256').update(basis).digest('hex');
}

function parseBudgetRange(value) {
  const txt = String(value || '').trim();
  if (!txt) return { min: null, max: null, confidence: 'low' };
  const normalized = txt.toLowerCase().replace(/\s+/g, '_');
  const parseTokenAmount = (token) => {
    const m = String(token || '').match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    const unit = String(m[2] || '').toLowerCase();
    if (unit === 'k') return Math.round(n * 1_000);
    if (unit === 'm') return Math.round(n * 1_000_000);
    return Math.round(n);
  };
  const toAmountFromRegex = (re) => {
    const m = normalized.match(re);
    if (!m) return null;
    return parseTokenAmount(`${m[1]}${m[2] || ''}`);
  };

  // Common intake enums from lawyer/mortgage flows
  const plusAmount = toAmountFromRegex(/^(\d+(?:\.\d+)?)(k|m)?_plus$/i);
  if (plusAmount != null) return { min: plusAmount, max: plusAmount, confidence: 'high' };

  const underAmount = toAmountFromRegex(/^under_(\d+(?:\.\d+)?)(k|m)?$/i);
  if (underAmount != null) return { min: underAmount, max: underAmount, confidence: 'high' };

  const rangeMatch = normalized.match(/^(\d+(?:\.\d+)?)(k|m)?_(\d+(?:\.\d+)?)(k|m)?$/i);
  if (rangeMatch) {
    const a = parseTokenAmount(`${rangeMatch[1]}${rangeMatch[2] || ''}`);
    const b = parseTokenAmount(`${rangeMatch[3]}${rangeMatch[4] || ''}`);
    if (a != null && b != null) {
      return { min: Math.min(a, b), max: Math.max(a, b), confidence: 'high' };
    }
  }

  const nums = txt
    .replace(/,/g, '')
    .match(/\d+(\.\d+)?/g)
    ?.map((n) => Number(n))
    .filter(Number.isFinite);
  if (!nums?.length) return { min: null, max: null, confidence: 'low' };
  if (nums.length === 1) return { min: nums[0], max: nums[0], confidence: 'medium' };
  return { min: Math.min(...nums), max: Math.max(...nums), confidence: 'high' };
}

function normalizeLeadProfilePayload(raw, { userId, professionalType, contactInfo, leadGrade }) {
  const payload = raw || {};
  const email = normalizeEmail(contactInfo?.email || payload.identity?.email);
  const phone = normalizePhone(contactInfo?.phone || payload.identity?.phone);
  const fullName = payload.identity?.full_name || contactInfo?.name || '';
  const budgetText = String(
    payload.property?.budget ||
      payload.budget_profile?.latest_budget_text ||
      payload.property?.expected_price ||
      ''
  ).trim();
  const parsedBudget = parseBudgetRange(budgetText);
  const profType = professionalType || payload.ownership?.professional_type || 'agent';
  const primaryIntent = profType === 'agent' ? payload.intent || 'unknown' : 'client';
  const defaultIntent =
    profType === PROFESSIONAL_TYPE.LAWYER || profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER
      ? 'unspecified'
      : 'buy';

  return {
    intent: payload.intent || defaultIntent,
    ownership: {
      user_id: toIdString(userId),
      professional_type: profType,
      dedupe_key: dedupeKey({ userId, professionalType: profType, email, phone }),
    },
    identity: {
      full_name: fullName,
      email: payload.identity?.email || contactInfo?.email || '',
      phone: payload.identity?.phone || contactInfo?.phone || '',
      canonical_email: email || '',
      canonical_phone: phone || '',
    },
    lifecycle: {
      status: payload.lifecycle?.status || 'new',
      first_seen_at: payload.lifecycle?.first_seen_at || new Date(),
      last_seen_at: new Date(),
      last_inquiry_at: new Date(),
    },
    intent_summary: {
      primary_intent: payload.intent_summary?.primary_intent || primaryIntent,
      buy_count: payload.intent_summary?.buy_count || 0,
      sell_count: payload.intent_summary?.sell_count || 0,
      client_count: payload.intent_summary?.client_count || 0,
    },
    budget_profile: {
      latest_budget_text: budgetText,
      min_budget: parsedBudget.min,
      max_budget: parsedBudget.max,
      currency: budgetText ? 'USD' : '',
      confidence: parsedBudget.confidence,
    },
    contact_preferences: {
      preferred_contact_method:
        payload.contact_preferences?.preferred_contact_method ||
        '',
      best_time_to_contact:
        payload.contact_preferences?.best_time_to_contact ||
        '',
    },
    property: {
      address: payload.property?.address || '',
      location: payload.property?.location || '',
      budget: payload.property?.budget || '',
      expected_price: payload.property?.expected_price || '',
      timeline: payload.property?.timeline || '',
      bedrooms: payload.property?.bedrooms || '',
      bathrooms: payload.property?.bathrooms || '',
      square_footage: payload.property?.square_footage || '',
      property_type: payload.property?.property_type || '',
      must_have_features: payload.property?.must_have_features || '',
      parking_required: payload.property?.parking_required || '',
      backyard_needed: payload.property?.backyard_needed || '',
      school_district_important:
        payload.property?.school_district_important || '',
      images: normalizePropertyImages(payload.property?.images),
    },
    qualification: {
      agent: {
        mortgage_status: payload.qualification?.agent?.mortgage_status || '',
        realtor_status: payload.qualification?.agent?.realtor_status || '',
        motivation_reason: payload.qualification?.agent?.motivation_reason || '',
        viewing_readiness: payload.qualification?.agent?.viewing_readiness || '',
        living_situation: payload.qualification?.agent?.living_situation || '',
        urgency_readiness: payload.qualification?.agent?.urgency_readiness || '',
      },
      mortgage_broker: {
        mortgage_timeline: payload.qualification?.mortgage_broker?.mortgage_timeline || '',
        pre_approval_status: payload.qualification?.mortgage_broker?.pre_approval_status || '',
        credit_score_range: payload.qualification?.mortgage_broker?.credit_score_range || '',
        employment_status: payload.qualification?.mortgage_broker?.employment_status || '',
        household_income: payload.qualification?.mortgage_broker?.household_income || '',
        down_payment_readiness: payload.qualification?.mortgage_broker?.down_payment_readiness || '',
        purchase_purpose: payload.qualification?.mortgage_broker?.purchase_purpose || '',
        urgency_signal: payload.qualification?.mortgage_broker?.urgency_signal || '',
        property_budget: payload.qualification?.mortgage_broker?.property_budget || '',
      },
      lawyer: {
        transaction_stage: payload.qualification?.lawyer?.transaction_stage || '',
        closing_timeline: payload.qualification?.lawyer?.closing_timeline || '',
        transaction_type: payload.qualification?.lawyer?.transaction_type || '',
        property_value: payload.qualification?.lawyer?.property_value || '',
        mortgage_status: payload.qualification?.lawyer?.mortgage_status || '',
        realtor_involved: payload.qualification?.lawyer?.realtor_involved || '',
        first_time_buyer: payload.qualification?.lawyer?.first_time_buyer || '',
        legal_services_needed: payload.qualification?.lawyer?.legal_services_needed || '',
      },
    },
    scoring: {
      current_score: Number(payload.total_score || payload.scoring?.current_score || 0),
      current_grade: leadGrade || payload.scoring?.current_grade || 'unscored',
      score_trend: payload.scoring?.score_trend || 'stable',
      last_scored_at: new Date(),
      components: payload.scoring?.components || {},
    },
    stats: {
      total_inquiries: payload.stats?.total_inquiries || 0,
      total_sessions: payload.stats?.total_sessions || 0,
      total_matches: payload.stats?.total_matches || 0,
      buy_matches: payload.stats?.buy_matches || 0,
      sell_matches: payload.stats?.sell_matches || 0,
      client_matches: payload.stats?.client_matches || 0,
      last_seen_at: new Date(),
    },
    source: payload.source || 'chatbot',
    total_score: Number(payload.total_score || 0),
  };
}

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

function buildNonEmptyPatch(payload) {
  const patch = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    patch[k] = v;
  }
  return patch;
}

export async function createOrReuseLeadProfile({
  payload,
  userId,
  professionalType,
  contactInfo,
  leadGrade,
}) {
  const normalizedPayload = normalizeLeadProfilePayload(payload, {
    userId,
    professionalType,
    contactInfo,
    leadGrade,
  });
  const validated = validateOrThrow(leadProfileCreateSchema, normalizedPayload, 'LeadProfile');
  const email = normalizeEmail(contactInfo?.email || validated.identity?.email);
  const phone = normalizePhone(contactInfo?.phone || validated.identity?.phone);

  if (!email && !phone) {
    const leadProfile = await LeadProfile.create(validated);
    return { leadProfile: await LeadProfile.findById(leadProfile._id), reusedExisting: false };
  }

  const profType = professionalType || validated.ownership?.professional_type || 'agent';

  const existingProfile = await LeadProfile.findOne({
    'ownership.user_id': toIdString(userId),
    'ownership.professional_type': profType,
    $or: [
      ...(email ? [{ 'identity.canonical_email': email }] : []),
      ...(phone ? [{ 'identity.canonical_phone': phone }] : []),
    ],
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .select('_id')
    .lean();

  if (!existingProfile?._id) {
    const leadProfile = await LeadProfile.create(validated);
    return { leadProfile: await LeadProfile.findById(leadProfile._id), reusedExisting: false };
  }

  const patch = buildNonEmptyPatch(validated);
  // Do not overwrite aggregate/history fields on profile reuse.
  delete patch.lead_refs;
  delete patch.stats;
  delete patch.intent_summary;
  delete patch.lifecycle;
  const leadProfile = await LeadProfile.findByIdAndUpdate(
    existingProfile._id,
    { $set: patch, $unset: LEGACY_LEAD_PROFILE_UNSET },
    { returnDocument: 'after' }
  );
  if (!leadProfile) {
    const created = await LeadProfile.create(validated);
    return { leadProfile: await LeadProfile.findById(created._id), reusedExisting: false };
  }
  return { leadProfile: await LeadProfile.findById(leadProfile._id), reusedExisting: true };
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
  const leadMatch = await LeadMatch.create(validated);
  if (leadMatch?.lead_profile_id) {
    await LeadProfile.findByIdAndUpdate(leadMatch.lead_profile_id, {
      $addToSet: { lead_refs: leadMatch._id },
    });
  }
  return leadMatch;
}

export async function createValidatedLeadAttribution(payload) {
  const candidate = {
    ...payload,
    lead_profile_id: toIdString(payload.lead_profile_id),
  };
  if (payload.lead_match_id != null) {
    candidate.lead_match_id = toIdString(payload.lead_match_id);
  }
  const validated = validateOrThrow(leadAttributionCreateSchema, candidate, 'LeadAttribution');
  return LeadAttribution.create(validated);
}

export async function bumpLeadProfileStats(leadProfileId, intent = 'buy', leadType = '') {
  const inc = { 'stats.total_matches': 1 };
  inc['stats.total_inquiries'] = 1;
  inc['stats.total_sessions'] = 1;
  const lt = String(leadType || '');
  const isClientLead = /_client$/.test(lt);
  if (intent === 'sell') inc['stats.sell_matches'] = 1;
  else if (isClientLead) inc['stats.client_matches'] = 1;
  else if (intent !== 'unspecified') inc['stats.buy_matches'] = 1;
  if (intent === 'sell') inc['intent_summary.sell_count'] = 1;
  else if (isClientLead) inc['intent_summary.client_count'] = 1;
  else if (intent !== 'unspecified') inc['intent_summary.buy_count'] = 1;

  await LeadProfile.findByIdAndUpdate(leadProfileId, {
    $inc: inc,
    $set: {
      'stats.last_seen_at': new Date(),
      'lifecycle.last_seen_at': new Date(),
      'lifecycle.last_inquiry_at': new Date(),
    },
  });
}
