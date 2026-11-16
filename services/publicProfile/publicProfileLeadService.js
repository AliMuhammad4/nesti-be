import { LeadMatch, ProfessionalProfile, ProfileViewEvent, PublicProfile } from '../../models/index.js';
import { TERMINAL_MATCH_STATUSES } from '../../utils/leadMatchStatus.js';
import { determineTrafficSource } from '../../utils/analyticsHelpers.js';
import {
  bumpLeadProfileStats,
  createOrReuseLeadProfile,
  createValidatedLeadAttribution,
  createValidatedLeadMatch,
} from '../chat/scoring/leadPersistence.js';
import { afterLeadCapturedNotifyOverQuota } from '../billing/planQuota.js';
import { emitNewLeadCreatedNotification, sendNewLeadCreatedEmailIfEnabled } from '../realtime/leadCreatedNotify.js';
import { normalizeTimeline, scoreLead as scoreAgentLead } from '../chat/scoring/agentScoring.js';
import { scoreLawyerLead } from '../chat/scoring/lawyerScoring.js';
import { scoreMortgageBrokerLead } from '../chat/scoring/mortgageBrokerScoring.js';
import { normalizeGradeForLeadType } from '../chat/scoring/common.js';
import {
  normalizeInquiredProperty,
  resolveLinkedSellerLeadMatchId,
} from '../lead/inquiredProperty.js';
import { notifyClientsOfNewPropertyForSale } from '../property/propertyClientNotifications.js';
import { createSupportRequestFromContactPage } from '../supportRequest/supportRequestService.js';
import { leadAnswersSnapshot } from '../lead/leadOwnAnswers.js';
import {
  publicProfileUnavailableResponse,
  userCanServePublicProfile,
} from './publicProfileAccess.js';
import {
  marketChoiceFromForm,
  normalizeMarketRegion,
} from '../professionalAssistant/brokerInvestorMarket.js';
import { normalizeInvestmentGoal, normalizeInvestmentType } from '../chat/scoring/common.js';
import {
  questionIdForStoredField,
  readQualificationAlias,
  storedFieldForQuestionId,
} from '../professionalAssistant/qualificationFieldAliases.js';

/** Vacant land / lot: no bedrooms, bathrooms, parking or backyard (same rule as the chat lead create). */
function isLandType(value) {
  return /\b(land|lot|acreage|vacant)\b/i.test(String(value || ''));
}

/** Agent form client type, saved like the chat lead create: investor, else buyer / seller from the intent. */
function agentFormClientType(intent, investor) {
  if (investor) return 'investor';
  if (intent === 'sell') return 'seller';
  if (intent === 'buy') return 'buyer';
  return '';
}

/** Investor answers the chat lead create also keeps (template answers + lead match factors). */
function agentInvestorAnswers(payload) {
  const investmentType = normalizeInvestmentType(payload?.investment_type || '');
  const investmentGoal = normalizeInvestmentGoal(payload?.investment_goal || '');
  const downPayment = readQualificationAlias(payload, 'down_payment') || '';
  return {
    investmentType,
    investmentGoal,
    ownsInvestments: payload?.owns_investments || '',
    downPayment,
  };
}

/** True when the public form visitor said they are an investor / buying an investment property. */
export function isPublicInvestorSubmission(payload = {}) {
  const p = payload || {};
  return String(p.intent || '').toLowerCase() === 'invest'
    || String(p.client_type || '').toLowerCase() === 'investor'
    || String(p.motivation_reason || '').toLowerCase() === 'investment'
    || String(p.purchase_purpose || '').toLowerCase() === 'investment';
}

/** Stored intent: agents buy / sell (investors buy), lawyers / brokers stay unspecified. */
export function resolvePublicSubmissionIntent(professionalType, payload = {}) {
  if (professionalType !== 'agent') return 'unspecified';
  if (isPublicInvestorSubmission(payload)) return 'buy';
  return payload?.intent === 'sell' ? 'sell' : 'buy';
}

export function resolveLeadTypeForSubmission(professionalType, intent, investor = false, grade = 'interested') {
  if (investor && intent !== 'sell') return `${grade}_investor`;
  if (professionalType !== 'agent') return `${grade}_client`;
  return intent === 'sell' ? `${grade}_seller` : `${grade}_buyer`;
}

