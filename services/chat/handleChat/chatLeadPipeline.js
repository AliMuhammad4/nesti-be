import logger from '../../../utils/logger.js';
import LeadMatch from '../../../models/LeadMatch.js';
import LeadProfile from '../../../models/LeadProfile.js';
import ChatConversation from '../../../models/ChatConversation.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import { resolveAppointmentStatus } from '../../../utils/resolveAppointmentStatus.js';
import { buildWorkspaceLeadConversionPreview } from '../../conversion/buildLeadConversionPack.js';
import { emitWorkspaceLeadEvent } from '../../realtime/workspaceSocket.js';
import {
  emitNewLeadCreatedNotification,
  sendNewLeadCreatedEmailIfEnabled,
} from '../../realtime/leadCreatedNotify.js';
import { buildLeadType, buildMortgageBrokerLeadType } from '../scoring/common.js';
import { computeIcpFitForLead } from '../../lead/icpScoringService.js';
import { usesFixedBuyIntentForLeadMatch } from '../flows/flowRoleMeta.js';

function computeLeadTypeForMatch(flow, persistedGrade, aiIntent) {
  const role = flow?.flowRole;
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return buildMortgageBrokerLeadType(persistedGrade);
  }
  if (role === PROFESSIONAL_TYPE.LAWYER) {
    return `${persistedGrade}_client`;
  }
  const intent = aiIntent === 'sell' ? 'sell' : 'buy';
  return buildLeadType(persistedGrade, intent);
}

