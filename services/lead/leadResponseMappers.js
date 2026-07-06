import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
import { buildLeadConversionPack } from '../conversion/buildLeadConversionPack.js';
import { evaluateRoleConversionChecklist } from './leadConversionChecklist.js';
import { mapLeadProfileForApi } from './leadProfileFormat.js';
import { extractInquiredPropertyContext, normalizeInquiredProperty } from './inquiredProperty.js';
import { buildDecisionSupport, buildLeadTrust, buildFunnelTelemetry } from './leadExperienceContract.js';
import { resolveListIntent } from './leadQueryUtils.js';

function professionalTypeFromMatch(leadMatch, profile = null) {
  return (
    leadMatch.compatibility_factors?.professional_type ||
    profile?.ownership?.professional_type ||
    PROFESSIONAL_TYPE.AGENT
  );
}

function formatAgentNotesForApi(cf) {
  const raw = cf?.agent_notes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n) => n && typeof n === 'object' && typeof n.text === 'string')
    .map((n) => ({
      id: n.id != null ? String(n.id) : null,
      text: n.text,
      created_at: n.created_at || null,
      author_user_id: n.author_user_id != null ? String(n.author_user_id) : null,
      author_label: n.author_label || null,
      ...(n.system ? { system: true } : {}),
    }))
    .sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
}

function buildSpecificFacts(profileView, leadMatch) {
  const facts = [];
  const score = leadMatch?.match_score;
  const p = profileView?.property || {};
  const q = profileView?.qualification || {};
  if (score != null) facts.push(`Lead score ${Number(score)}/100`);
  if (p.budget) facts.push(`Budget/price: ${p.budget}`);
  if (p.timeline) facts.push(`Timeline: ${p.timeline}`);
  if (p.location || p.address) facts.push(`Area: ${p.location || p.address}`);
  if (q?.mortgage_timeline) facts.push(`Mortgage timeline: ${q.mortgage_timeline}`);
  if (q?.pre_approval_status) facts.push(`Financing: ${q.pre_approval_status}`);
  if (q?.transaction_stage) facts.push(`Transaction stage: ${q.transaction_stage}`);
  return facts;
}

function buildExperienceBlocks(conversion, grade, profileView, leadMatch) {
  const facts = buildSpecificFacts(profileView, leadMatch);
  return {
    decision_support: buildDecisionSupport(conversion, grade, facts),
    trust: buildLeadTrust({
      contact: profileView.contact,
      property: { ...profileView.property, intent: profileView.intent },
      qualification: profileView.qualification,
      icpFit: leadMatch.icp_fit || null,
    }),
    conversion_funnel: buildFunnelTelemetry(conversion),
  };
}

/** Buyer/seller coaching blocks are agent-specific; lawyers/brokers get leaner API payloads. */
function includeAgentStyleLeadExperience(profType) {
  return profType === PROFESSIONAL_TYPE.AGENT;
}

/** Next-step playbooks (`resolveNextActions` incl. lawyer `matter_scope`) ship inside `buildLeadConversionPack`. */
function includePlaybookConversionPack(profType) {
  return (
    profType === PROFESSIONAL_TYPE.LAWYER ||
    profType === PROFESSIONAL_TYPE.MORTGAGE_BROKER
  );
}

function buildConversion(leadMatch, profile, convo) {
  return buildLeadConversionPack({
    leadMatch,
    leadProfile: profile && profile._id ? profile : null,
    conversation: convo && convo._id ? convo : null,
  });
}

function formatCloseSummary(cf) {
  const cs = cf?.close_summary;
  if (!cs || typeof cs !== 'object') return null;
  const agentChecklist = cs?.agent_closing_checklist;
  const lawyerChecklist = cs?.lawyer_closing_checklist;
  const mortgageChecklist = cs?.mortgage_closing_checklist;
  return {
    status: cs.status || null,
    reason: cs.reason || null,
    value: cs.value ?? null,
    agent_closing_checklist:
      agentChecklist && typeof agentChecklist === 'object'
        ? {
            client_ready_to_proceed: agentChecklist.client_ready_to_proceed || '',
            property_identified: agentChecklist.property_identified || '',
            price_captured: agentChecklist.price_captured || '',
            target_closing_date: agentChecklist.target_closing_date || '',
            remaining_conditions: agentChecklist.remaining_conditions || '',
            next_step: agentChecklist.next_step || '',
          }
        : null,
    lawyer_closing_checklist:
      lawyerChecklist && typeof lawyerChecklist === 'object'
        ? {
            transaction_type: lawyerChecklist.transaction_type || '',
            property_or_legal_matter: lawyerChecklist.property_or_legal_matter || '',
            closing_date: lawyerChecklist.closing_date || '',
            agreement_and_docs_received: lawyerChecklist.agreement_and_docs_received || '',
            outstanding_legal_requirements: lawyerChecklist.outstanding_legal_requirements || '',
            next_step: lawyerChecklist.next_step || '',
          }
        : null,
    mortgage_closing_checklist:
      mortgageChecklist && typeof mortgageChecklist === 'object'
        ? {
            client_ready_to_move_forward: mortgageChecklist.client_ready_to_move_forward || '',
            property_value_and_mortgage_need: mortgageChecklist.property_value_and_mortgage_need || '',
            financing_status: mortgageChecklist.financing_status || '',
            income_docs_ready: mortgageChecklist.income_docs_ready || '',
            funding_timeline: mortgageChecklist.funding_timeline || '',
            next_step: mortgageChecklist.next_step || '',
          }
        : null,
    closed_at: cs.closed_at || null,
    closed_by_user_id: cs.closed_by_user_id || null,
    closed_by_label: cs.closed_by_label || null,
    reopened_at: cs.reopened_at || null,
  };
}

