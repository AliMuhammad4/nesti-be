import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
import { buildLeadConversionPack } from '../conversion/buildLeadConversionPack.js';
import { mapLeadProfileForApi } from './leadProfileFormat.js';
import { buildDecisionSupport, buildLeadTrust, buildFunnelTelemetry } from './leadExperienceContract.js';

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
  return {
    status: cs.status || null,
    reason: cs.reason || null,
    note: cs.note || null,
    value: cs.value ?? null,
    closed_at: cs.closed_at || null,
    closed_by_user_id: cs.closed_by_user_id || null,
    closed_by_label: cs.closed_by_label || null,
    reopened_at: cs.reopened_at || null,
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
  const inquiredProperty =
    leadMatch?.compatibility_factors?.inquired_property &&
    typeof leadMatch.compatibility_factors.inquired_property === 'object'
      ? leadMatch.compatibility_factors.inquired_property
      : null;
  const linkedSellerLeadMatchId =
    leadMatch?.compatibility_factors?.linked_seller_lead_match_id || null;
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
    linked_seller_lead_match_id: linkedSellerLeadMatchId,
    is_direct_public_inquiry:
      Boolean(leadMatch?.compatibility_factors?.direct_submission) || leadSource === 'public_web_form',
    created_at: leadMatch.createdAt,
    updated_at: leadMatch.updatedAt,
    agent_notes: formatAgentNotesForApi(leadMatch.compatibility_factors),
    close_summary: formatCloseSummary(leadMatch.compatibility_factors),
  };
  if (includeIntentField) {
    core.intent = profileView.intent;
  }
  return core;
}

export function mapLeadMatchToListRow(leadMatch, profile, convo, includeConversion, opts = {}) {
  const profType = professionalTypeFromMatch(leadMatch, profile);
  const profileView = mapLeadProfileForApi(profile, profType);
  const conversion = buildConversion(leadMatch, profile, convo);
  const grade = leadMatch.lead_type?.split('_')[0] || null;
  const row = {
    ...leadCore(leadMatch, profileView, convo, opts),
    professional_type: profType,
  };
  if (includeAgentStyleLeadExperience(profType)) {
    Object.assign(row, buildExperienceBlocks(conversion, grade, profileView, leadMatch));
    if (includeConversion) row.conversion = conversion;
  } else if (includePlaybookConversionPack(profType) && includeConversion) {
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
    ...leadCore(leadMatch, profileView, convo, opts),
    professional_type: profType,
    icp_fit: leadMatch.icp_fit || null,
  };
  if (includeAgentStyleLeadExperience(profType)) {
    Object.assign(lead, buildExperienceBlocks(conversion, grade, profileView, leadMatch));
  }
  return lead;
}

export function mapLeadMatchUnderProfile(leadMatch, profile, convo, opts = {}) {
  const profType = profile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const profileView = mapLeadProfileForApi(profile, profType);
  const conversion = buildLeadConversionPack({
    leadMatch,
    leadProfile: profile,
    conversation: convo && convo._id ? convo : null,
  });
  const grade = leadMatch.lead_type?.split('_')[0] || null;
  const resolvedProfType = leadMatch.compatibility_factors?.professional_type || profType;

  const row = {
    ...leadCore(leadMatch, profileView, convo, opts),
    professional_type: resolvedProfType,
    icp_fit: leadMatch.icp_fit || null,
  };
  if (includeAgentStyleLeadExperience(resolvedProfType)) {
    Object.assign(row, buildExperienceBlocks(conversion, grade, profileView, leadMatch));
    row.conversion = conversion;
  } else if (includePlaybookConversionPack(resolvedProfType)) {
    row.conversion = conversion;
  }
  return row;
}
