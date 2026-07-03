import { ProfessionalProfile, PublicProfile, ProfileViewEvent, LeadProfile, LeadMatch, ChatbotEmbedUrl, InviteLink, Subscription } from '../../models/index.js';
import mongoose from 'mongoose';
import { getLeadKpiSummary } from '../analytics/leadKpiService.js';
import { determineTrafficSource } from '../../utils/analyticsHelpers.js';
import { FEATURES, hasFeature } from '../billing/entitlements.js';
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

function publicProfileUnavailableResponse() {
  return { status: 404, body: { success: false, message: 'Profile not found' } };
}

function normalizeUserId(value) {
  return String(value?._id || value || '').trim();
}

async function userCanServePublicProfile(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return false;
  const subscription = await Subscription.findOne({ user_id: normalizedUserId }).lean();
  return hasFeature(subscription, FEATURES.PUBLIC_PROFILE);
}

async function filterPublicProfileAccessByUserId(userIds = []) {
  const ids = [...new Set(userIds.map(normalizeUserId).filter(Boolean))];
  if (!ids.length) return new Map();

  const subscriptions = await Subscription.find({ user_id: { $in: ids } }).lean();
  return new Map(
    ids.map((id) => {
      const subscription = subscriptions.find((sub) => normalizeUserId(sub.user_id) === id);
      return [id, hasFeature(subscription, FEATURES.PUBLIC_PROFILE)];
    }),
  );
}

// Build a short engagement line from lead intent data
function buildClientLine(lead) {
  const intent = lead.intent_summary?.primary_intent || lead.intent || '';
  const propType = lead.property?.property_type || '';
  const location = lead.property?.location || '';
  const budget = lead.budget_profile?.latest_budget_text || '';

  if (intent === 'buy') {
    const parts = ['Looking to purchase'];
    if (propType) parts.push(`a ${propType}`);
    if (location) parts.push(`in ${location}`);
    if (budget) parts.push(`with a budget of ${budget}`);
    return parts.join(' ') + '.';
  }
  if (intent === 'sell') {
    const parts = ['Looking to sell'];
    if (propType) parts.push(`their ${propType}`);
    if (location) parts.push(`in ${location}`);
    return parts.join(' ') + '.';
  }
  if (intent === 'client') {
    return location ? `Seeking professional services in ${location}.` : 'Seeking professional real estate services.';
  }
  return location ? `Active client inquiry from ${location}.` : 'Active client inquiry.';
}

function inferLeadTypeLabel(lead, professionalType) {
  const intent = lead.intent_summary?.primary_intent || lead.intent || '';
  if (professionalType === 'mortgage_broker') {
    const preApproval = lead.qualification?.mortgage_broker?.pre_approval_status || '';
    if (preApproval) return 'Pre-Approval Lead';
    const stage = lead.qualification?.mortgage_broker?.mortgage_timeline || '';
    if (stage) return 'Home Loan Lead';
    return 'Mortgage Lead';
  }
  if (professionalType === 'lawyer') {
    const txType = lead.qualification?.lawyer?.transaction_type || '';
    if (txType === 'closing') return 'Closing Lead';
    if (txType === 'contract') return 'Contract Review Lead';
    return 'Transaction Legal Lead';
  }
  if (intent === 'sell') return 'Seller Lead';
  if (intent === 'buy') return 'Buyer Lead';
  return 'Buyer Lead';
}

