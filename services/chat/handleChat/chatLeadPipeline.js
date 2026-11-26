import logger from '../../../utils/logger.js';
import { afterLeadCapturedNotifyOverQuota } from '../../billing/planQuota.js';
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
import { buildLeadType, buildLawyerLeadType, buildMortgageBrokerLeadType } from '../scoring/common.js';
import { computeIcpFitForLead } from '../../lead/icpScoringService.js';
import { usesFixedBuyIntentForLeadMatch } from '../flows/flowRoleMeta.js';
import { linkConversationDocumentsToLead } from '../documents/chatDocumentService.js';
import { notifyClientsOfNewPropertyForSale } from '../../property/propertyClientNotifications.js';
import { maybeLandingSideEffects, notifyAdminsOfLandingLead } from '../nestiLanding/notifyAdminsOfLandingLead.js';
import { withExclusiveKey } from '../../../utils/exclusiveKey.js';
import { LEAD_ANSWER_KEYS } from '../../lead/leadOwnAnswers.js';

function duplicateLeadSlot(error) {
  return error?.code === 11000 || error?.cause?.code === 11000;
}

export function existingLeadTypePattern(intentSuffix, clientType = '') {
  const suffixes = [String(intentSuffix || 'lead')];
  if (suffixes[0] !== 'seller' || String(clientType || '').toLowerCase() === 'investor') suffixes.push('investor');
  return new RegExp(`(${[...new Set(suffixes)].join('|')})$`);
}

async function findExistingLeadMatch({ conversationId, userId, intentSuffix, clientType }) {
  const query = LeadMatch.findOne({
    conversation_id: conversationId,
    user_id: userId,
    lead_type: existingLeadTypePattern(intentSuffix, clientType),
  });
  return typeof query?.sort === 'function' ? query.sort({ last_contact_at: -1, updatedAt: -1 }) : query;
}

function resolveMatchClientType(formContact, aiIntent) {
  const fromForm = String(formContact?.client_type || '').trim().toLowerCase();
  if (fromForm) return fromForm;
  if (String(formContact?.purchase_purpose || '').toLowerCase() === 'investment') return 'investor';
  if (String(formContact?.motivation_reason || '').toLowerCase() === 'investment') return 'investor';
  if (String(formContact?.investment_type || '').trim() || String(formContact?.investment_goal || '').trim()) {
    return 'investor';
  }
  return '';
}

function computeLeadTypeForMatch(flow, persistedGrade, aiIntent, formContact = null) {
  const clientType = resolveMatchClientType(formContact, aiIntent);
  if (typeof flow?.computeLeadType === 'function') {
    return flow.computeLeadType(persistedGrade, aiIntent, clientType);
  }
  const role = flow?.flowRole;
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return buildMortgageBrokerLeadType(persistedGrade, clientType);
  }
  if (role === PROFESSIONAL_TYPE.LAWYER) {
    return buildLawyerLeadType(persistedGrade, clientType);
  }
  const intent = aiIntent === 'sell' ? 'sell' : 'buy';
  return buildLeadType(persistedGrade, intent, clientType);
}

export const LEAD_PROFILE_UPDATE_PATHS = {
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
  mortgage_status: 'qualification.agent.mortgage_status',
  motivation_reason: 'qualification.agent.motivation_reason',
  viewing_readiness: 'qualification.agent.viewing_readiness',
  living_situation: 'qualification.agent.living_situation',
  urgency_readiness: 'qualification.agent.urgency_readiness',
  buy_property_location: 'qualification.agent.buy_property_location',
  investment_type: 'qualification.agent.investment_type',
  investment_goal: 'qualification.agent.investment_goal',
  owns_investments: 'qualification.agent.owns_investments',
  down_payment_readiness: 'qualification.agent.down_payment_readiness',
  agent_market_country: 'qualification.agent.market_country',
  agent_market_region: 'qualification.agent.market_region',
  agent_market_city: 'qualification.agent.market_city',
  agent_market_country_name: 'qualification.agent.market_country_name',
  mortgage_timeline: 'qualification.mortgage_broker.mortgage_timeline',
  pre_approval_status: 'qualification.mortgage_broker.pre_approval_status',
  credit_score_range: 'qualification.mortgage_broker.credit_score_range',
  employment_status: 'qualification.mortgage_broker.employment_status',
  household_income: 'qualification.mortgage_broker.household_income',
  mortgage_down_payment_readiness: 'qualification.mortgage_broker.down_payment_readiness',
  purchase_purpose: 'qualification.mortgage_broker.purchase_purpose',
  urgency_signal: 'qualification.mortgage_broker.urgency_signal',
  mortgage_property_budget: 'qualification.mortgage_broker.property_budget',
  mortgage_investment_type: 'qualification.mortgage_broker.investment_type',
  mortgage_owns_investments: 'qualification.mortgage_broker.owns_investments',
  mortgage_investment_financing: 'qualification.mortgage_broker.investment_financing',
  mortgage_borrower_entity: 'qualification.mortgage_broker.borrower_entity',
  mortgage_market_country: 'qualification.mortgage_broker.market_country',
  mortgage_market_region: 'qualification.mortgage_broker.market_region',
  mortgage_market_city: 'qualification.mortgage_broker.market_city',
  mortgage_market_country_name: 'qualification.mortgage_broker.market_country_name',
  transaction_stage: 'qualification.lawyer.transaction_stage',
  closing_timeline: 'qualification.lawyer.closing_timeline',
  transaction_type: 'qualification.lawyer.transaction_type',
  property_value: 'qualification.lawyer.property_value',
  realtor_involved: 'qualification.lawyer.realtor_involved',
  first_time_buyer: 'qualification.lawyer.first_time_buyer',
  legal_services_needed: 'qualification.lawyer.legal_services_needed',
  via_company: 'qualification.lawyer.via_company',
  lawyer_market_country: 'qualification.lawyer.market_country',
  lawyer_market_region: 'qualification.lawyer.market_region',
  lawyer_market_city: 'qualification.lawyer.market_city',
  lawyer_market_country_name: 'qualification.lawyer.market_country_name',
};

