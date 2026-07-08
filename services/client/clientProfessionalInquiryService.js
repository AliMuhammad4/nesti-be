import LeadProfile from '../../models/LeadProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import ClientProfile from '../../models/ClientProfile.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import { PROFESSIONAL_TYPE, USER_ROLE } from '../../constants/roles.js';
import { buildLawyerLeadType, normalizeGradeForLeadType } from '../chat/scoring/common.js';
import {
  deriveLawyerQualificationFromText,
  scoreLawyerLead,
} from '../chat/scoring/lawyerScoring.js';
import { computeIcpFitForLead } from '../lead/icpScoringService.js';
import { emitNewLeadCreatedNotification } from '../realtime/leadCreatedNotify.js';
import { emitWorkspaceLeadEvent } from '../realtime/workspaceSocket.js';
import { buildWorkspaceLeadConversionPreview } from '../conversion/buildLeadConversionPack.js';

function clientDisplayName(user = {}) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.email || 'Client';
}

function toText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  const text = toText(value);
  return text ? [text] : [];
}

function mapBudgetToLawyerPropertyValue(rawBudget) {
  const budget = Number(rawBudget);
  if (!Number.isFinite(budget) || budget <= 0) return '';
  if (budget < 400_000) return 'under_400k';
  if (budget < 700_000) return '400k_700k';
  if (budget < 1_000_000) return '700k_1m';
  return '1m_plus';
}

function mapTimelineToLawyerClosing(rawTimeline) {
  const timeline = String(rawTimeline || '').toLowerCase();
  if (!timeline) return '';
  if (timeline.includes('asap') || timeline.includes('1-3') || timeline.includes('1 month')) return 'within_30_days';
  if (timeline.includes('3-6')) return '30_60_days';
  if (timeline.includes('6-12')) return '60_90_days';
  if (timeline.includes('browsing') || timeline.includes('exploring')) return 'unknown';
  return '';
}

function mapMortgageStatusForLawyer(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (!status) return '';
  if (status.includes('fully') || status.includes('approved')) return 'fully_approved';
  if (status.includes('conditional')) return 'conditional_approval';
  if (status.includes('apply') || status.includes('pending') || status.includes('not')) return 'still_applying';
  return '';
}

function mapRealtorInvolved(rawStatus) {
  const value = String(rawStatus || '').toLowerCase();
  if (!value) return '';
  if (value.includes('have') || value.includes('working') || value.includes('yes')) return 'yes';
  if (value.includes('no') || value.includes('not')) return 'no';
  return '';
}

function deriveFirstTimeBuyerFromProfile(clientProfile = {}) {
  const goals = [...toArray(clientProfile?.home_goals), toText(clientProfile?.home_goal)].filter(Boolean);
  const goalText = goals.join(' ').toLowerCase();
  return goalText.includes('first') ? 'yes' : '';
}

function mapTransactionTypeFromProfile(clientProfile = {}) {
  const goals = [...toArray(clientProfile?.home_goals), toText(clientProfile?.home_goal)].filter(Boolean);
  const goalText = goals.join(' ').toLowerCase();
  if (goalText.includes('refinanc')) return 'refinance';
  if (goalText.includes('sale') || goalText.includes('sell')) return 'home_sale';
  return 'home_purchase';
}

export function buildClientProfileSnapshot(clientProfile = {}) {
  return {
    preferred_location: clientProfile?.preferred_location || '',
    preferred_locations: Array.isArray(clientProfile?.preferred_locations) ? clientProfile.preferred_locations : [],
    purchase_timeline: clientProfile?.purchase_timeline || '',
    dream_home_price: clientProfile?.dream_home_price || null,
    mortgage_status: clientProfile?.mortgage_status || '',
    realtor_status: clientProfile?.realtor_status || '',
    offer_readiness: clientProfile?.offer_readiness || '',
    home_goals: Array.isArray(clientProfile?.home_goals) ? clientProfile.home_goals : [],
    home_goal: clientProfile?.home_goal || '',
    annual_income: clientProfile?.annual_income || null,
    employment_status: clientProfile?.employment_status || '',
    current_savings: clientProfile?.current_savings || null,
    monthly_savings: clientProfile?.monthly_savings || null,
    down_payment_goal: clientProfile?.down_payment_goal || null,
  };
}