export const getPublicProfileBySlugService = async (slug) => {
  if (!slug || typeof slug !== 'string') {
    return {
      status: 400,
      body: { success: false, message: 'Invalid slug provided' },
    };
  }

  const profile = await PublicProfile.findOne({ slug: slug.toLowerCase().trim() })
    .populate('user_id', 'first_name last_name email profile_image cover_image')
    .lean();

  if (!profile) {
    return {
      status: 404,
      body: { success: false, message: 'Profile not found' },
    };
  }

  if (!profile.enabled) {
    return {
      status: 403,
      body: { success: false, message: 'This profile is not publicly available' },
    };
  }

  const professionalUserId = profile.user_id?._id || profile.user_id;
  if (!(await userCanServePublicProfile(professionalUserId))) {
    return publicProfileUnavailableResponse();
  }

  let dashboardKpis = null;
  let professionalProfile = null;
  let latestInviteLink = null;
  let realClients = [];
  try {
    dashboardKpis = await getLeadKpiSummary(professionalUserId, { days: 30 });
  } catch {
    dashboardKpis = null;
  }
  try {
    professionalProfile = await ProfessionalProfile.findOne({ user_id: professionalUserId })
      .select('company_name phone calendly_link location target_neighborhoods experience awards specializations certificates preferred_clients practice_areas professional_type response_time availability support_level negotiation_style sales_approach energy_style personality_tag core_specialization_tags specialty_strength_tags working_style_tags personality_style_tags service_area_primary_zones service_area_secondary_zones service_area_cities service_area_regions languages_spoken experience_level')
      .lean();
  } catch {
    professionalProfile = null;
  }
  try {
    const now = new Date();
    latestInviteLink = await InviteLink.findOne({
      inviter_user_id: professionalUserId,
      is_active: true,
      $or: [
        { expires_at: { $exists: false } },
        { expires_at: null },
        { expires_at: { $gt: now } },
      ],
    })
      .select('metadata.share_url intended_audience source_channel expires_at createdAt')
      .sort({ createdAt: -1 })
      .lean();
  } catch {
    latestInviteLink = null;
  }
  // Fetch the professional's embed token for the public chatbot
  let embedToken = null;
  try {
    const embedDoc = await ChatbotEmbedUrl.findOne({ user_id: professionalUserId })
      .select('token widget_role')
      .sort({ createdAt: -1 })
      .lean();
    if (embedDoc) embedToken = embedDoc.token;
  } catch {
    embedToken = null;
  }

  try {
    const leads = await LeadProfile.find({ 'ownership.user_id': professionalUserId })
      .select('identity intent intent_summary property budget_profile qualification lifecycle')
      .sort({ 'lifecycle.last_seen_at': -1 })
      .limit(10)
      .lean();

    realClients = leads
      .filter((l) => l.identity?.full_name || l.property?.location)
      .map((l) => ({
        client_name: l.identity?.full_name || 'Anonymous Client',
        client_photo_url: null,
        rating: 5,
        text: buildClientLine(l),
        lead_type: inferLeadTypeLabel(l, profile.professional_type),
        location: l.property?.location || professionalProfile?.location || '',
        is_real_client: true,
      }));
  } catch {
    realClients = [];
  }

  return {
    status: 200,
    body: {
      success: true,
      profile: {
        id: profile._id,
        professional_user_id: professionalUserId,
        slug: profile.slug,
        professional_type: profile.professional_type,
        enabled: profile.enabled,
        
        cover_photo_url: profile.cover_photo_url || profile.user_id?.cover_image,
        profile_photo_url: profile.profile_photo_url || profile.user_id?.profile_image,
        email: profile.user_id?.email || '',
        headline: profile.headline,
        tagline: profile.tagline,
        
        embed_token: embedToken,
        about: profile.about,
        services: profile.services,
        testimonials: profile.testimonials,
        real_clients: realClients,
        
        featured_listings: profile.featured_listings,
        top_listings: profile.top_listings,
        sold_listings: profile.sold_listings,
        
        mortgage_programs: profile.mortgage_programs,

        practice_areas: profile.practice_areas,
        credentials: profile.credentials,

        social_links: profile.social_links,
        invite_link: latestInviteLink?.metadata?.share_url
          ? {
              share_url: latestInviteLink.metadata.share_url,
              intended_audience: latestInviteLink.intended_audience || 'any',
              source_channel: latestInviteLink.source_channel || '',
              expires_at: latestInviteLink.expires_at || null,
            }
          : null,

        seo_meta: profile.seo_meta,
        dashboard_kpis: dashboardKpis,
        professional_profile: professionalProfile
          ? {
              company_name: professionalProfile.company_name || '',
              phone: professionalProfile.phone || '',
              calendly_link: professionalProfile.calendly_link || '',
              location: professionalProfile.location || '',
              target_neighborhoods: professionalProfile.target_neighborhoods || '',
              experience: professionalProfile.experience || '',
              awards: professionalProfile.awards || '',
              response_time: professionalProfile.response_time || '',
              availability: professionalProfile.availability || '',
              support_level: professionalProfile.support_level || '',
              negotiation_style: professionalProfile.negotiation_style || '',
              sales_approach: professionalProfile.sales_approach || '',
              energy_style: professionalProfile.energy_style || '',
              personality_tag: professionalProfile.personality_tag || '',
              specializations: Array.isArray(professionalProfile.specializations)
                ? professionalProfile.specializations
                : [],
              certificates: Array.isArray(professionalProfile.certificates)
                ? professionalProfile.certificates
                : [],
              preferred_clients: Array.isArray(professionalProfile.preferred_clients)
                ? professionalProfile.preferred_clients
                : [],
              core_specialization_tags: Array.isArray(professionalProfile.core_specialization_tags)
                ? professionalProfile.core_specialization_tags
                : [],
              specialty_strength_tags: Array.isArray(professionalProfile.specialty_strength_tags)
                ? professionalProfile.specialty_strength_tags
                : [],
              working_style_tags: Array.isArray(professionalProfile.working_style_tags)
                ? professionalProfile.working_style_tags
                : [],
              personality_style_tags: Array.isArray(professionalProfile.personality_style_tags)
                ? professionalProfile.personality_style_tags
                : [],
              service_area_primary_zones: Array.isArray(professionalProfile.service_area_primary_zones)
                ? professionalProfile.service_area_primary_zones
                : [],
              service_area_secondary_zones: Array.isArray(professionalProfile.service_area_secondary_zones)
                ? professionalProfile.service_area_secondary_zones
                : [],
              service_area_cities: Array.isArray(professionalProfile.service_area_cities)
                ? professionalProfile.service_area_cities
                : [],
              service_area_regions: Array.isArray(professionalProfile.service_area_regions)
                ? professionalProfile.service_area_regions
                : [],
              languages_spoken: Array.isArray(professionalProfile.languages_spoken)
                ? professionalProfile.languages_spoken
                : [],
              experience_level: professionalProfile.experience_level || '',
            }
          : null,
        
        professional_name: profile.user_id 
          ? `${profile.user_id.first_name} ${profile.user_id.last_name}`
          : null,
      },
    },
  };
};

