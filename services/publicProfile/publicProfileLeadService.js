import { ProfessionalProfile, ProfileViewEvent, PublicProfile } from '../../models/index.js';
import { determineTrafficSource } from '../../utils/analyticsHelpers.js';
import {
  bumpLeadProfileStats,
  createOrReuseLeadProfile,
  createValidatedLeadAttribution,
  createValidatedLeadMatch,
} from '../chat/scoring/leadPersistence.js';
import { afterLeadCapturedNotifyOverQuota } from '../billing/planQuota.js';
import { emitNewLeadCreatedNotification } from '../realtime/leadCreatedNotify.js';
import {
  normalizeInquiredProperty,
  resolveLinkedSellerLeadMatchId,
} from '../lead/inquiredProperty.js';
import { notifyClientsOfNewPropertyForSale } from '../property/propertyClientNotifications.js';
import {
  publicProfileUnavailableResponse,
  userCanServePublicProfile,
} from './publicProfileAccess.js';

function resolveLeadTypeForSubmission(professionalType, intent) {
  if (professionalType !== 'agent') return 'interested_client';
  return intent === 'sell' ? 'interested_seller' : 'interested_buyer';
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

function buildLeadPayload({ payload, intent, message, propertyImages }) {
  return {
    intent,
    source: 'public_web_form',
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
      budget: payload?.budget || payload?.price || payload?.property_value || '',
      expected_price: intent === 'sell' ? payload?.price || payload?.budget || '' : '',
      timeline: payload?.timeline || payload?.mortgage_timeline || payload?.closing_timeline || '',
      bedrooms: payload?.beds || '',
      bathrooms: payload?.baths || '',
      property_type: payload?.property_type || '',
      must_have_features: payload?.must_have_features || message,
      parking_required: payload?.parking_required || '',
      backyard_needed: payload?.backyard_needed || '',
      school_district_important: payload?.school_district_important || '',
      images: propertyImages,
    },
    qualification: {
      agent: {
        mortgage_status: payload?.mortgage_status || '',
        realtor_status: payload?.realtor_status || '',
        motivation_reason: payload?.motivation_reason || message,
        viewing_readiness: payload?.viewing_readiness || '',
        living_situation: payload?.living_situation || '',
        urgency_readiness: payload?.urgency_readiness || '',
      },
      mortgage_broker: {
        mortgage_timeline: payload?.mortgage_timeline || '',
        pre_approval_status: payload?.pre_approval_status || '',
        credit_score_range: payload?.credit_score_range || '',
        employment_status: payload?.employment_status || '',
        household_income: payload?.household_income || '',
        down_payment_readiness: payload?.down_payment_readiness || '',
        purchase_purpose: payload?.purchase_purpose || '',
        urgency_signal: payload?.urgency_signal || '',
        property_budget: payload?.property_budget || payload?.budget || '',
      },
      lawyer: {
        transaction_stage: payload?.transaction_stage || '',
        closing_timeline: payload?.closing_timeline || '',
        transaction_type: payload?.transaction_type || '',
        property_value: payload?.property_value || payload?.budget || '',
        mortgage_status: payload?.mortgage_status || '',
        realtor_involved: payload?.realtor_involved || '',
        first_time_buyer: payload?.first_time_buyer || '',
        legal_services_needed: payload?.legal_services_needed || '',
      },
    },
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

export async function submitPublicLeadService({ slug, payload, requestMeta = {} }) {
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
  const intent = professionalType === 'agent' && payload?.intent === 'sell' ? 'sell' : professionalType === 'agent' ? 'buy' : 'unspecified';
  const leadType = resolveLeadTypeForSubmission(professionalType, intent);
  const leadGrade = 'interested';
  const message = String(payload?.message || '').trim();
  const contactInfo = {
    name: payload?.full_name || '',
    email: payload?.email || '',
    phone: payload?.phone || '',
  };
  const propertyImages = sanitizePropertyImages(payload?.property_images);
  const inquiredProperty = normalizeInquiredProperty(payload?.inquired_property);
  const linkedSellerLeadMatchId = inquiredProperty
    ? await resolveLinkedSellerLeadMatchId({
        ownerUserId: profile.user_id,
        inquiredProperty,
      })
    : null;

  const { leadProfile } = await createOrReuseLeadProfile({
    payload: buildLeadPayload({ payload, intent, message, propertyImages }),
    userId: profile.user_id,
    professionalType,
    contactInfo,
    leadGrade,
  });
  const leadMatch = await createValidatedLeadMatch({
    user_id: profile.user_id,
    professional_profile_id: professionalProfile._id,
    lead_profile_id: leadProfile._id,
    lead_type: leadType,
    match_score: 35,
    match_status: 'new',
    compatibility_factors: {
      professional_type: professionalType,
      source: 'public_web_form',
      direct_submission: true,
      inquiry_intent: intent,
      inquiry_message: message,
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

  await emitNewLeadCreatedNotification(profile.user_id, {
    newLeadMatch: leadMatch,
    conversationId: null,
    sessionId: tracking.sessionId,
    persistedGrade: 'interested',
    finalScore: Number(leadMatch.match_score || 35),
    socketIntent: intent,
    appointment_status: null,
    conversion_preview: null,
  });
  if (intent === 'sell' && leadProfile?._id) {
    void notifyClientsOfNewPropertyForSale(leadProfile._id).catch(() => {});
  }
  await afterLeadCapturedNotifyOverQuota(profile.user_id);

  return {
    status: 201,
    body: {
      success: true,
      message: 'Inquiry submitted successfully',
      lead_match_id: String(leadMatch._id),
      lead_profile_id: String(leadProfile._id),
    },
  };
}