function isListedPropertyInquirySource(leadMatch, leadSource) {
  const cf = leadMatch?.compatibility_factors || {};
  const source = String(leadSource || cf.source || '').trim().toLowerCase();
  return source === 'client_property_inquiry';
}

function emptyAgentQualification() {
  return {
    mortgage_status: null,
    realtor_status: null,
    motivation_reason: null,
    viewing_readiness: null,
    living_situation: null,
    urgency_readiness: null,
    buy_property_location: null,
  };
}

function applyListedPropertyInquiryView(core, leadMatch, profile) {
  if (!isListedPropertyInquirySource(leadMatch, core.source)) return core;

  const cf = leadMatch?.compatibility_factors || {};
  const rawProp = profile?.property || {};
  let inquiredProperty = core.inquired_property;
  if (!inquiredProperty) {
    inquiredProperty = normalizeInquiredProperty({
      id: cf.inquired_property_id,
      title: cf.inquired_property_title,
      address: rawProp.address,
      location: rawProp.location || rawProp.address,
      expected_price: rawProp.expected_price,
      property_type: rawProp.property_type,
      bedrooms: rawProp.bedrooms,
      bathrooms: rawProp.bathrooms,
      square_footage: rawProp.square_footage,
    });
  }

  const inquiryMessage = String(cf.inquiry_message || rawProp.must_have_features || '').trim();
  const profType =
    leadMatch?.compatibility_factors?.professional_type || profile?.ownership?.professional_type;

  return {
    ...core,
    inquired_property: inquiredProperty,
    inquiry_message: inquiryMessage || null,
    is_listed_property_inquiry: true,
    property: {
      ...core.property,
      location: inquiredProperty?.location || inquiredProperty?.address || rawProp.address || null,
      address: inquiredProperty?.address || rawProp.address || null,
      budget: inquiredProperty?.expected_price || rawProp.expected_price || null,
      expected_price: inquiredProperty?.expected_price || rawProp.expected_price || null,
      timeline: null,
      bedrooms: inquiredProperty?.bedrooms || rawProp.bedrooms || null,
      bathrooms: inquiredProperty?.bathrooms || rawProp.bathrooms || null,
      property_type: inquiredProperty?.property_type || rawProp.property_type || null,
      must_have_features: inquiryMessage || null,
      parking_required: null,
      backyard_needed: null,
      school_district_important: null,
    },
    qualification:
      profType === PROFESSIONAL_TYPE.AGENT ? emptyAgentQualification() : core.qualification,
  };
}

function leadCore(leadMatch, profileView, convo, opts = {}) {
  const { includeIntentField = true } = opts;
  const grade = leadMatch.lead_type?.split('_')[0] || null;
  const appointmentDate =
    leadMatch?.compatibility_factors?.calendly?.calendly_event_start ||
    convo?.calendly_event_start ||
    null;
  const leadSource = leadMatch?.compatibility_factors?.source || null;
  const { inquiredProperty, linkedSellerLeadMatchId } = extractInquiredPropertyContext(leadMatch);
  const conversionChecklist = evaluateRoleConversionChecklist({
    role: leadMatch?.compatibility_factors?.professional_type || opts?.leadProfile?.ownership?.professional_type,
    leadProfile: opts.leadProfile || null,
    leadMatch,
  });
  const core = {
    id: String(leadMatch._id),
    professional_type: null,
    lead_type: leadMatch.lead_type,
    grade,
    score: leadMatch.match_score,
    status: leadMatch.match_status,
    contact: profileView.contact,
    property: profileView.property,
    qualification: profileView.qualification,
    appointment_status: resolveAppointmentStatus(
      leadMatch.match_status,
      convo?.calendly_booking_status,
      appointmentDate
    ),
    calendly_booking_status: convo?.calendly_booking_status || null,
    embed_token: leadMatch.compatibility_factors?.embed_token || null,
    session_id: leadMatch.compatibility_factors?.session_id || convo?.session_id || null,
    conversation_id: String(leadMatch.conversation_id || ''),
    source: leadSource,
    inquired_property: inquiredProperty,
    client_profile: leadMatch?.compatibility_factors?.client_profile || null,
    linked_seller_lead_match_id: linkedSellerLeadMatchId,
    is_direct_public_inquiry:
      Boolean(leadMatch?.compatibility_factors?.direct_submission) || leadSource === 'public_web_form',
    created_at: leadMatch.createdAt,
    updated_at: leadMatch.updatedAt,
    agent_notes: formatAgentNotesForApi(leadMatch.compatibility_factors),
    close_summary: formatCloseSummary(leadMatch.compatibility_factors),
    conversionChecklist,
    conversion_checklist: conversionChecklist,
  };
  if (includeIntentField) {
    core.intent = resolveListIntent(profileView, leadMatch, opts.leadProfile);
  }
  return applyListedPropertyInquiryView(core, leadMatch, opts.leadProfile || null);
}