export const trackProfileViewService = async (slug, visitorData) => {
  if (!slug || !visitorData.session_id) {
    return {
      status: 400,
      body: { success: false, message: 'Invalid tracking data' },
    };
  }

  const profile = await PublicProfile.findOne({ slug: slug.toLowerCase().trim() }).lean();
  
  if (!profile || !profile.enabled || !(await userCanServePublicProfile(profile.user_id))) {
    return publicProfileUnavailableResponse();
  }

  const trafficSource = determineTrafficSource(visitorData.referrer);

  const event = new ProfileViewEvent({
    user_id: profile.user_id,
    visitor_id: visitorData.visitor_id,
    visitor_user_id: visitorData.visitor_user_id,
    event_type: visitorData.event_type,
    event_data: visitorData.event_data,
    session_id: visitorData.session_id,
    referrer: visitorData.referrer,
    user_agent: visitorData.user_agent,
    ip_address: visitorData.ip_address,
    duration_seconds: visitorData.duration_seconds,
    listing_id: visitorData.listing_id,
    service_id: visitorData.service_id,
    cta_type: visitorData.cta_type,
    traffic_source: trafficSource,
    timestamp: new Date(),
  });

  await event.save();

  return {
    status: 201,
    body: { success: true, message: 'Event tracked successfully' },
  };
};

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