/** Agent form leads get the chatbot's score and grade from the answers on the form (no house fields involved). */
export function scorePublicAgentFormLead(leadPayload, { message = '', contactInfo = {}, investor = false } = {}) {
  const property = leadPayload?.property || {};
  const agent = leadPayload?.qualification?.agent || {};
  const timeline = normalizeTimeline(String(property.timeline || '')) || '';
  const budget = String(property.budget || property.expected_price || '').trim();
  const location = String(property.location || property.address || '').trim();
  const hasContact = Boolean(contactInfo.email || contactInfo.phone);
  const scored = scoreAgentLead({
    message: [message, leadPayload?.intent, property.timeline, location, budget, property.property_type].filter(Boolean).join(' '),
    hasContact,
    contactInfo,
    interactionCount: 1,
    seedSignals: {
      ...(timeline ? { timeline } : {}),
      ...(location ? { location } : {}),
      ...(budget ? { budget } : {}),
      ...(property.property_type ? { property_type: property.property_type } : {}),
    },
    formQualification: { ...agent, ...(investor ? { client_type: 'investor' } : {}) },
  });
  return formScoreWithFloor(scored);
}

/** A form submission is never graded below the old flat "interested" 35; fuller answers score higher. */
function formScoreWithFloor(scored) {
  const score = Number(scored?.leadScore || 0);
  const grade = normalizeGradeForLeadType(scored?.leadGrade || 'cold');
  if (score < 40 || grade === 'cold') return { score: Math.max(score, 35), grade: 'interested' };
  return { score, grade };
}

/** Lawyer / mortgage broker form leads get their chatbot's score from the answers saved on the form. */
export function scorePublicClientFormLead(professionalType, leadPayload, { message = '', contactInfo = {}, investor = false } = {}) {
  const key = professionalType === 'lawyer' ? 'lawyer' : 'mortgage_broker';
  const qualification = leadPayload?.qualification?.[key] || {};
  const formQualification = { ...qualification, ...(investor ? { client_type: 'investor' } : {}) };
  const args = {
    message,
    hasContact: Boolean(contactInfo.email || contactInfo.phone),
    contactInfo,
    interactionCount: 1,
    formQualification,
  };
  return formScoreWithFloor(key === 'lawyer' ? scoreLawyerLead(args) : scoreMortgageBrokerLead(args));
}

/** Score for a storefront / contact page form lead (agents, lawyers, mortgage brokers). */
export function scorePublicFormLead(professionalType, intent, leadPayload, opts = {}) {
  if (professionalType === 'agent') {
    return intent === 'buy' || intent === 'sell'
      ? scorePublicAgentFormLead(leadPayload, opts)
      : { score: 35, grade: 'interested' };
  }
  if (professionalType === 'lawyer' || professionalType === 'mortgage_broker') {
    return scorePublicClientFormLead(professionalType, leadPayload, opts);
  }
  return { score: 35, grade: 'interested' };
}