export function mapLeadMatchToListRow(leadMatch, profile, convo, includeConversion, opts = {}) {
  const profType = professionalTypeFromMatch(leadMatch, profile);
  const profileView = mapLeadProfileForApi(profile, profType);
  const grade = leadMatch.lead_type?.split('_')[0] || null;
  const includeExperience = opts.includeExperienceBlocks !== false && includeAgentStyleLeadExperience(profType);
  const needsConversion =
    includeConversion && (includeExperience || includePlaybookConversionPack(profType));
  const conversion = needsConversion ? buildConversion(leadMatch, profile, convo) : null;
  const row = {
    ...leadCore(leadMatch, profileView, convo, { ...opts, leadProfile: profile }),
    professional_type: profType,
  };
  if (includeExperience && conversion) {
    Object.assign(row, buildExperienceBlocks(conversion, grade, profileView, leadMatch));
    row.conversion = conversion;
  } else if (includePlaybookConversionPack(profType) && includeConversion && conversion) {
    row.conversion = conversion;
  }
  return row;
}

export function mapLeadMatchToDetail(leadMatch, profile, convo, opts = {}) {
  const profType = professionalTypeFromMatch(leadMatch, profile);
  const profileView = mapLeadProfileForApi(profile, profType);
  const conversion = buildConversion(leadMatch, profile, convo);
  const grade = leadMatch.lead_type?.split('_')[0] || null;
  const lead = {
    ...leadCore(leadMatch, profileView, convo, { ...opts, leadProfile: profile }),
    professional_type: profType,
    icp_fit: leadMatch.icp_fit || null,
  };
  if (includeAgentStyleLeadExperience(profType)) {
    Object.assign(lead, buildExperienceBlocks(conversion, grade, profileView, leadMatch));
  }
  return lead;
}

/** Compact lead row for linked seller context (inquired property tab). */
export function mapLeadMatchToSellerLeadSummary(leadMatch, profile, convo, opts = {}) {
  const profType = professionalTypeFromMatch(leadMatch, profile);
  const profileView = mapLeadProfileForApi(profile, profType);
  const core = leadCore(leadMatch, profileView, convo, { ...opts, leadProfile: profile });
  const row = {
    id: core.id,
    professional_type: profType,
    lead_type: core.lead_type,
    grade: core.grade,
    score: core.score,
    status: core.status,
    contact: core.contact,
    property: core.property,
    qualification: core.qualification,
    appointment_status: core.appointment_status,
    calendly_booking_status: core.calendly_booking_status,
    conversation_id: core.conversation_id,
    source: core.source,
    created_at: core.created_at,
    updated_at: core.updated_at,
  };
  if (opts.includeIntentField !== false && core.intent != null) row.intent = core.intent;
  return row;
}

export function mapLeadMatchUnderProfile(leadMatch, profile, convo, opts = {}) {
  const profType = profile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const profileView = opts.profileView || mapLeadProfileForApi(profile, profType);
  const conversion = buildLeadConversionPack({
    leadMatch,
    leadProfile: profile,
    conversation: convo && convo._id ? convo : null,
  });
  const grade = leadMatch.lead_type?.split('_')[0] || null;
  const resolvedProfType = leadMatch.compatibility_factors?.professional_type || profType;

  const row = {
    ...leadCore(leadMatch, profileView, convo, { ...opts, leadProfile: profile }),
    professional_type: resolvedProfType,
    icp_fit: leadMatch.icp_fit || null,
  };
  const includeExperience = opts.includeExperienceBlocks !== false && includeAgentStyleLeadExperience(resolvedProfType);
  if (includeExperience) {
    Object.assign(row, buildExperienceBlocks(conversion, grade, profileView, leadMatch));
  }
  if (includeExperience || includePlaybookConversionPack(resolvedProfType)) {
    row.conversion = conversion;
  }
  return row;
}