export function normalizeLawyerInquiryBody(body = {}) {
  return {
    message: toText(body.message),
    transaction_type: toText(body.transaction_type),
    closing_timeline: toText(body.closing_timeline),
    legal_services_needed: toText(body.legal_services_needed),
    property_address: toText(body.property_address || body.location),
    property_value: toText(body.property_value),
  };
}

export function validateLawyerInquiryInput(payload = {}) {
  if (!payload.message) return 'Please enter your question.';
  if (!payload.transaction_type) return 'Transaction type is required.';
  if (!payload.closing_timeline) return 'Closing timeline is required.';
  if (!payload.legal_services_needed) return 'Legal service selection is required.';
  return '';
}

function pickPreferredContactMethod(clientProfile = {}) {
  const preferred = toText(clientProfile?.preferred_contact_method).toLowerCase();
  if (preferred) return preferred;
  return 'email';
}

export function resolveLawyerQualification(input, clientProfile = {}) {
  const inferredFromMessage = deriveLawyerQualificationFromText(input.message || '');
  const transactionType =
    input.transaction_type ||
    inferredFromMessage.transaction_type ||
    mapTransactionTypeFromProfile(clientProfile);
  const closingTimeline =
    input.closing_timeline ||
    inferredFromMessage.closing_timeline ||
    mapTimelineToLawyerClosing(clientProfile?.purchase_timeline);
  const propertyValue =
    input.property_value ||
    inferredFromMessage.property_value ||
    mapBudgetToLawyerPropertyValue(clientProfile?.dream_home_price);

  return {
    transaction_stage: inferredFromMessage.transaction_stage || 'pre_approval_stage',
    closing_timeline: closingTimeline,
    transaction_type: transactionType,
    property_value: propertyValue,
    mortgage_status:
      inferredFromMessage.mortgage_status || mapMortgageStatusForLawyer(clientProfile?.mortgage_status),
    realtor_involved:
      inferredFromMessage.realtor_involved || mapRealtorInvolved(clientProfile?.realtor_status),
    first_time_buyer:
      inferredFromMessage.first_time_buyer || deriveFirstTimeBuyerFromProfile(clientProfile),
    legal_services_needed: input.legal_services_needed || inferredFromMessage.legal_services_needed || 'full_closing',
    preferred_contact_method: pickPreferredContactMethod(clientProfile),
    best_time_to_contact: toText(clientProfile?.best_time_to_contact) || 'anytime',
  };
}

function buildLawyerInquiryNotificationDetails({
  clientName,
  normalizedInput,
  qualification,
  clientProfileSnapshot,
}) {
  return {
    type: 'lawyer_inquiry',
    client_name: clientName,
    inquiry_message: normalizedInput.message,
    transaction_type: qualification.transaction_type || '',
    closing_timeline: qualification.closing_timeline || '',
    legal_services_needed: qualification.legal_services_needed || '',
    property_address: normalizedInput.property_address || '',
    property_value: qualification.property_value || '',
    mortgage_status: qualification.mortgage_status || '',
    realtor_involved: qualification.realtor_involved || '',
    first_time_buyer: qualification.first_time_buyer || '',
    preferred_contact_method: qualification.preferred_contact_method || '',
    best_time_to_contact: qualification.best_time_to_contact || '',
    client_profile: clientProfileSnapshot || {},
  };
}