function fallbackSessionId() {
  return `public-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fallbackVisitorId() {
  return `visitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizePropertyImages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((img) => {
      if (!img || typeof img !== 'object') return null;
      const secureUrl = String(img.secure_url || '').trim();
      const url = String(img.url || '').trim();
      const resolvedUrl = secureUrl || url;
      if (!resolvedUrl) return null;
      return {
        ...(img.public_id ? { public_id: String(img.public_id).trim() } : {}),
        ...(img.asset_id ? { asset_id: String(img.asset_id).trim() } : {}),
        url: resolvedUrl,
        secure_url: resolvedUrl,
        ...(img.width ? { width: Number(img.width) || undefined } : {}),
        ...(img.height ? { height: Number(img.height) || undefined } : {}),
        ...(img.format ? { format: String(img.format).trim() } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function buildLeadPayload({ payload, intent, message, propertyImages, investor = false, professionalType = '' }) {
  const marketCountry = marketChoiceFromForm({
    market_country: payload?.market_country,
    market_region: payload?.market_region,
    address: payload?.address || payload?.location,
  });
  const marketRegion = normalizeMarketRegion(payload?.market_region, marketCountry) || String(payload?.market_region || '').trim();
  const marketCity = String(payload?.market_city || '').trim().slice(0, 120);
  const marketCountryName = String(payload?.market_country_name || '').trim().slice(0, 80);
  const agentIntent = intent === 'buy' || intent === 'sell';
  const clientType = agentIntent ? agentFormClientType(intent, investor) : (investor ? 'investor' : '');
  const land = isLandType(payload?.property_type);
  const homeField = (value) => (land ? '' : value || '');
  const inv = agentInvestorAnswers(payload);
  const templateAnswers = agentIntent && investor
    ? {
        ...(inv.investmentType ? { investment_type: inv.investmentType } : {}),
        ...(inv.investmentGoal ? { investment_goal: inv.investmentGoal } : {}),
        ...(inv.ownsInvestments ? { owns_investments: inv.ownsInvestments } : {}),
        ...(inv.downPayment ? { [questionIdForStoredField('down_payment_readiness')]: inv.downPayment } : {}),
      }
    : null;
  // Only the professional's own role section is filled (all three when the type is not given).
  const fillRole = (role) => !professionalType || professionalType === role;
  const agentSection = fillRole('agent') ? {
    mortgage_status: payload?.mortgage_status || '',
    realtor_status: payload?.realtor_status || '',
    motivation_reason: payload?.motivation_reason || (investor ? 'investment' : ''),
    viewing_readiness: payload?.viewing_readiness || '',
    living_situation: payload?.living_situation || '',
    urgency_readiness: payload?.urgency_readiness || '',
    buy_property_location: intent === 'buy' ? payload?.buy_property_location || payload?.location || '' : '',
    investment_type: agentIntent ? inv.investmentType : payload?.investment_type || '',
    investment_goal: agentIntent ? inv.investmentGoal : payload?.investment_goal || '',
    owns_investments: payload?.owns_investments || '',
    // Investor "Capital ready" answer (the chat saves it on the agent qualification too).
    down_payment_readiness: agentIntent ? inv.downPayment : '',
    buying_another: payload?.buying_another || '',
    market_country: marketCountry,
    market_region: marketRegion,
    ...(marketCity ? { market_city: marketCity } : {}),
    ...(marketCountryName ? { market_country_name: marketCountryName } : {}),
  } : {};
  const brokerSection = fillRole('mortgage_broker') ? {
    mortgage_timeline: payload?.mortgage_timeline || '',
    pre_approval_status: payload?.pre_approval_status || '',
    credit_score_range: payload?.credit_score_range || '',
    employment_status: payload?.employment_status || '',
    household_income: payload?.household_income || '',
    down_payment_readiness: payload?.down_payment_readiness || '',
    purchase_purpose: payload?.purchase_purpose || (investor ? 'investment' : ''),
    urgency_signal: payload?.urgency_signal || '',
    property_budget: payload?.property_budget || payload?.budget || '',
    investment_type: payload?.investment_type || '',
    owns_investments: payload?.owns_investments || '',
    investment_financing: payload?.investment_financing || '',
    borrower_entity: payload?.borrower_entity || '',
    market_country: marketCountry,
    market_region: marketRegion,
    ...(marketCity ? { market_city: marketCity } : {}),
    ...(marketCountryName ? { market_country_name: marketCountryName } : {}),
  } : {};
  const lawyerSection = fillRole('lawyer') ? {
    transaction_stage: payload?.transaction_stage || '',
    closing_timeline: payload?.closing_timeline || '',
    transaction_type: payload?.transaction_type || '',
    property_value: payload?.property_value || payload?.budget || '',
    mortgage_status: payload?.mortgage_status || '',
    realtor_involved: payload?.realtor_involved || '',
    // First-time buyer belongs to personal inquiries, the purchasing entity to investor ones.
    first_time_buyer: investor ? '' : payload?.first_time_buyer || '',
    legal_services_needed: payload?.legal_services_needed || '',
    via_company: investor ? payload?.via_company || '' : '',
    market_country: marketCountry,
    market_region: marketRegion,
    ...(marketCity ? { market_city: marketCity } : {}),
    ...(marketCountryName ? { market_country_name: marketCountryName } : {}),
  } : {};
  return {
    intent,
    source: 'public_web_form',
    ...(clientType ? { client_type: clientType } : {}),
    ...(templateAnswers && Object.keys(templateAnswers).length ? { template_answers: templateAnswers } : {}),
    identity: {
      full_name: payload?.full_name || '',
      email: payload?.email || '',
      phone: payload?.phone || '',
    },
    contact_preferences: {
      preferred_contact_method: payload?.preferred_contact_method || '',
      best_time_to_contact: payload?.best_time_to_contact || '',
    },
    property: {
      address: payload?.address || '',
      location: payload?.location || '',
      // Seller leads keep the asking price in expected_price only (same as the chat lead create).
      budget: intent === 'sell' ? '' : payload?.budget || payload?.price || payload?.property_value || '',
      expected_price: intent === 'sell' ? payload?.price || payload?.budget || '' : '',
      timeline: payload?.timeline || payload?.mortgage_timeline || payload?.closing_timeline || '',
      // Land has no bedrooms, bathrooms, parking, or backyard: never save stray values for it.
      bedrooms: homeField(payload?.beds),
      bathrooms: homeField(payload?.baths),
      property_type: payload?.property_type || '',
      // The visitor's free-text message lives on the lead as `inquiry_message` (shown as "Message"), not here.
      must_have_features: payload?.must_have_features || '',
      parking_required: homeField(payload?.parking_required),
      backyard_needed: homeField(payload?.backyard_needed),
      school_district_important: payload?.school_district_important || '',
      images: propertyImages,
    },
    qualification: {
      agent: agentSection,
      mortgage_broker: brokerSection,
      lawyer: lawyerSection,
    },
  };
}

function investorMatchFactors(payload) {
  const inv = agentInvestorAnswers(payload);
  return {
    ...(inv.investmentType ? { investment_type: inv.investmentType } : {}),
    ...(inv.investmentGoal ? { investment_goal: inv.investmentGoal } : {}),
    ...(inv.ownsInvestments ? { owns_investments: inv.ownsInvestments } : {}),
    ...(inv.downPayment ? { [storedFieldForQuestionId('down_payment')]: inv.downPayment } : {}),
  };
}

function resolveTrackingContext(payload, requestMeta) {
  const sessionId = String(payload?.session_id || requestMeta?.session_id || '').trim() || fallbackSessionId();
  const visitorId = String(payload?.visitor_id || requestMeta?.visitor_id || '').trim() || fallbackVisitorId();
  const referrer = String(requestMeta?.referrer || '').trim() || null;
  return {
    sessionId,
    visitorId,
    referrer,
    trafficSource: determineTrafficSource(referrer),
  };
}

const publicLeadQueue = new Map();

/**
 * Same visitor submitting twice at once (double click, network retry): run the second submit after the
 * first one, so it finds the lead the first created and updates it instead of adding a duplicate.
 */
export async function submitPublicLeadService(args = {}) {
  const contactKey = String(args?.payload?.email || args?.payload?.phone || '').trim().toLowerCase();
  if (!contactKey) return submitPublicLeadServiceOnce(args);
  const key = `${String(args?.slug || '').toLowerCase().trim()}|${contactKey}`;
  const previous = publicLeadQueue.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(() => submitPublicLeadServiceOnce(args));
  publicLeadQueue.set(key, run);
  try {
    return await run;
  } finally {
    if (publicLeadQueue.get(key) === run) publicLeadQueue.delete(key);
  }
}

async function submitPublicLeadServiceOnce({ slug, payload, requestMeta = {} }) {
  if (!slug || typeof slug !== 'string') {
    return { status: 400, body: { success: false, message: 'Invalid slug' } };
  }

  const profile = await PublicProfile.findOne({ slug: slug.toLowerCase().trim() })
    .select('_id user_id slug professional_type enabled')
    .lean();
  if (!profile || !profile.enabled || !(await userCanServePublicProfile(profile.user_id))) {
    return publicProfileUnavailableResponse();
  }

  const professionalProfile = await ProfessionalProfile.findOne({ user_id: profile.user_id })
    .select('_id professional_type')
    .lean();
  if (!professionalProfile?._id) {
    return { status: 404, body: { success: false, message: 'Professional profile not found' } };
  }

  const professionalType = professionalProfile.professional_type || profile.professional_type || 'agent';
  // The web page contact form is a support request, not a lead (no lead profile, score, matches or follow-ups).
  if (payload?.form_source === 'contact_page') {
    return createSupportRequestFromContactPage({
      publicProfile: profile,
      professionalProfile,
      professionalType,
      payload,
      requestMeta,
    });
  }
  const investor = isPublicInvestorSubmission(payload);
  const intent = resolvePublicSubmissionIntent(professionalType, payload);
  const message = String(payload?.message || '').trim();
  const contactInfo = {
    name: payload?.full_name || '',
    email: payload?.email || '',
    phone: payload?.phone || '',
  };
  const formScore = scorePublicFormLead(
    professionalType,
    intent,
    buildLeadPayload({ payload, intent, message, propertyImages: [], investor, professionalType }),
    { message, contactInfo, investor },
  );
  const leadGrade = formScore.grade;
  const leadType = resolveLeadTypeForSubmission(professionalType, intent, investor, leadGrade);
  const leadSide = leadType.slice(leadType.lastIndexOf('_') + 1);
  const propertyImages = sanitizePropertyImages(payload?.property_images);
  // Seller picked photos but the upload service was unavailable: the lead still goes through, with a note.
  const photosNote = payload?.seller_photos_unavailable === true && !propertyImages.length
    ? 'The client selected property photos, but they could not be uploaded. Ask the client to share them.'
    : '';
  const inquiredProperty = normalizeInquiredProperty(payload?.inquired_property);
  const linkedSellerLeadMatchId = inquiredProperty
    ? await resolveLinkedSellerLeadMatchId({
        ownerUserId: profile.user_id,
        inquiredProperty,
      })
    : null;

  const leadPayload = buildLeadPayload({ payload, intent, message, propertyImages, investor, professionalType });
  // Lawyer / broker answers of this inquiry, kept on the lead itself (the profile is shared by the person's leads).
  const leadAnswers = leadAnswersSnapshot(
    professionalType,
    leadPayload.qualification?.[professionalType === 'lawyer' ? 'lawyer' : 'mortgage_broker'],
  );
  const { leadProfile } = await createOrReuseLeadProfile({
    payload: leadPayload,
    userId: profile.user_id,
    professionalType,
    contactInfo,
    leadGrade,
  });
  // Same visitor sending the form again (same lead profile and lead type, still open): update that lead
  // instead of adding a second row to the leads list and a second "new lead" notification.
  const existingMatch = inquiredProperty
    ? null
    : await LeadMatch.findOne({
      user_id: profile.user_id,
      lead_profile_id: leadProfile._id,
      lead_type: { $regex: `_${leadSide}$` },
      'compatibility_factors.source': 'public_web_form',
      match_status: { $nin: [...TERMINAL_MATCH_STATUSES] },
    }).sort({ createdAt: -1 });
  if (existingMatch) {
    await LeadMatch.updateOne(
      { _id: existingMatch._id },
      {
        $set: {
          'compatibility_factors.inquiry_intent': intent,
          'compatibility_factors.inquiry_message': message,
          'compatibility_factors.last_inquiry_at': new Date(),
          ...(photosNote ? { 'compatibility_factors.photos_note': photosNote } : {}),
          ...Object.fromEntries(
            Object.entries(leadAnswers).map(([key, value]) => [`compatibility_factors.lead_answers.${key}`, value]),
          ),
          ...(formScore.score > Number(existingMatch.match_score || 0)
            ? { match_score: formScore.score, lead_type: leadType }
            : {}),
        },
      },
    );
  }
  const leadMatch = existingMatch || await createValidatedLeadMatch({
    user_id: profile.user_id,
    professional_profile_id: professionalProfile._id,
    lead_profile_id: leadProfile._id,
    lead_type: leadType,
    match_score: formScore.score,
    match_status: 'new',
    compatibility_factors: {
      professional_type: professionalType,
      source: 'public_web_form',
      direct_submission: true,
      inquiry_intent: intent,
      inquiry_message: message,
      ...(photosNote ? { photos_note: photosNote } : {}),
      ...(investor ? { client_type: 'investor' } : {}),
      ...(Object.keys(leadAnswers).length ? { lead_answers: leadAnswers } : {}),
      // Same investor factors the chat lead create puts on the match.
      ...(investor && intent !== 'unspecified' ? investorMatchFactors(payload) : {}),
      ...(inquiredProperty
        ? {
            inquired_property: inquiredProperty,
            inquiry_type: 'specific_property',
            linked_seller_lead_match_id: linkedSellerLeadMatchId || null,
          }
        : {}),
    },
  });
  await bumpLeadProfileStats(leadProfile._id, intent, leadType);

  const tracking = resolveTrackingContext(payload, requestMeta);
  await createValidatedLeadAttribution({
    lead_type: leadType,
    source: 'public_web_form',
    converted: false,
    lead_profile_id: leadProfile._id,
    lead_match_id: leadMatch._id,
    session_id: tracking.sessionId,
    ip_address: requestMeta?.ip_address || null,
    user_agent: requestMeta?.user_agent || null,
    referrer_url: tracking.referrer,
    landing_page: `/professional/${profile.slug}`,
  });
  await ProfileViewEvent.create({
    user_id: profile.user_id,
    visitor_id: tracking.visitorId,
    visitor_user_id: requestMeta?.visitor_user_id || null,
    event_type: 'cta_click',
    event_data: {
      source: 'public_web_form',
      professional_type: professionalType,
      intent,
      lead_match_id: String(leadMatch._id),
      note: message || null,
    },
    session_id: tracking.sessionId,
    referrer: tracking.referrer,
    user_agent: requestMeta?.user_agent || null,
    ip_address: requestMeta?.ip_address || null,
    cta_type: 'lead_created',
    traffic_source: tracking.trafficSource,
    timestamp: new Date(),
  });

  if (!existingMatch) await emitNewLeadCreatedNotification(profile.user_id, {
    newLeadMatch: leadMatch,
    conversationId: null,
    sessionId: tracking.sessionId,
    persistedGrade: leadGrade,
    finalScore: Number(leadMatch.match_score || formScore.score),
    socketIntent: intent,
    appointment_status: null,
    conversion_preview: null,
  });
  // Public page form leads also get the new-lead email (same NEW_LEAD_EMAIL_NOTIFICATIONS / assistant gates).
  if (!existingMatch) {
    void sendNewLeadCreatedEmailIfEnabled(profile.user_id, {
      newLeadMatch: leadMatch,
      persistedGrade: leadGrade,
      conversion_preview: {
        headline: payload?.form_source === 'contact_page'
          ? 'A new lead came in from the contact page on your storefront.'
          : 'A new lead came in from the inquiry form on your storefront.',
      },
      details: {
        type: 'public_web_form',
        professional_type: professionalType,
        client_name: payload?.full_name || payload?.name || '',
        client_email: payload?.email || '',
        client_phone: payload?.phone || '',
        message,
        inquiry_message: message,
        intent,
        client_type: investor ? 'investor' : '',
        purchase_purpose: payload?.purchase_purpose || '',
        preferred_location: payload?.location || payload?.address || '',
        timeline: payload?.timeline || payload?.mortgage_timeline || payload?.closing_timeline || '',
        investment_type: payload?.investment_type || '',
        owns_investments: payload?.owns_investments || '',
        investment_financing: payload?.investment_financing || '',
        borrower_entity: payload?.borrower_entity || '',
        via_company: payload?.via_company || '',
        transaction_type: payload?.transaction_type || '',
        legal_services_needed: payload?.legal_services_needed || '',
        property_value: payload?.property_value || '',
        market_country: payload?.market_country || '',
        market_region: payload?.market_region || '',
        market_city: payload?.market_city || '',
        market_country_name: payload?.market_country_name || '',
        budget: payload?.budget || payload?.property_budget || payload?.property_value || '',
        photos_note: photosNote,
      },
    }).catch(() => {});
  }
  if (intent === 'sell' && leadProfile?._id && !existingMatch) {
    void notifyClientsOfNewPropertyForSale(leadProfile._id).catch(() => {});
  }
  if (!existingMatch) await afterLeadCapturedNotifyOverQuota(profile.user_id);
  // Storefront / published-page leads belong only to the professional: no Nesti admin lead, admin
  // notification, admin AI draft, or Nesti welcome email (the homepage direct-inquiry flow keeps those).

  return {
    status: existingMatch ? 200 : 201,
    body: {
      success: true,
      message: existingMatch ? 'Inquiry updated successfully' : 'Inquiry submitted successfully',
      ...(existingMatch ? { updated_existing: true } : {}),
      lead_match_id: String(leadMatch._id),
      lead_profile_id: String(leadProfile._id),
    },
  };
}