function hasMeaningfulSellerListingUpdate(previousProfile = {}, mergedQual = {}) {
  const prevProperty = previousProfile?.property || {};
  const prevAddress = String(prevProperty.address || '').trim().toLowerCase();
  const prevLocation = String(prevProperty.location || '').trim().toLowerCase();
  const prevPrice = String(prevProperty.expected_price || '').trim();
  const prevImages = Array.isArray(prevProperty.images) ? prevProperty.images.length : 0;

  const nextAddress = String(mergedQual.property_address || '').trim();
  const nextLocation = String(mergedQual.location || '').trim();
  const nextPrice = String(mergedQual.expected_price || mergedQual.budget || '').trim();

  const nowHasCoreListing =
    Boolean(nextAddress) || Boolean(nextLocation) || Boolean(nextPrice);
  const hadCoreListing =
    Boolean(prevAddress) || Boolean(prevLocation) || Boolean(prevPrice) || prevImages > 0;

  if (nowHasCoreListing && !hadCoreListing) return true;
  if (nextAddress && nextAddress.toLowerCase() !== prevAddress) return true;
  if (nextLocation && nextLocation.toLowerCase() !== prevLocation) return true;
  if (nextPrice && nextPrice !== prevPrice) return true;
  return false;
}

/** `compatibility_factors.lead_answers.*` $set for the lawyer / broker answers in a profile qualification update. */
export function leadAnswersUpdateFor(flowType, qualUpdate = {}) {
  const section = flowType === PROFESSIONAL_TYPE.LAWYER
    ? 'lawyer'
    : flowType === PROFESSIONAL_TYPE.MORTGAGE_BROKER ? 'mortgage_broker' : '';
  const keys = LEAD_ANSWER_KEYS[flowType];
  if (!section || !keys) return {};
  const prefix = `qualification.${section}.`;
  const out = {};
  for (const [path, value] of Object.entries(qualUpdate)) {
    if (!path.startsWith(prefix)) continue;
    const key = path.slice(prefix.length);
    if (keys.includes(key) && String(value ?? '').trim()) {
      out[`compatibility_factors.lead_answers.${key}`] = String(value).trim();
    }
  }
  return out;
}

export async function applyLeadClientTypeExtras(leadMatch, extras) {
  if (!leadMatch?.lead_profile_id || !extras?.client_type) return;
  const set = {
    client_type: extras.client_type,
    suggested_next_action: { ...(extras.suggested_next_action || {}), updated_at: new Date() },
  };
  Object.entries(extras.template_answers || {}).forEach(([id, value]) => {
    if (/^[a-z0-9_]+$/.test(id) && String(value || '').trim()) set[`template_answers.${id}`] = String(value).trim().slice(0, 160);
  });
  await LeadProfile.updateOne({ _id: leadMatch.lead_profile_id }, { $set: set });
  // The same client type / answers on the lead itself, so the person's other leads keep their own.
  if (!leadMatch?._id) return;
  const own = { 'compatibility_factors.client_type': extras.client_type };
  Object.entries(set).forEach(([path, value]) => {
    if (path.startsWith('template_answers.')) own[`compatibility_factors.${path}`] = value;
  });
  await LeadMatch.updateOne({ _id: leadMatch._id }, { $set: own });
}

