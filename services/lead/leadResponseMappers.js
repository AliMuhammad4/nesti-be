import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
import { buildLeadConversionPack } from '../conversion/buildLeadConversionPack.js';
import { mapLeadProfileForApi } from './leadProfileFormat.js';

function professionalTypeFromMatch(leadMatch) {
  return leadMatch.compatibility_factors?.professional_type || PROFESSIONAL_TYPE.AGENT;
}

export function mapLeadMatchToListRow(leadMatch, profile, convo, includeConversion) {
  const profType = professionalTypeFromMatch(leadMatch);
  const profileView = mapLeadProfileForApi(profile, profType);
  const row = {
    id: String(leadMatch._id),
    professional_type: profType,
    intent: profileView.intent,
    lead_type: leadMatch.lead_type,
    grade: leadMatch.lead_type?.split('_')[0] || null,
    score: leadMatch.match_score,
    status: leadMatch.match_status,
    contact: profileView.contact,
    property: profileView.property,
    qualification: profileView.qualification,
    appointment_status: resolveAppointmentStatus(leadMatch.match_status, convo.calendly_booking_status),
    embed_token: leadMatch.compatibility_factors?.embed_token || null,
    session_id: leadMatch.compatibility_factors?.session_id || convo.session_id || null,
    conversation_id: String(leadMatch.conversation_id || ''),
    created_at: leadMatch.createdAt,
    updated_at: leadMatch.updatedAt,
  };
  if (includeConversion) {
    row.conversion = buildLeadConversionPack({
      leadMatch,
      leadProfile: profile && profile._id ? profile : null,
      conversation: convo && convo._id ? convo : null,
    });
  }
  return row;
}

export function mapLeadMatchToDetail(leadMatch, profile, convo, includeConversion) {
  const profType = professionalTypeFromMatch(leadMatch);
  const profileView = mapLeadProfileForApi(profile, profType);
  const lead = {
    id: String(leadMatch._id),
    professional_type: profType,
    intent: profileView.intent,
    lead_type: leadMatch.lead_type,
    grade: leadMatch.lead_type?.split('_')[0] || null,
    score: leadMatch.match_score,
    status: leadMatch.match_status,
    contact: profileView.contact,
    property: profileView.property,
    qualification: profileView.qualification,
    icp_fit: leadMatch.icp_fit || null,
    appointment_status: resolveAppointmentStatus(leadMatch.match_status, convo?.calendly_booking_status),
    embed_token: leadMatch.compatibility_factors?.embed_token || null,
    session_id: leadMatch.compatibility_factors?.session_id || convo?.session_id || null,
    conversation_id: String(leadMatch.conversation_id || ''),
    created_at: leadMatch.createdAt,
    updated_at: leadMatch.updatedAt,
  };
  if (includeConversion) {
    lead.conversion = buildLeadConversionPack({
      leadMatch,
      leadProfile: profile && profile._id ? profile : null,
      conversation: convo && convo._id ? convo : null,
    });
  }
  return lead;
}

export function mapLeadMatchUnderProfile(leadMatch, profile, convo) {
  const profType = profile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const profileView = mapLeadProfileForApi(profile, profType);
  return {
    id: String(leadMatch._id),
    professional_type: leadMatch.compatibility_factors?.professional_type || profType,
    intent: profileView.intent,
    lead_type: leadMatch.lead_type,
    grade: leadMatch.lead_type?.split('_')[0] || null,
    score: leadMatch.match_score,
    status: leadMatch.match_status,
    appointment_status: resolveAppointmentStatus(leadMatch.match_status, convo.calendly_booking_status),
    icp_fit: leadMatch.icp_fit || null,
    embed_token: leadMatch.compatibility_factors?.embed_token || null,
    session_id: leadMatch.compatibility_factors?.session_id || convo.session_id || null,
    conversation_id: String(leadMatch.conversation_id || ''),
    created_at: leadMatch.createdAt,
    updated_at: leadMatch.updatedAt,
    conversion: buildLeadConversionPack({
      leadMatch,
      leadProfile: profile,
      conversation: convo && convo._id ? convo : null,
    }),
  };
}
