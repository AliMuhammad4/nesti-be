import {
  ChatbotEmbedUrl,
  InviteLink,
  ProfessionalProfile,
  PublicProfile,
} from '../../models/index.js';
import {
  countAvailableSellerLeads,
  countClosedSellerLeads,
  getRecentClosedSellerLeadOutcomes,
  getLeadKpiSummary,
  getProfessionalCredentialMetrics,
  getSellerCredentialMetrics,
} from '../analytics/leadKpiService.js';
import { serializePublishedStorefront } from './storefrontService.js';
import { userHasStorefrontTemplateAccess } from '../billing/storefrontTemplatePurchases.js';
import {
  publicProfileUnavailableResponse,
  userCanServePublicProfile,
} from './publicProfileAccess.js';
import {
  calculateProfileRating,
  serializeClientFeedbackItem,
} from './publicProfileMappers.js';

const PROFESSIONAL_PROFILE_FIELDS = [
  'full_name',
  'company_name',
  'phone',
  'calendly_link',
  'location',
  'target_neighborhoods',
  'experience',
  'awards',
  'specializations',
  'certificates',
  'preferred_clients',
  'practice_areas',
  'professional_type',
  'response_time',
  'availability',
  'support_level',
  'negotiation_style',
  'sales_approach',
  'energy_style',
  'personality_tag',
  'core_specialization_tags',
  'specialty_strength_tags',
  'working_style_tags',
  'personality_style_tags',
  'service_area_primary_zones',
  'service_area_secondary_zones',
  'service_area_cities',
  'service_area_regions',
  'languages_spoken',
  'other_language_text',
  'license_number',
  'experience_level',
].join(' ');

const PROFESSIONAL_PROFILE_ARRAY_FIELDS = [
  'specializations',
  'certificates',
  'preferred_clients',
  'core_specialization_tags',
  'specialty_strength_tags',
  'working_style_tags',
  'personality_style_tags',
  'service_area_primary_zones',
  'service_area_secondary_zones',
  'service_area_cities',
  'service_area_regions',
  'languages_spoken',
];

function serializeFeedback(profile) {
  return (profile.feedback_submissions || [])
    .filter((item) => item?.approved === true)
    .map(serializeClientFeedbackItem);
}

function serializeProfessionalProfile(profile) {
  if (!profile) return null;
  const serialized = {
    full_name: profile.full_name || '',
    company_name: profile.company_name || '',
    phone: profile.phone || '',
    calendly_link: profile.calendly_link || '',
    location: profile.location || '',
    target_neighborhoods: profile.target_neighborhoods || '',
    experience: profile.experience || '',
    awards: profile.awards || '',
    response_time: profile.response_time || '',
    availability: profile.availability || '',
    support_level: profile.support_level || '',
    negotiation_style: profile.negotiation_style || '',
    sales_approach: profile.sales_approach || '',
    energy_style: profile.energy_style || '',
    personality_tag: profile.personality_tag || '',
    experience_level: profile.experience_level || '',
    license_number: profile.license_number || '',
    other_language_text: profile.other_language_text || '',
  };
  for (const field of PROFESSIONAL_PROFILE_ARRAY_FIELDS) {
    serialized[field] = Array.isArray(profile[field]) ? profile[field] : [];
  }
  return serialized;
}