export async function syncLeadMatchAfterTurn(args) {
  const conversationId = args?.conversation?._id ? String(args.conversation._id) : '';
  const formIntent = args?.formContact?.intent === 'sell' || args?.formContact?.intent === 'buy'
    ? args.formContact.intent
    : null;
  const leadIntent = usesFixedBuyIntentForLeadMatch(args?.flow) ? 'unspecified' : (formIntent || args?.aiIntent);
  const intentSuffix = args?.flow?.getIntentSuffix ? args.flow.getIntentSuffix(leadIntent) : 'lead';
  const lockSuffix = intentSuffix === 'seller' && resolveMatchClientType(args?.formContact, args?.aiIntent) === 'investor'
    ? 'buyer'
    : intentSuffix;
  const key = conversationId ? `lead:${args.userId}:${conversationId}:${lockSuffix}` : '';
  if (!key) return syncLeadMatchBody(args);
  return withExclusiveKey(key, () => syncLeadMatchBody(args));
}

async function syncLeadMatchBody({
  flow,
  flowType,
  canCreateLeads,
  clientTypeExtras = null,
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
  forceCreateLead = false,
  existingLeadMatchPrefetched,
}) {
  const formIntent =
    formContact?.intent === 'sell' || formContact?.intent === 'buy'
      ? formContact.intent
      : null;
  const leadIntent = usesFixedBuyIntentForLeadMatch(flow) ? 'unspecified' : (formIntent || aiIntent);
  const intentSuffix = flow.getIntentSuffix(leadIntent);
  const matchClientType = resolveMatchClientType(formContact, aiIntent);
  let existingLeadMatch = canCreateLeads && !forceCreateLead && existingLeadMatchPrefetched?._id
    ? existingLeadMatchPrefetched
    : null;
  if (canCreateLeads && !forceCreateLead && !existingLeadMatch) {
    existingLeadMatch = await findExistingLeadMatch({
      conversationId: conversation._id,
      userId,
      intentSuffix,
      clientType: matchClientType,
    });
  }
  const creatingNewLead = forceCreateLead || !existingLeadMatch;

  const profileRequiredForNewLead = flow?.flowRole === PROFESSIONAL_TYPE.AGENT;
  const canPersistNewLead = hasContact && (!profileRequiredForNewLead || professionalProfile);

  if (canCreateLeads && creatingNewLead && !canPersistNewLead) {
    logger.warn('Chat service: lead not persisted (precheck)', {
      op: 'chat.lead',
      flow: flowType,
      reason: !hasContact ? 'no_contact_identity' : 'agent_missing_professional_profile',
      user_id: String(userId),
      conversation_id: String(conversation._id),
      session_id: sessionId,
    });
  }

  if (canCreateLeads && creatingNewLead && canPersistNewLead) {
    if (!professionalProfile && !profileRequiredForNewLead) {
      logger.warn('Chat service: creating lawyer/broker lead without ProfessionalProfile — complete Settings for full ICP', {
        op: 'chat.lead',
        flow: flowType,
        user_id: String(userId),
        conversation_id: String(conversation._id),
      });
    }
    const derivedQual = flow.deriveQualificationFromText(conversationText);
    const mergedAiDetails = flow.getMergedAiDetails(parsedAiDetails, derivedQual);

    let newLeadMatch = null;
    try {
      newLeadMatch = await flow.createNewLead({
      conversation,
      intent: leadIntent,
      professionalProfileId: professionalProfile?._id || null,
      activeIcpProfileId: professionalProfile?.active_icp_profile_id || null,
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
    } catch (error) {
      if (!duplicateLeadSlot(error)) throw error;
      // The slot is taken: pick up that row (investor or not) and fall through to the update path below.
      existingLeadMatch = await findExistingLeadMatch({
        conversationId: conversation._id,
        userId,
        intentSuffix,
        clientType: matchClientType,
      });
      logger.warn('Chat service: lead already exists for this conversation', {
        op: 'chat.lead',
        session_id: sessionId,
        conversation_id: String(conversation._id),
      });
    }
    if (newLeadMatch?._id) {
      await linkConversationDocumentsToLead({
        userId,
        conversationId: conversation._id,
        sessionId,
        leadMatchId: newLeadMatch._id,
      }).catch((error) => logger.warn('Chat document link failed', { error: error?.message }));
      if (clientTypeExtras) {
        await applyLeadClientTypeExtras(newLeadMatch, clientTypeExtras)
          .catch((error) => logger.warn('Lead client type extras failed', { error: error?.message }));
      }
      logger.info('Chat service: new lead match created', {
        op: 'chat.lead',
        flow: flowType,
        conversation_id: String(conversation._id),
        session_id: sessionId,
        lead_match_id: String(newLeadMatch._id),
        owner_user_id: String(userId),
        lead_grade: persistedGrade,
        intent: leadIntent,
      });
      try {
        const convo = await ChatConversation.findById(conversation._id)
          .select('calendly_booking_status lead_reasons last_interaction_at intent')
          .lean();
        const appointment_status = resolveAppointmentStatus(newLeadMatch.match_status, convo?.calendly_booking_status);
        const socketIntent = leadIntent;
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
        const fc = formContact || {};
        const ai = parsedAiDetails || {};
        void sendNewLeadCreatedEmailIfEnabled(userId, {
          newLeadMatch,
          persistedGrade,
          conversion_preview,
          // Same detail rows as inquiry / public-form emails (market, budget in USD, investor fields).
          details: {
            type: 'chat_lead',
            professional_type: flowType,
            client_name: contactInfo?.name || fc.name || fc.full_name || '',
            intent: leadIntent,
            client_type: fc.client_type || matchClientType || '',
            purchase_purpose: fc.purchase_purpose || '',
            via_company: fc.via_company || '',
            investment_type: fc.investment_type || ai.investment_type || '',
            owns_investments: fc.owns_investments || '',
            investment_financing: fc.investment_financing || '',
            borrower_entity: fc.borrower_entity || '',
            preferred_location: fc.location || fc.buy_property_location || fc.address || fc.property_address || ai.location || '',
            timeline: fc.timeline || fc.mortgage_timeline || fc.closing_timeline || '',
            market_country: fc.market_country || '',
            market_region: fc.market_region || '',
            market_city: fc.market_city || '',
            market_country_name: fc.market_country_name || '',
            budget: fc.budget || fc.property_budget || fc.property_value || fc.price || '',
          },
        }).catch((error) => logger.warn('New lead email failed', { error: error?.message }));
        if (flow.landingMode) {
          void notifyAdminsOfLandingLead({
            leadMatch: newLeadMatch,
            persistedGrade,
            finalScore,
            conversationId: conversation._id,
            sessionId,
          }).catch((error) => logger.warn('Landing lead admin notify failed', { error: error?.message }));
          void maybeLandingSideEffects({ leadMatch: newLeadMatch, contactInfo }).catch((error) => {
            logger.warn('Landing lead follow-up failed', { error: error?.message });
          });
        }
        await afterLeadCapturedNotifyOverQuota(userId);
      } catch (e) {
        logger.warn('Workspace lead event (create) failed', { error: e.message });
      }
      return;
    }
  }

  if (!canCreateLeads || !existingLeadMatch) return;
  if (clientTypeExtras) {
    void applyLeadClientTypeExtras(existingLeadMatch, clientTypeExtras)
      .catch((error) => logger.warn('Lead client type extras failed', { error: error?.message }));
  }
  await linkConversationDocumentsToLead({
    userId,
    conversationId: conversation._id,
    sessionId,
    leadMatchId: existingLeadMatch._id,
  }).catch((error) => logger.warn('Chat document link failed', { error: error?.message }));
  if (!hasContact) return;

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
  if (flow.landingMode) {
    nextFactors.source = 'landing_chat';
    nextFactors.page_path = '/';
    if (formContact?.audience_role) nextFactors.audience_role = String(formContact.audience_role);
  }
  existingLeadMatch.compatibility_factors = nextFactors;

  existingLeadMatch.match_score = finalScore;
  existingLeadMatch.lead_type = computeLeadTypeForMatch(flow, persistedGrade, leadIntent, formContact);

  await existingLeadMatch.save();

  let profileQualFieldCount = 0;
  if (existingLeadMatch.lead_profile_id) {
    const derivedQual = flow.deriveQualificationFromText(conversationText);
    const mergedQual = flow.getLeadProfileUpdate(parsedAiDetails, derivedQual, formContact);
    const previousLeadProfile = await LeadProfile.findById(existingLeadMatch.lead_profile_id)
      .select('property.address property.location property.expected_price property.images')
      .lean();
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
    // Keep this lawyer / broker lead's own answers current too (the shared profile serves all of the person's leads).
    const answersUpdate = leadAnswersUpdateFor(flowType, qualUpdate);
    if (Object.keys(answersUpdate).length) {
      await LeadMatch.updateOne({ _id: existingLeadMatch._id }, { $set: answersUpdate });
    }

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

    if (
      leadIntent === 'sell' &&
      hasMeaningfulSellerListingUpdate(previousLeadProfile, mergedQual)
    ) {
      void notifyClientsOfNewPropertyForSale(existingLeadMatch.lead_profile_id).catch((err) => {
        logger.warn('New property client notifications failed (lead update)', { error: err?.message });
      });
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
    const socketIntent = leadIntent;
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