const LEAD_PROFILE_UPDATE_PATHS = {
  full_name: 'identity.full_name',
  email: 'identity.email',
  phone: 'identity.phone',
  property_address: 'property.address',
  location: 'property.location',
  budget: 'property.budget',
  expected_price: 'property.expected_price',
  timeline: 'property.timeline',
  bedrooms: 'property.bedrooms',
  bathrooms: 'property.bathrooms',
  square_footage: 'property.square_footage',
  property_type: 'property.property_type',
  must_have_features: 'property.must_have_features',
  parking_required: 'property.parking_required',
  backyard_needed: 'property.backyard_needed',
  school_district_important: 'property.school_district_important',
  preferred_contact_method: 'contact_preferences.preferred_contact_method',
  best_time_to_contact: 'contact_preferences.best_time_to_contact',
  realtor_status: 'qualification.agent.realtor_status',
  motivation_reason: 'qualification.agent.motivation_reason',
  viewing_readiness: 'qualification.agent.viewing_readiness',
  living_situation: 'qualification.agent.living_situation',
  urgency_readiness: 'qualification.agent.urgency_readiness',
  mortgage_timeline: 'qualification.mortgage_broker.mortgage_timeline',
  pre_approval_status: 'qualification.mortgage_broker.pre_approval_status',
  credit_score_range: 'qualification.mortgage_broker.credit_score_range',
  employment_status: 'qualification.mortgage_broker.employment_status',
  household_income: 'qualification.mortgage_broker.household_income',
  down_payment_readiness: 'qualification.mortgage_broker.down_payment_readiness',
  purchase_purpose: 'qualification.mortgage_broker.purchase_purpose',
  urgency_signal: 'qualification.mortgage_broker.urgency_signal',
  mortgage_property_budget: 'qualification.mortgage_broker.property_budget',
  transaction_stage: 'qualification.lawyer.transaction_stage',
  closing_timeline: 'qualification.lawyer.closing_timeline',
  transaction_type: 'qualification.lawyer.transaction_type',
  property_value: 'qualification.lawyer.property_value',
  realtor_involved: 'qualification.lawyer.realtor_involved',
  first_time_buyer: 'qualification.lawyer.first_time_buyer',
  legal_services_needed: 'qualification.lawyer.legal_services_needed',
};
export async function syncLeadMatchAfterTurn({
  flow,
  flowType,
  canCreateLeads,
  conversation,
  userId,
  professionalProfile,
  hasContact,
  contactInfo,
  conversationText,
  trimmedMessage,
  sessionId,
  embedToken,
  clientIp,
  userAgent,
  referer,
  formContact,
  parsedAiDetails,
  finalScore,
  persistedGrade,
  leadMeta,
  aiIntent,
}) {
  const intentSuffix = flow.getIntentSuffix(aiIntent);
  const existingLeadMatch = canCreateLeads
    ? await LeadMatch.findOne({
        conversation_id: conversation._id,
        user_id: userId,
        lead_type: new RegExp(`${intentSuffix}$`),
      })
    : null;

  if (canCreateLeads && !existingLeadMatch && professionalProfile && hasContact) {
    const derivedQual = flow.deriveQualificationFromText(conversationText);
    const mergedAiDetails = flow.getMergedAiDetails(parsedAiDetails, derivedQual);

    const newLeadMatch = await flow.createNewLead({
      conversation,
      intent: usesFixedBuyIntentForLeadMatch(flow) ? 'buy' : aiIntent,
      professionalProfileId: professionalProfile._id,
      activeIcpProfileId: professionalProfile.active_icp_profile_id || null,
      leadScore: finalScore,
      leadGrade: persistedGrade,
      leadMeta,
      sessionId,
      embedToken,
      clientIp,
      userAgent,
      referer,
      contactInfo,
      userId,
      messageSnippet: trimmedMessage.slice(0, 200),
      formContact: formContact && typeof formContact === 'object' ? formContact : {},
      aiDetails: mergedAiDetails,
    });
    if (newLeadMatch?._id) {
      logger.info('Chat service: new lead match created', {
        op: 'chat.lead',
        flow: flowType,
        conversation_id: String(conversation._id),
        session_id: sessionId,
        lead_match_id: String(newLeadMatch._id),
        owner_user_id: String(userId),
        lead_grade: persistedGrade,
        intent: aiIntent,
      });
      try {
        const convo = await ChatConversation.findById(conversation._id)
          .select('calendly_booking_status lead_reasons last_interaction_at intent')
          .lean();
        const appointment_status = resolveAppointmentStatus(newLeadMatch.match_status, convo?.calendly_booking_status);
        const socketIntent = usesFixedBuyIntentForLeadMatch(flow) ? 'buy' : aiIntent;
        const conversion_preview = buildWorkspaceLeadConversionPreview({
          leadMatch: newLeadMatch,
          conversation: convo || conversation,
          intent: socketIntent,
        });
        emitWorkspaceLeadEvent(userId, {
          kind: 'lead_created',
          lead_match_id: String(newLeadMatch._id),
          lead_profile_id: newLeadMatch.lead_profile_id ? String(newLeadMatch.lead_profile_id) : null,
          conversation_id: String(conversation._id),
          session_id: sessionId,
          grade: persistedGrade,
          score: Number(newLeadMatch.match_score ?? finalScore),
          intent: socketIntent,
          icp_fit_tier: newLeadMatch.icp_fit?.fit_tier ?? null,
          icp_fit_score: newLeadMatch.icp_fit?.fit_score ?? null,
          appointment_status,
          high_intent: persistedGrade === 'hot' || persistedGrade === 'warm',
          conversion_preview,
        });
        await emitNewLeadCreatedNotification(userId, {
          newLeadMatch,
          conversationId: conversation._id,
          sessionId,
          persistedGrade,
          finalScore,
          socketIntent,
          appointment_status,
          conversion_preview,
        });
        void sendNewLeadCreatedEmailIfEnabled(userId, {
          newLeadMatch,
          persistedGrade,
          conversion_preview,
        });
      } catch (e) {
        logger.warn('Workspace lead event (create) failed', { error: e.message });
      }
    }
    return;
  }

  if (!canCreateLeads || !existingLeadMatch || !hasContact) return;

  const prevContact = existingLeadMatch.compatibility_factors?.contact || {};
  const hasNewInfo =
    (contactInfo.email && contactInfo.email !== prevContact.email) ||
    (contactInfo.phone && contactInfo.phone !== prevContact.phone);

  const nextFactors =
    existingLeadMatch.compatibility_factors && typeof existingLeadMatch.compatibility_factors === 'object'
      ? { ...existingLeadMatch.compatibility_factors }
      : {};
  if (hasNewInfo) {
    existingLeadMatch.last_contact_at = new Date();
    existingLeadMatch.contact_count = (existingLeadMatch.contact_count || 0) + 1;
    nextFactors.contact = contactInfo;
  }
  nextFactors.lead_grade = persistedGrade;
  nextFactors.message_snippet = trimmedMessage.slice(0, 200);
  existingLeadMatch.compatibility_factors = nextFactors;

  existingLeadMatch.match_score = finalScore;
  existingLeadMatch.lead_type = computeLeadTypeForMatch(flow, persistedGrade, aiIntent);

  await existingLeadMatch.save();

  let profileQualFieldCount = 0;
  if (existingLeadMatch.lead_profile_id) {
    const derivedQual = flow.deriveQualificationFromText(conversationText);
    const mergedQual = flow.getLeadProfileUpdate(parsedAiDetails, derivedQual, formContact);
    const qualUpdate = {};
    for (const [k, v] of Object.entries(mergedQual)) {
      if (v === undefined) continue;
      if (v === '' && k !== 'budget') continue;
      if (k === 'mortgage_status') {
        if (flowType === 'lawyer') qualUpdate['qualification.lawyer.mortgage_status'] = v;
        else qualUpdate['qualification.agent.mortgage_status'] = v;
        continue;
      }
      const mappedPath = LEAD_PROFILE_UPDATE_PATHS[k];
      if (mappedPath) qualUpdate[mappedPath] = v;
    }

    const scoringUpdate = {
      'scoring.current_score': finalScore,
      'scoring.current_grade': persistedGrade,
      'scoring.last_scored_at': new Date(),
      total_score: finalScore,
    };
    if (leadMeta?.sub_scores && typeof leadMeta.sub_scores === 'object') {
      scoringUpdate['scoring.components'] = leadMeta.sub_scores;
    }

    await LeadProfile.findByIdAndUpdate(existingLeadMatch.lead_profile_id, {
      $set: { ...qualUpdate, ...scoringUpdate },
    });

    profileQualFieldCount = Object.keys(qualUpdate).length;

    if (profileQualFieldCount) {
      try {
        const leadProfile = await LeadProfile.findById(existingLeadMatch.lead_profile_id).lean();
        if (leadProfile) {
          const fit = await computeIcpFitForLead(leadProfile, userId, {
            reusedExisting: true,
            activeIcpProfileId: professionalProfile?.active_icp_profile_id || null,
          });
          if (fit) {
            await LeadMatch.findByIdAndUpdate(existingLeadMatch._id, {
              $set: {
                icp_fit: {
                  fit_score: fit.fit_score,
                  fit_tier: fit.fit_tier,
                  matched_factors: fit.matched_factors,
                  missing_factors: fit.missing_factors,
                },
              },
            });
          }
        }
      } catch (err) {
        logger.warn('ICP rescore after lead profile update failed', { error: err.message });
      }
    }
  }

  try {
    const fresh = await LeadMatch.findById(existingLeadMatch._id).lean();
    const convo = fresh?.conversation_id
      ? await ChatConversation.findById(fresh.conversation_id)
          .select('calendly_booking_status lead_reasons last_interaction_at intent')
          .lean()
      : null;
    const appointment_status = resolveAppointmentStatus(fresh?.match_status, convo?.calendly_booking_status);
    const socketIntent = usesFixedBuyIntentForLeadMatch(flow) ? 'buy' : aiIntent;
    const conversion_preview = buildWorkspaceLeadConversionPreview({
      leadMatch: fresh || existingLeadMatch,
      conversation: convo || conversation,
      intent: socketIntent,
    });
    emitWorkspaceLeadEvent(userId, {
      kind: 'lead_updated',
      lead_match_id: String(existingLeadMatch._id),
      lead_profile_id: fresh?.lead_profile_id ? String(fresh.lead_profile_id) : null,
      conversation_id: fresh?.conversation_id ? String(fresh.conversation_id) : null,
      session_id: sessionId,
      grade: persistedGrade,
      score: Number(fresh?.match_score ?? finalScore),
      intent: socketIntent,
      icp_fit_tier: fresh?.icp_fit?.fit_tier ?? null,
      icp_fit_score: fresh?.icp_fit?.fit_score ?? null,
      appointment_status,
      high_intent: persistedGrade === 'hot' || persistedGrade === 'warm',
      profile_fields_updated: profileQualFieldCount > 0,
      conversion_preview,
    });
  } catch (e) {
    logger.warn('Workspace lead event (update) failed', { error: e.message });
  }
}