export async function submitClientLawyerInquiry({
  clientUserId,
  professionalUserId,
  body = {},
}) {
  const clientUser = await User.findById(clientUserId).select('first_name last_name email role phone').lean();
  if (!clientUser || String(clientUser.role || '').toLowerCase() !== USER_ROLE.CLIENT) {
    return { status: 403, body: { success: false, message: 'Only clients can submit lawyer inquiries' } };
  }

  if (!professionalUserId || String(professionalUserId) === String(clientUserId)) {
    return { status: 400, body: { success: false, message: 'Invalid lawyer profile' } };
  }

  const [professionalUser, professionalProfile, clientProfile] = await Promise.all([
    User.findById(professionalUserId).select('first_name last_name email role').lean(),
    ProfessionalProfile.findOne({ user_id: professionalUserId })
      .select('_id professional_type active_icp_profile_id location')
      .lean(),
    ClientProfile.findOne({ user_id: clientUserId }).lean(),
  ]);

  const professionalType = professionalProfile?.professional_type || professionalUser?.role || '';
  if (!professionalUser || String(professionalType).toLowerCase() !== PROFESSIONAL_TYPE.LAWYER) {
    return { status: 400, body: { success: false, message: 'Inquiry is only supported for lawyers' } };
  }

  const normalizedInput = normalizeLawyerInquiryBody(body);
  const validationError = validateLawyerInquiryInput(normalizedInput);
  if (validationError) {
    return { status: 400, body: { success: false, message: validationError } };
  }

  const clientName = clientDisplayName(clientUser);
  const clientProfileSnapshot = buildClientProfileSnapshot(clientProfile || {});
  const qualification = resolveLawyerQualification(normalizedInput, clientProfile || {});
  const contactInfo = {
    name: clientName,
    email: toText(clientUser.email),
    phone: toText(clientUser.phone),
    address: normalizedInput.property_address,
  };
  const hasContact = Boolean(contactInfo.email || contactInfo.phone);
  if (!hasContact) {
    return { status: 400, body: { success: false, message: 'Please add email or phone in your profile first.' } };
  }

  const scored = scoreLawyerLead({
    message: normalizedInput.message,
    hasContact,
    contactInfo,
    interactionCount: 1,
    seedSignals: {},
    formQualification: qualification,
  });
  const leadScore = Number(scored.leadScore || 0);
  const leadGrade = normalizeGradeForLeadType(scored.leadGrade || 'cold');
  const leadMeta = scored.leadMeta || {};

  const dedupeKey = `client_professional_inquiry:${String(clientUserId)}:${String(professionalUserId)}`;
  let leadProfile = await LeadProfile.findOne({ 'ownership.dedupe_key': dedupeKey });
  const profilePayload = {
    intent: 'unspecified',
    ownership: {
      user_id: professionalUserId,
      professional_type: PROFESSIONAL_TYPE.LAWYER,
      dedupe_key: dedupeKey,
    },
    identity: {
      full_name: clientName,
      email: contactInfo.email || '',
      phone: contactInfo.phone || '',
      canonical_email: contactInfo.email ? contactInfo.email.toLowerCase() : '',
      canonical_phone: contactInfo.phone || '',
    },
    lifecycle: {
      status: 'new',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      last_inquiry_at: new Date(),
    },
    contact_preferences: {
      preferred_contact_method: qualification.preferred_contact_method || '',
      best_time_to_contact: qualification.best_time_to_contact || '',
    },
    intent_summary: {
      primary_intent: 'client',
      buy_count: 0,
      sell_count: 0,
      client_count: 1,
    },
    property: {
      address: normalizedInput.property_address || '',
      location: normalizedInput.property_address || clientProfile?.preferred_location || '',
      budget: clientProfile?.dream_home_price ? String(clientProfile.dream_home_price) : '',
      expected_price: '',
      timeline: qualification.closing_timeline || '',
      must_have_features: normalizedInput.message,
    },
    qualification: {
      agent: {},
      mortgage_broker: {},
      lawyer: {
        transaction_stage: qualification.transaction_stage || '',
        closing_timeline: qualification.closing_timeline || '',
        transaction_type: qualification.transaction_type || '',
        property_value: qualification.property_value || '',
        mortgage_status: qualification.mortgage_status || '',
        realtor_involved: qualification.realtor_involved || '',
        first_time_buyer: qualification.first_time_buyer || '',
        legal_services_needed: qualification.legal_services_needed || '',
      },
    },
    source: 'client_professional_inquiry',
    scoring: {
      current_score: leadScore,
      current_grade: leadGrade,
      score_trend: 'stable',
      last_scored_at: new Date(),
      components: leadMeta.sub_scores || {},
    },
    total_score: leadScore,
    stats: {
      total_inquiries: 1,
      total_sessions: 1,
      total_matches: 1,
      buy_matches: 0,
      sell_matches: 0,
      client_matches: 1,
      last_seen_at: new Date(),
    },
  };

  if (leadProfile) {
    leadProfile.set({
      ownership: profilePayload.ownership,
      identity: profilePayload.identity,
      lifecycle: {
        ...(leadProfile.lifecycle?.toObject?.() || leadProfile.lifecycle || {}),
        last_seen_at: new Date(),
        last_inquiry_at: new Date(),
      },
      contact_preferences: profilePayload.contact_preferences,
      property: profilePayload.property,
      qualification: profilePayload.qualification,
      scoring: profilePayload.scoring,
      total_score: profilePayload.total_score,
      source: 'client_professional_inquiry',
    });
    leadProfile.stats = {
      ...(leadProfile.stats?.toObject?.() || leadProfile.stats || {}),
      total_inquiries: Number(leadProfile.stats?.total_inquiries || 0) + 1,
      last_seen_at: new Date(),
    };
    await leadProfile.save();
  } else {
    leadProfile = await LeadProfile.create(profilePayload);
  }

  let icpFit = null;
  try {
    icpFit = await computeIcpFitForLead(leadProfile, professionalUserId, {
      activeIcpProfileId: professionalProfile?.active_icp_profile_id || null,
    });
  } catch {
    // non-fatal
  }

  const leadMatchPayload = {
    user_id: professionalUserId,
    professional_profile_id: professionalProfile?._id || undefined,
    lead_type: buildLawyerLeadType(leadGrade),
    lead_profile_id: leadProfile._id,
    match_score: leadScore,
    match_status: 'new',
    compatibility_factors: {
      source: 'client_professional_inquiry',
      professional_type: PROFESSIONAL_TYPE.LAWYER,
      lead_grade: leadGrade,
      lead_reasons: leadMeta.lead_reasons || [],
      sub_scores: leadMeta.sub_scores || {},
      inquiry_message: normalizedInput.message,
      client_user_id: String(clientUserId),
      client_profile: clientProfileSnapshot,
      contact_preference: qualification.preferred_contact_method || '',
      best_time_to_contact: qualification.best_time_to_contact || '',
    },
    icp_fit: icpFit
      ? {
          fit_score: icpFit.fit_score,
          fit_tier: icpFit.fit_tier,
          matched_factors: icpFit.matched_factors,
          missing_factors: icpFit.missing_factors,
        }
      : undefined,
    last_contact_at: new Date(),
  };

  const leadMatch = await LeadMatch.create({
    ...leadMatchPayload,
    first_contact_at: new Date(),
    contact_count: 1,
  });

  await LeadProfile.updateOne({ _id: leadProfile._id }, { $addToSet: { lead_refs: leadMatch._id } });

  const conversionPreview = buildWorkspaceLeadConversionPreview({
    leadMatch,
    conversation: null,
    intent: null,
  });
  const lawyerInquiryDetails = buildLawyerInquiryNotificationDetails({
    clientName,
    normalizedInput,
    qualification,
    clientProfileSnapshot,
  });

  emitWorkspaceLeadEvent(professionalUserId, {
    kind: 'lead_created',
    lead_match_id: String(leadMatch._id),
    lead_profile_id: String(leadProfile._id),
    conversation_id: null,
    session_id: null,
    grade: leadGrade,
    score: Number(leadMatch.match_score ?? leadScore),
    appointment_status: 'none',
    high_intent: leadGrade === 'hot' || leadGrade === 'warm',
    conversion_preview: conversionPreview,
  });

  await emitNewLeadCreatedNotification(professionalUserId, {
    newLeadMatch: leadMatch,
    conversationId: null,
    sessionId: null,
    persistedGrade: leadGrade,
    finalScore: leadScore,
    socketIntent: null,
    appointment_status: 'none',
    conversion_preview: conversionPreview,
    details: lawyerInquiryDetails,
  });

  return {
    status: 201,
    body: {
      success: true,
      message: 'Inquiry sent to lawyer successfully',
      data: {
        lead_match_id: String(leadMatch._id),
        lead_profile_id: String(leadProfile._id),
        lead_score: leadScore,
        lead_grade: leadGrade,
      },
    },
  };
}