async function loadFullProfileContext(professionalUserId, professionalType) {
  const now = new Date();
  const isLawyer = professionalType === 'lawyer';
  const [
    dashboardKpis,
    closedSellerLeadsCount,
    availableSellerLeadsCount,
    recentClosedSellerLeads,
    sellerCredentialMetrics,
    professionalCredentialMetrics,
    professionalProfile,
    latestInviteLink,
    embedDoc,
  ] = await Promise.all([
    isLawyer ? null : getLeadKpiSummary(professionalUserId, { days: 30 }).catch(() => null),
    isLawyer ? 0 : countClosedSellerLeads(professionalUserId).catch(() => 0),
    isLawyer ? 0 : countAvailableSellerLeads(professionalUserId).catch(() => 0),
    isLawyer ? [] : getRecentClosedSellerLeadOutcomes(professionalUserId).catch(() => []),
    isLawyer ? null : getSellerCredentialMetrics(professionalUserId).catch(() => null),
    getProfessionalCredentialMetrics(professionalUserId).catch(() => null),
    ProfessionalProfile.findOne({ user_id: professionalUserId })
      .select(PROFESSIONAL_PROFILE_FIELDS)
      .lean()
      .catch(() => null),
    InviteLink.findOne({
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
      .lean()
      .catch(() => null),
    ChatbotEmbedUrl.findOne({ user_id: professionalUserId })
      .select('token widget_role')
      .sort({ createdAt: -1 })
      .lean()
      .catch(() => null),
  ]);

  return {
    dashboardKpis,
    closedSellerLeadsCount,
    availableSellerLeadsCount,
    recentClosedSellerLeads,
    sellerCredentialMetrics,
    professionalCredentialMetrics,
    professionalProfile,
    latestInviteLink,
    embedDoc,
  };
}

export function serializeFullPublicProfile(profile, professionalUserId, context) {
  const approvedFeedback = serializeFeedback(profile);
  const mergedTestimonials = [
    ...(Array.isArray(profile.testimonials) ? profile.testimonials : []),
    ...approvedFeedback,
  ].sort((left, right) => {
    const leftDate = new Date(left?.date || 0).getTime();
    const rightDate = new Date(right?.date || 0).getTime();
    return rightDate - leftDate;
  });
  const isLawyer = profile.professional_type === 'lawyer';
  const professionalMetrics = context.professionalCredentialMetrics || {};
  const lawyerMetrics = isLawyer
    ? {
        active_pipeline_value: professionalMetrics.active_pipeline_value ?? null,
        total_clients: professionalMetrics.total_clients ?? null,
        closed_cases: professionalMetrics.closed_cases
          ?? (Number.isFinite(Number(profile.stats?.transactions_closed))
            ? Number(profile.stats.transactions_closed)
            : null),
        currency: professionalMetrics.currency || profile.currency || '',
      }
    : professionalMetrics;

  return {
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
    embed_token: context.embedDoc?.token || null,
    about: profile.about,
    services: profile.services,
    testimonials: mergedTestimonials,
    client_feedback: approvedFeedback,
    real_clients: [],
    featured_listings: profile.featured_listings,
    top_listings: profile.top_listings,
    sold_listings: profile.sold_listings,
    mortgage_programs: profile.mortgage_programs,
    practice_areas: profile.practice_areas,
    credentials: profile.credentials,
    social_links: profile.social_links,
    invite_link: context.latestInviteLink?.metadata?.share_url
      ? {
          share_url: context.latestInviteLink.metadata.share_url,
          intended_audience: context.latestInviteLink.intended_audience || 'any',
          source_channel: context.latestInviteLink.source_channel || '',
          expires_at: context.latestInviteLink.expires_at || null,
        }
      : null,
    seo_meta: profile.seo_meta,
    dashboard_kpis: context.dashboardKpis,
    closed_seller_leads_count: context.closedSellerLeadsCount,
    available_seller_leads_count: context.availableSellerLeadsCount,
    stats: profile.stats || {},
    seller_credential_metrics: context.sellerCredentialMetrics,
    professional_credential_metrics: lawyerMetrics,
    client_rating_average: calculateProfileRating({ testimonials: mergedTestimonials }),
    professional_profile: serializeProfessionalProfile(context.professionalProfile),
    professional_name: profile.user_id
      ? `${profile.user_id.first_name} ${profile.user_id.last_name}`
      : null,
  };
}

export async function getPublicProfileBySlugService(slug) {
  if (!slug || typeof slug !== 'string') {
    return {
      status: 400,
      body: { success: false, message: 'Invalid slug provided' },
    };
  }

  const profile = await PublicProfile.findOne({ slug: slug.toLowerCase().trim() })
    .populate('user_id', 'first_name last_name email profile_image cover_image')
    .lean();
  if (!profile) return publicProfileUnavailableResponse();
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

  const context = await loadFullProfileContext(professionalUserId, profile.professional_type);
  return {
    status: 200,
    body: {
      success: true,
      profile: serializeFullPublicProfile(profile, professionalUserId, context),
    },
  };
}

export async function getPublicProfileShellBySlugService(slug) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) {
    return { status: 400, body: { success: false, message: 'Invalid slug provided' } };
  }

  const profile = await PublicProfile.findOne({ slug: normalizedSlug, enabled: true })
    .select([
      'user_id',
      'slug',
      'professional_type',
      'enabled',
      'cover_photo_url',
      'profile_photo_url',
      'headline',
      'tagline',
      'about',
      'social_links',
    ].join(' '))
    .populate('user_id', 'first_name last_name email profile_image cover_image')
    .lean();
  if (!profile) return publicProfileUnavailableResponse();

  const professionalUserId = profile.user_id?._id || profile.user_id;
  const [canServe, professionalProfile, embedDoc] = await Promise.all([
    userCanServePublicProfile(professionalUserId),
    ProfessionalProfile.findOne({ user_id: professionalUserId })
      .select('full_name company_name phone calendly_link location professional_type')
      .lean(),
    ChatbotEmbedUrl.findOne({ user_id: professionalUserId })
      .select('token widget_role')
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  if (!canServe) return publicProfileUnavailableResponse();

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
        cover_photo_url: profile.cover_photo_url || profile.user_id?.cover_image || '',
        profile_photo_url: profile.profile_photo_url || profile.user_id?.profile_image || '',
        email: profile.user_id?.email || '',
        headline: profile.headline || '',
        tagline: profile.tagline || '',
        about: profile.about || '',
        social_links: profile.social_links || {},
        embed_token: embedDoc?.token || null,
        professional_name: profile.user_id
          ? `${profile.user_id.first_name || ''} ${profile.user_id.last_name || ''}`.trim()
          : '',
        professional_profile: professionalProfile || null,
      },
    },
  };
}

export async function getPublishedStorefrontBySlugService(slug) {
  if (!slug || typeof slug !== 'string') {
    return {
      status: 400,
      body: { success: false, message: 'Invalid slug provided' },
    };
  }

  const profile = await PublicProfile.findOne({ slug: slug.toLowerCase().trim() })
    .select([
      'slug',
      'enabled',
      'user_id',
      'professional_type',
      'storefront.published',
      'storefront.template_purchases',
      'storefront.unlocked_template_ids',
    ].join(' '))
    .lean();
  if (!profile || !profile.enabled || !(await userCanServePublicProfile(profile.user_id))) {
    return publicProfileUnavailableResponse();
  }

  const published = serializePublishedStorefront(profile.storefront);
  if (!published) return publicProfileUnavailableResponse();

  const publishedTemplateId = String(published?.template?.id || '').trim();
  if (
    publishedTemplateId
    && !userHasStorefrontTemplateAccess(profile, publishedTemplateId)
  ) {
    return publicProfileUnavailableResponse();
  }

  return {
    status: 200,
    body: {
      success: true,
      storefront: {
        slug: profile.slug,
        published,
      },
    },
  };
}