export const submitPublicLeadService = async ({ slug, payload, requestMeta = {} }) => {
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
  const intent =
    professionalType === 'agent'
      ? payload?.intent === 'sell'
        ? 'sell'
        : 'buy'
      : 'unspecified';
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

  const leadPayload = {
    intent,
    source: 'public_web_form',
    identity: {
      full_name: contactInfo.name,
      email: contactInfo.email,
      phone: contactInfo.phone,
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

  const { leadProfile } = await createOrReuseLeadProfile({
    payload: leadPayload,
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

  const sessionId = String(payload?.session_id || requestMeta?.session_id || '').trim() || fallbackSessionId();
  const visitorId = String(payload?.visitor_id || requestMeta?.visitor_id || '').trim() || fallbackVisitorId();
  const referrer = String(requestMeta?.referrer || '').trim() || null;
  const trafficSource = determineTrafficSource(referrer);

  await createValidatedLeadAttribution({
    lead_type: leadType,
    source: 'public_web_form',
    converted: false,
    lead_profile_id: leadProfile._id,
    lead_match_id: leadMatch._id,
    session_id: sessionId,
    ip_address: requestMeta?.ip_address || null,
    user_agent: requestMeta?.user_agent || null,
    referrer_url: referrer,
    landing_page: `/professional/${profile.slug}`,
  });

  await ProfileViewEvent.create({
    user_id: profile.user_id,
    visitor_id: visitorId,
    visitor_user_id: requestMeta?.visitor_user_id || null,
    event_type: 'cta_click',
    event_data: {
      source: 'public_web_form',
      professional_type: professionalType,
      intent,
      lead_match_id: String(leadMatch._id),
      note: message || null,
    },
    session_id: sessionId,
    referrer,
    user_agent: requestMeta?.user_agent || null,
    ip_address: requestMeta?.ip_address || null,
    cta_type: 'lead_created',
    traffic_source: trafficSource,
    timestamp: new Date(),
  });

  // Align direct-submit flow with chat lead flow so dashboard sockets/toasts fire.
  await emitNewLeadCreatedNotification(profile.user_id, {
    newLeadMatch: leadMatch,
    conversationId: null,
    sessionId,
    persistedGrade: 'interested',
    finalScore: Number(leadMatch.match_score || 35),
    socketIntent: intent,
    appointment_status: null,
    conversion_preview: null,
  });

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
};

export const checkSlugAvailabilityService = async (slug, userId = null) => {
  if (!slug || typeof slug !== 'string') {
    return {
      status: 400,
      body: { success: false, message: 'Invalid slug provided' },
    };
  }

  const normalizedSlug = slug.toLowerCase().trim();
  
  if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
    return {
      status: 400,
      body: {
        success: false,
        available: false,
        message: 'Slug can only contain lowercase letters, numbers, and hyphens',
      },
    };
  }

  if (normalizedSlug.length < 3 || normalizedSlug.length > 50) {
    return {
      status: 400,
      body: {
        success: false,
        available: false,
        message: 'Slug must be between 3 and 50 characters',
      },
    };
  }

  const existingProfile = await PublicProfile.findOne({ slug: normalizedSlug }).lean();

  if (!existingProfile) {
    return {
      status: 200,
      body: { success: true, available: true, slug: normalizedSlug },
    };
  }

  if (userId && existingProfile.user_id.toString() === userId.toString()) {
    return {
      status: 200,
      body: { success: true, available: true, slug: normalizedSlug, own: true },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      available: false,
      message: 'This slug is already taken',
      suggested: `${normalizedSlug}-${Math.floor(Math.random() * 1000)}`,
    },
  };
};

export const getPublicProfessionalsListService = async ({ role, limit = 12, exclude } = {}) => {
  // Query all ProfessionalProfile records (everyone on the platform)
  const profFilter = {};
  if (role) profFilter.professional_type = role;

  const profProfiles = await ProfessionalProfile.find(profFilter)
    .populate('user_id', 'first_name last_name profile_image')
    .select('user_id professional_type full_name company_name location experience')
    .sort({ createdAt: -1 })
    .limit(limit * 3) // over-fetch so we can exclude and still have enough
    .lean();

  // Build a user_id → public profile map (slug, headline, photos)
  const userIds = profProfiles.map((p) => p.user_id?._id).filter(Boolean);
  const publicProfiles = await PublicProfile.find({ user_id: { $in: userIds } })
    .select('user_id slug headline profile_photo_url cover_photo_url enabled')
    .lean();
  const accessByUserId = await filterPublicProfileAccessByUserId(userIds);
  const pubMap = {};
  for (const pp of publicProfiles) {
    pubMap[pp.user_id.toString()] = pp;
  }

  const list = profProfiles
    .map((p) => {
      const user = p.user_id || {};
      const uid = user._id?.toString();
      const pub = uid ? pubMap[uid] : null;
      const canServeProfile = Boolean(uid && accessByUserId.get(uid));
      const hasPublicProfile = Boolean(pub?.enabled && canServeProfile);
      const slug = hasPublicProfile ? pub.slug : null;

      // Skip the current profile's professional from the list
      if (exclude && pub?.slug === exclude) return null;

      const name =
        p.full_name ||
        `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
        'Professional';

      return {
        slug,
        professional_type: p.professional_type,
        professional_name: name,
        headline: pub?.headline || '',
        profile_photo_url: pub?.profile_photo_url || user.profile_image || null,
        location: p.location || '',
        experience: p.experience || '',
        company_name: p.company_name || '',
        has_public_profile: hasPublicProfile,
      };
    })
    .filter(Boolean)
    .slice(0, limit);

  return { status: 200, body: { success: true, professionals: list } };
};

export const getPublicProfessionalNetworkService = async ({ role, limit = 60, exclude } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 100);
  const profFilter = {};
  if (role) profFilter.professional_type = role;

  const professionalProfiles = await ProfessionalProfile.find(profFilter)
    .populate('user_id', 'first_name last_name profile_image cover_image')
    .select('user_id professional_type full_name company_name location experience')
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  const completeProfiles = professionalProfiles.filter((profile) => {
    const user = profile.user_id;
    return Boolean(
      user?._id &&
        profile.professional_type &&
        (profile.full_name || user.first_name || user.last_name),
    );
  });

  const userIds = completeProfiles.map((profile) => profile.user_id._id);
  const publicProfiles = await PublicProfile.find({ user_id: { $in: userIds } })
    .select('user_id slug profile_photo_url cover_photo_url enabled')
    .lean();
  const accessByUserId = await filterPublicProfileAccessByUserId(userIds);

  const publicProfileByUserId = new Map(
    publicProfiles.map((profile) => [profile.user_id.toString(), profile]),
  );

  const professionals = completeProfiles
    .map((profile) => {
      const user = profile.user_id;
      const publicProfile = publicProfileByUserId.get(user._id.toString());
      const canServeProfile = Boolean(accessByUserId.get(user._id.toString()));
      const hasPublicProfile = Boolean(publicProfile?.enabled && canServeProfile);

      if (exclude && publicProfile?.slug === exclude) return null;

      const professionalName =
        profile.full_name ||
        [user.first_name, user.last_name].filter(Boolean).join(' ') ||
        'Professional';

      return {
        ...(hasPublicProfile && publicProfile.slug ? { slug: publicProfile.slug } : {}),
        professional_type: profile.professional_type,
        professional_name: professionalName,
        profile_photo_url: publicProfile?.profile_photo_url || user.profile_image || null,
        cover_photo_url: publicProfile?.cover_photo_url || user.cover_image || null,
        company_name: profile.company_name || '',
        location: profile.location || '',
        experience: profile.experience || '',
        has_public_profile: hasPublicProfile,
      };
    })
    .filter(Boolean);

  return { status: 200, body: { success: true, professionals } };
};

// ─── Dedicated seller-properties endpoint ────────────────────────────────────

export const getSellerPropertiesBySlugService = async (slug) => {
  if (!slug || typeof slug !== 'string') {
    return { status: 400, body: { success: false, message: 'Invalid slug' } };
  }

  const profile = await PublicProfile.findOne({ slug: slug.toLowerCase().trim() })
    .select('user_id professional_type enabled')
    .populate('user_id', '_id')
    .lean();

  if (!profile || !profile.enabled || !(await userCanServePublicProfile(profile.user_id))) {
    return publicProfileUnavailableResponse();
  }

  if (profile.professional_type !== 'agent') {
    return { status: 200, body: { success: true, properties: [] } };
  }

  const professionalUserId = profile.user_id?._id || profile.user_id;

  try {
    const sellerLeads = await LeadProfile.find({
      'ownership.user_id': professionalUserId,
      $or: [
        { 'intent_summary.primary_intent': 'sell' },
        { intent: 'sell' },
        // Recovery clause: leads that have seller-uploaded property images are seller leads
        // regardless of whether the intent field was accidentally overwritten.
        { 'property.images.0': { $exists: true } },
      ],
    })
      .select('identity property budget_profile intent_summary lifecycle')
      .sort({ 'lifecycle.last_seen_at': -1 })
      .limit(50)
      .lean();

    // Silent repair: reset any seller LeadMatch records incorrectly stamped with 'consult_booked'.
    const sellerLeadIds = sellerLeads.map((l) => l._id);
    if (sellerLeadIds.length) {
      LeadMatch.updateMany(
        {
          user_id: professionalUserId,
          lead_profile_id: { $in: sellerLeadIds },
          match_status: 'consult_booked',
          lead_type: /seller/i,
        },
        { $set: { match_status: 'new' } },
      ).catch(() => {});
    }

    const properties = sellerLeads.map((l) => ({
      id: l._id.toString(),
      images: (l.property?.images || []).map((img) => img.secure_url || img.url).filter(Boolean),
      address: l.property?.address || '',
      location: l.property?.location || '',
      expected_price: l.property?.expected_price || l.budget_profile?.latest_budget_text || '',
      property_type: l.property?.property_type || '',
      bedrooms: l.property?.bedrooms || '',
      bathrooms: l.property?.bathrooms || '',
      square_footage: l.property?.square_footage || '',
      timeline: l.property?.timeline || '',
      seller_name: l.identity?.full_name || 'Owner',
    }));

    return { status: 200, body: { success: true, properties } };
  } catch {
    return { status: 200, body: { success: true, properties: [] } };
  }
};
