import {
  PublicProfile,
  ProfileViewEvent,
  ProfessionalProfile,
  User,
} from '../../models/index.js';
import { generateSlugFromName } from '../../utils/slugHelpers.js';
import { generatePublicProfileCopy } from './publicProfileAiCopyService.js';
import { generateStorefrontDraft } from './storefrontAiGenerationService.js';
import {
  activeStorefrontDraft,
  createDraftRevision,
  createGeneratedDraftRevision,
  createPublishedRevision,
  serializeStorefrontDrafts,
  serializeStorefrontRevision,
  storefrontDrafts,
  templateIdForRevision,
} from './storefrontService.js';
import { validateStorefrontDraftForRole } from './storefrontValidation.js';
import {
  getStorefrontTemplateTier,
  storefrontTemplateSupportsProfile,
  userHasStorefrontTemplateAccess,
} from '../billing/storefrontTemplatePurchases.js';
import {
  calculateProfileRating,
  getSellerPropertiesBySlugService,
} from './publicProfileService.js';
import {
  countAvailableSellerLeads,
  countClosedSellerLeads,
  getProfessionalCredentialMetrics,
  getRecentClosedSellerLeadOutcomes,
  getSellerCredentialMetrics,
} from '../analytics/leadKpiService.js';

export function toProfessionalProfileSummary(profile) {
  if (!profile) return null;
  return {
    professional_type: profile.professional_type || null,
    full_name: profile.full_name || '',
    company_name: profile.company_name || '',
    phone: profile.phone || '',
    calendly_link: profile.calendly_link || '',
    location: profile.location || '',
    target_neighborhoods: profile.target_neighborhoods || '',
    experience: profile.experience || '',
    license_number: profile.license_number || '',
    website: profile.website || '',
    transaction_volume: profile.transaction_volume || '',
    avg_sale_price: profile.avg_sale_price || '',
    response_time: profile.response_time || '',
    availability: profile.availability || '',
    awards: profile.awards || '',
    bio: profile.bio || '',
    certificates: Array.isArray(profile.certificates) ? profile.certificates : [],
    specializations: Array.isArray(profile.specializations) ? profile.specializations : [],
    communication_channels: Array.isArray(profile.communication_channels) ? profile.communication_channels : [],
    preferred_clients: Array.isArray(profile.preferred_clients) ? profile.preferred_clients : [],
    service_area_cities: Array.isArray(profile.service_area_cities) ? profile.service_area_cities : [],
    service_area_regions: Array.isArray(profile.service_area_regions) ? profile.service_area_regions : [],
    service_area_primary_zones: Array.isArray(profile.service_area_primary_zones) ? profile.service_area_primary_zones : [],
    service_area_secondary_zones: Array.isArray(profile.service_area_secondary_zones) ? profile.service_area_secondary_zones : [],
    languages_spoken: Array.isArray(profile.languages_spoken) ? profile.languages_spoken : [],
    experience_level: profile.experience_level || '',
    core_specialization_tags: Array.isArray(profile.core_specialization_tags) ? profile.core_specialization_tags : [],
    specialty_strength_tags: Array.isArray(profile.specialty_strength_tags) ? profile.specialty_strength_tags : [],
    working_style_tags: Array.isArray(profile.working_style_tags) ? profile.working_style_tags : [],
    personality_style_tags: Array.isArray(profile.personality_style_tags) ? profile.personality_style_tags : [],
  };
}

export function serializeProfileFeedback(profile = {}) {
  return (Array.isArray(profile.feedback_submissions) ? profile.feedback_submissions : [])
    .map((item) => ({
      id: item._id,
      client_name: item.client_name,
      client_photo_url: null,
      rating: item.rating,
      text: item.text,
      date: item.submitted_at,
      role: 'Client feedback',
    }));
}

export function mergeProfileTestimonials(profile = {}) {
  return [
    ...(Array.isArray(profile.testimonials) ? profile.testimonials : []),
    ...serializeProfileFeedback(profile),
  ].sort((left, right) => (
    new Date(right?.date || 0).getTime() - new Date(left?.date || 0).getTime()
  ));
}

export const getOwnPublicProfileService = async (userId) => {
  // Get user first to check role
  const user = await User.findById(userId).lean();
  
  if (!user) {
    return {
      status: 404,
      body: { success: false, message: 'User not found' },
    };
  }

  // Clients don't have professional profiles/public pages
  if (user.role === 'client') {
    return {
      status: 403,
      body: { 
        success: false, 
        message: 'Public profiles are only available for professionals (agents, brokers, lawyers)' 
      },
    };
  }

  let profile = await PublicProfile.findOne({ user_id: userId })
    .populate('user_id', 'first_name last_name email profile_image cover_image')
    .lean();
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: userId }).lean();
  let closedSellerLeadsCount = 0;
  let availableSellerLeadsCount = 0;
  let recentClosedSellerLeads = [];
  let sellerCredentialMetrics = null;
  let professionalCredentialMetrics = null;
  try {
    closedSellerLeadsCount = await countClosedSellerLeads(userId);
  } catch {
    closedSellerLeadsCount = 0;
  }
  try {
    availableSellerLeadsCount = await countAvailableSellerLeads(userId);
  } catch {
    availableSellerLeadsCount = 0;
  }
  try {
    recentClosedSellerLeads = await getRecentClosedSellerLeadOutcomes(userId);
  } catch {
    recentClosedSellerLeads = [];
  }
  try {
    sellerCredentialMetrics = await getSellerCredentialMetrics(userId);
  } catch {
    sellerCredentialMetrics = null;
  }
  try {
    professionalCredentialMetrics = await getProfessionalCredentialMetrics(userId);
  } catch {
    professionalCredentialMetrics = null;
  }

  if (!profile) {
    const suggestedSlug = await generateSlugFromName(
      `${user.first_name}-${user.last_name}`,
      userId
    );

    return {
      status: 200,
      body: {
        success: true,
        profile: null,
        suggested_slug: suggestedSlug,
        professional_type: professionalProfile?.professional_type || user.role,
        professional_profile: toProfessionalProfileSummary(professionalProfile),
        user: {
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          profile_image: user.profile_image,
          cover_image: user.cover_image,
        },
      },
    };
  }

  const clientFeedback = serializeProfileFeedback(profile);

  return {
    status: 200,
    body: {
      success: true,
      profile: {
        id: profile._id,
        slug: profile.slug,
        professional_type: profile.professional_type,
        enabled: profile.enabled,
        
        cover_photo_url: profile.cover_photo_url || profile.user_id.cover_image,
        profile_photo_url: profile.profile_photo_url || profile.user_id.profile_image,
        headline: profile.headline,
        tagline: profile.tagline,
        
        stats: profile.stats,
        closed_seller_leads_count: closedSellerLeadsCount,
        available_seller_leads_count: availableSellerLeadsCount,
        recent_closed_seller_leads: recentClosedSellerLeads,
        seller_credential_metrics: sellerCredentialMetrics,
        professional_credential_metrics: professionalCredentialMetrics,
        client_rating_average: calculateProfileRating(profile),
        about: profile.about,
        services: profile.services,
        testimonials: mergeProfileTestimonials(profile),
        client_feedback: clientFeedback,
        
        featured_listings: profile.featured_listings,
        top_listings: profile.top_listings,
        sold_listings: profile.sold_listings,
        
        mortgage_programs: profile.mortgage_programs,
        calculator_widgets_enabled: profile.calculator_widgets_enabled,
        
        practice_areas: profile.practice_areas,
        credentials: profile.credentials,
        
        social_links: profile.social_links,
        partner_professionals: profile.partner_professionals,
        
        theme_color: profile.theme_color,
        custom_css: profile.custom_css,
        seo_meta: profile.seo_meta,
        
        created_at: profile.createdAt,
        updated_at: profile.updatedAt,
      },
      professional_profile: toProfessionalProfileSummary(professionalProfile),
      user: {
        first_name: profile.user_id.first_name,
        last_name: profile.user_id.last_name,
        email: profile.user_id.email,
        profile_image: profile.user_id.profile_image,
        cover_image: profile.user_id.cover_image,
      },
    },
  };
};

export const generatePublicProfileCopyService = async (userId) => {
  const user = await User.findById(userId).lean();
  if (!user) {
    return {
      status: 404,
      body: { success: false, message: 'User not found' },
    };
  }

  const professionalProfile = await ProfessionalProfile.findOne({ user_id: userId }).lean();
  if (!professionalProfile) {
    return {
      status: 404,
      body: {
        success: false,
        message: 'Complete your professional profile before generating landing page copy.',
      },
    };
  }

  const generated = await generatePublicProfileCopy({ user, professionalProfile });

  return {
    status: 200,
    body: {
      success: true,
      message: 'AI landing page copy generated. Review and save to apply changes.',
      generated,
      professional_profile: toProfessionalProfileSummary(professionalProfile),
    },
  };
};

async function getOrCreatePublicProfileForStorefront(userId) {
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: userId }).lean();
  if (!professionalProfile) {
    return {
      error: {
        status: 404,
        body: { success: false, message: 'Professional profile not found' },
      },
    };
  }

  let profile = await PublicProfile.findOne({ user_id: userId });
  if (profile) {
    return { profile, professionalType: professionalProfile.professional_type };
  }

  const user = await User.findById(userId).lean();
  if (!user) {
    return {
      error: {
        status: 404,
        body: { success: false, message: 'User not found' },
      },
    };
  }

  profile = new PublicProfile({
    user_id: userId,
    professional_type: professionalProfile.professional_type,
    slug: await generateSlugFromName(`${user.first_name}-${user.last_name}`, userId),
    enabled: false,
  });
  return { profile, professionalType: professionalProfile.professional_type };
}

export const getOwnStorefrontDraftService = async (userId) => {
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: userId })
    .select('_id')
    .lean();
  if (!professionalProfile) {
    return {
      status: 404,
      body: { success: false, message: 'Professional profile not found' },
    };
  }

  const profile = await PublicProfile.findOne({ user_id: userId })
    .select('_id slug storefront.draft storefront.drafts storefront.active_template_id storefront.published.published_at')
    .lean();
  const legacyTemplateId = templateIdForRevision(profile?.storefront?.draft);
  if (profile?._id && legacyTemplateId && !profile.storefront?.drafts?.length) {
    await PublicProfile.updateOne(
      { _id: profile._id },
      {
        $set: {
          'storefront.drafts': [profile.storefront.draft],
          'storefront.active_template_id': profile.storefront?.active_template_id || legacyTemplateId,
        },
      },
    );
  }

  return {
    status: 200,
    body: {
      success: true,
      profile: profile ? { id: profile._id, slug: profile.slug } : null,
      draft: serializeStorefrontRevision(profile?.storefront?.draft),
      drafts: serializeStorefrontDrafts(profile?.storefront),
      active_template_id: profile?.storefront?.active_template_id || profile?.storefront?.draft?.template?.id || null,
      published_at: profile?.storefront?.published?.published_at || null,
    },
  };
};

export const getOwnStorefrontPropertiesService = async (userId) => (
  getSellerPropertiesBySlugService('', { requesterUserId: userId })
);

export const saveStorefrontDraftService = async (userId, draft) => {
  const { profile, professionalType, error } = await getOrCreatePublicProfileForStorefront(userId);
  if (error) return error;

  const { error: validationError, value: validatedDraft } = validateStorefrontDraftForRole(
    draft,
    professionalType,
  );
  if (validationError) {
    return {
      status: 400,
      body: {
        success: false,
        message: validationError.message,
      },
    };
  }
  const templateAccess = getStorefrontTemplateTier(validatedDraft.template?.id);
  if (!templateAccess) {
    return {
      status: 400,
      body: { success: false, message: 'Unsupported storefront template.' },
    };
  }
  if (!storefrontTemplateSupportsProfile(templateAccess, { professional_type: professionalType })) {
    return {
      status: 400,
      body: { success: false, message: 'This template is not available for your professional type.' },
    };
  }

  const revision = createDraftRevision(validatedDraft);
  const templateId = templateIdForRevision(revision);
  profile.storefront = profile.storefront || {};
  const drafts = storefrontDrafts(profile.storefront)
    .filter((entry) => templateIdForRevision(entry) !== templateId);
  drafts.push(revision);
  profile.storefront.drafts = drafts;
  profile.storefront.draft = revision;
  profile.storefront.active_template_id = templateId;
  await profile.save();

  return {
    status: 200,
    body: {
      success: true,
      message: 'Storefront draft saved successfully',
      profile: { id: profile._id, slug: profile.slug },
      draft: serializeStorefrontRevision(revision),
      drafts: serializeStorefrontDrafts(profile.storefront),
      active_template_id: templateId,
    },
  };
};

export const publishStorefrontService = async (userId, draft = null) => {
  const [profile, professionalProfile] = await Promise.all([
    PublicProfile.findOne({ user_id: userId })
      .select('user_id professional_type slug storefront'),
    ProfessionalProfile.findOne({ user_id: userId })
      .select('professional_type')
      .lean(),
  ]);
  if (!profile) {
    return {
      status: 404,
      body: { success: false, message: 'Public profile not found' },
    };
  }

  let sourceDraft = draft ? draft : activeStorefrontDraft(profile.storefront);
  let shouldPersistSourceDraft = false;
  if (draft) {
    shouldPersistSourceDraft = true;
  }

  if (!sourceDraft) {
    return {
      status: 409,
      body: { success: false, message: 'Save a storefront draft before publishing' },
    };
  }

  const professionalType = professionalProfile?.professional_type || profile.professional_type;
  const serializedSource = serializeStorefrontRevision(sourceDraft);
  const sourcePayload = {
    blocks: serializedSource?.blocks || [],
    brandKit: serializedSource?.brandKit || {},
    template: serializedSource?.template || {},
  };
  const { error: validationError, value: validatedDraft } = validateStorefrontDraftForRole(
    sourcePayload,
    professionalType,
  );
  if (validationError) {
    return {
      status: 400,
      body: {
        success: false,
        message: validationError.message,
      },
    };
  }

  const templateAccess = getStorefrontTemplateTier(validatedDraft.template?.id);
  if (!templateAccess) {
    return {
      status: 400,
      body: { success: false, message: 'Unsupported storefront template.' },
    };
  }
  if (!storefrontTemplateSupportsProfile(templateAccess, { professional_type: professionalType })) {
    return {
      status: 400,
      body: { success: false, message: 'This template is not available for your professional type.' },
    };
  }
  if (!userHasStorefrontTemplateAccess(profile, templateAccess.template_id)) {
    return {
      status: 402,
      body: {
        success: false,
        message: `${templateAccess.name} is a ${templateAccess.tier} template. Unlock it for ${templateAccess.amount / 100} USD before publishing.`,
        template: templateAccess,
      },
    };
  }

  const validatedRevision = createDraftRevision(
    validatedDraft,
    sourceDraft.updated_at || new Date(),
  );
  profile.storefront = profile.storefront || {};
  if (shouldPersistSourceDraft) {
    const templateId = templateIdForRevision(validatedRevision);
    profile.storefront.drafts = storefrontDrafts(profile.storefront)
      .filter((entry) => templateIdForRevision(entry) !== templateId)
      .concat(validatedRevision);
    profile.storefront.draft = validatedRevision;
    profile.storefront.active_template_id = templateId;
  }
  const published = createPublishedRevision(validatedRevision);
  profile.storefront.published = published;
  profile.enabled = true;
  await profile.save();

  return {
    status: 200,
    body: {
      success: true,
      message: 'Storefront published successfully',
      profile: { id: profile._id, slug: profile.slug },
      published: serializeStorefrontRevision(profile.storefront.published),
      drafts: serializeStorefrontDrafts(profile.storefront),
      active_template_id: profile.storefront.active_template_id || templateIdForRevision(validatedRevision),
    },
  };
};

export const generateStorefrontDraftService = async (userId, input = {}) => {
  const user = await User.findById(userId).lean();
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: userId }).lean();
  if (!user || !professionalProfile) {
    return {
      status: 404,
      body: { success: false, message: 'Complete your professional profile before generating a storefront.' },
    };
  }

  const { profile, error } = await getOrCreatePublicProfileForStorefront(userId);
  if (error) return error;
  const requestedTemplateKey = String(
    input.template_key || (String(professionalProfile.professional_type || user.role).toLowerCase() === 'agent'
      ? 'agent-investor'
      : `${professionalProfile.professional_type || user.role}-classic`),
  ).trim();
  const requestedTemplate = getStorefrontTemplateTier(requestedTemplateKey);
  if (!requestedTemplate) {
    return {
      status: 400,
      body: { success: false, message: 'Unsupported storefront template.' },
    };
  }
  if (!storefrontTemplateSupportsProfile(requestedTemplate, professionalProfile)) {
    return {
      status: 400,
      body: { success: false, message: 'This template is not available for your professional type.' },
    };
  }
  const existingRevision = storefrontDrafts(profile.storefront).find(
    (revision) => templateIdForRevision(revision) === requestedTemplateKey,
  );
  const brandKit = {
    ...(existingRevision?.brandKit?.toObject?.() || existingRevision?.brandKit || {}),
    ...(input.brand_kit || {}),
    essentials: {
      ...(existingRevision?.brandKit?.essentials || {}),
      ...(input.brand_kit?.essentials || {}),
    },
  };
  const onboarding = {
    ...brandKit.essentials,
    ...(input.onboarding || {}),
  };

  const generated = await generateStorefrontDraft({
    user,
    professionalProfile,
    onboarding,
    templateKey: requestedTemplateKey,
    brandKit,
  });
  const generatedRevision = createGeneratedDraftRevision(
    generated,
    existingRevision?.brandKit?.toObject?.() || existingRevision?.brandKit || {},
    new Date(),
    existingRevision?.blocks || [],
  );
  const { error: validationError } = validateStorefrontDraftForRole(
    {
      blocks: generatedRevision.blocks,
      brandKit: generatedRevision.brandKit,
      template: generatedRevision.template,
    },
    professionalProfile.professional_type,
  );
  if (validationError) {
    const generationError = new Error(`AI generated an invalid storefront draft: ${validationError.message}`);
    generationError.statusCode = 502;
    throw generationError;
  }

  profile.headline = generated.headline;
  profile.tagline = generated.tagline;
  profile.about = generated.about;
  profile.services = generated.services;
  profile.seo_meta = generated.seo_meta;
  profile.storefront = profile.storefront || {};
  profile.storefront.drafts = storefrontDrafts(profile.storefront)
    .filter((revision) => templateIdForRevision(revision) !== generated.template_key)
    .concat(generatedRevision);
  profile.storefront.draft = generatedRevision;
  profile.storefront.active_template_id = generated.template_key;
  await profile.save();

  return {
    status: 200,
    body: {
      success: true,
      message: 'AI storefront draft generated. Review it before publishing.',
      generated: {
        headline: generated.headline,
        tagline: generated.tagline,
        about: generated.about,
        seo_meta: generated.seo_meta,
        services: generated.services,
      },
      draft: serializeStorefrontRevision(generatedRevision),
      drafts: serializeStorefrontDrafts(profile.storefront),
      active_template_id: generated.template_key,
    },
  };
};

export const updatePublicProfileService = async (userId, updates) => {
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: userId }).lean();
  
  if (!professionalProfile) {
    return {
      status: 404,
      body: { success: false, message: 'Professional profile not found' },
    };
  }

  let profile = await PublicProfile.findOne({ user_id: userId });

  if (!profile) {
    if (!updates.slug) {
      const user = await User.findById(userId).lean();
      updates.slug = await generateSlugFromName(
        `${user.first_name}-${user.last_name}`,
        userId
      );
    }

    profile = new PublicProfile({
      user_id: userId,
      professional_type: professionalProfile.professional_type,
      slug: updates.slug,
      enabled: updates.enabled !== undefined ? updates.enabled : false,
    });
  }

  if (updates.slug && updates.slug !== profile.slug) {
    const existingSlug = await PublicProfile.findOne({
      slug: updates.slug,
      user_id: { $ne: userId },
    }).lean();
    
    if (existingSlug) {
      return {
        status: 400,
        body: { success: false, message: 'This slug is already taken' },
      };
    }
    profile.slug = updates.slug;
  }

  if (updates.enabled !== undefined) profile.enabled = updates.enabled;
  if (updates.cover_photo_url !== undefined) profile.cover_photo_url = updates.cover_photo_url;
  if (updates.profile_photo_url !== undefined) profile.profile_photo_url = updates.profile_photo_url;
  if (updates.headline !== undefined) profile.headline = updates.headline;
  if (updates.tagline !== undefined) profile.tagline = updates.tagline;
  if (updates.about !== undefined) profile.about = updates.about;
  
  if (updates.stats) {
    profile.stats = { ...profile.stats.toObject?.() || profile.stats, ...updates.stats };
  }
  
  if (updates.services !== undefined) profile.services = updates.services;
  if (updates.testimonials !== undefined) profile.testimonials = updates.testimonials;
  
  if (updates.featured_listings !== undefined) profile.featured_listings = updates.featured_listings;
  if (updates.top_listings !== undefined) profile.top_listings = updates.top_listings;
  if (updates.sold_listings !== undefined) profile.sold_listings = updates.sold_listings;
  
  if (updates.mortgage_programs !== undefined) profile.mortgage_programs = updates.mortgage_programs;
  if (updates.calculator_widgets_enabled !== undefined) {
    profile.calculator_widgets_enabled = updates.calculator_widgets_enabled;
  }
  
  if (updates.practice_areas !== undefined) profile.practice_areas = updates.practice_areas;
  if (updates.credentials !== undefined) profile.credentials = updates.credentials;
  
  if (updates.social_links) {
    profile.social_links = { ...profile.social_links.toObject?.() || profile.social_links, ...updates.social_links };
  }
  
  if (updates.partner_professionals !== undefined) {
    profile.partner_professionals = updates.partner_professionals;
  }
  
  if (updates.seo_meta) {
    profile.seo_meta = { ...profile.seo_meta.toObject?.() || profile.seo_meta, ...updates.seo_meta };
  }

  await profile.save();

  return {
    status: 200,
    body: {
      success: true,
      message: 'Profile updated successfully',
      profile: {
        id: profile._id,
        slug: profile.slug,
        enabled: profile.enabled,
      },
    },
  };
};

export const deletePublicProfileService = async (userId) => {
  const profile = await PublicProfile.findOne({ user_id: userId });

  if (!profile) {
    return {
      status: 404,
      body: { success: false, message: 'Public profile not found' },
    };
  }

  // Soft-delete profile content so user feedback history can survive page re-creation.
  // `feedback_submissions` is intentionally preserved.
  profile.enabled = false;
  profile.cover_photo_url = null;
  profile.profile_photo_url = null;
  profile.headline = null;
  profile.tagline = null;
  profile.about = null;
  profile.services = [];
  profile.testimonials = [];
  profile.featured_listings = [];
  profile.top_listings = [];
  profile.sold_listings = [];
  profile.mortgage_programs = [];
  profile.calculator_widgets_enabled = false;
  profile.practice_areas = [];
  profile.credentials = [];
  profile.social_links = {
    linkedin: null,
    facebook: null,
    instagram: null,
    twitter: null,
    website: null,
  };
  profile.partner_professionals = [];
  profile.theme_color = null;
  profile.custom_css = null;
  profile.seo_meta = {
    title: null,
    description: null,
    keywords: [],
  };
  profile.storefront = profile.storefront || {};
  profile.storefront.draft = null;
  profile.storefront.drafts = [];
  profile.storefront.active_template_id = null;
  profile.storefront.published = null;
  // Template purchases belong to the account and intentionally remain untouched.

  await profile.save();
  await ProfileViewEvent.deleteMany({ user_id: userId });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Public webpage deleted successfully',
    },
  };
};

export const getProfileAnalyticsService = async (userId, options) => {
  const { period = 'daily', start_date, end_date } = options;
  const end = end_date ? new Date(end_date) : new Date();
  const start = start_date
    ? new Date(start_date)
    : (() => {
        const d = new Date(end);
        d.setDate(d.getDate() - 89);
        return d;
      })();
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const events = await ProfileViewEvent.find({
    user_id: userId,
    timestamp: { $gte: start, $lte: end },
  })
    .sort({ timestamp: -1 })
    .lean();

  const buckets = new Map();
  const getBucketStart = (dateValue) => {
    const d = new Date(dateValue);
    if (period === 'monthly') {
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }
    if (period === 'weekly') {
      const day = d.getDay();
      d.setDate(d.getDate() - day);
    }
    d.setHours(0, 0, 0, 0);
    return d;
  };

  for (const event of events) {
    const bucketDate = getBucketStart(event.timestamp);
    const key = bucketDate.toISOString();
    if (!buckets.has(key)) {
      buckets.set(key, {
        user_id: userId,
        period,
        date: bucketDate,
        metrics: {
          profile_views: 0,
          unique_visitors: 0,
          chatbot_opens: 0,
          consultation_requests: 0,
          leads_generated: 0,
          traffic_sources: {
            direct: 0,
            referral: 0,
            social: 0,
            search: 0,
            other: 0,
          },
        },
        _visitorIds: new Set(),
      });
    }
    const bucket = buckets.get(key);
    const metrics = bucket.metrics;
    if (event.event_type === 'profile_view') metrics.profile_views += 1;
    if (event.event_type === 'chatbot_open') metrics.chatbot_opens += 1;
    if (event.event_type === 'consultation_request') metrics.consultation_requests += 1;
    if (event.event_type === 'cta_click' && event.cta_type === 'lead_created') metrics.leads_generated += 1;
    if (event.visitor_id) bucket._visitorIds.add(String(event.visitor_id));
    const knownSources = new Set(['direct', 'referral', 'social', 'search', 'other']);
    const source = knownSources.has(event.traffic_source) ? event.traffic_source : 'other';
    metrics.traffic_sources[source] = (metrics.traffic_sources[source] || 0) + 1;
  }

  const analytics = Array.from(buckets.values())
    .map((bucket) => {
      bucket.metrics.unique_visitors = bucket._visitorIds.size;
      delete bucket._visitorIds;
      return bucket;
    })
    .sort((a, b) => b.date - a.date)
    .slice(0, 90);

  const totalMetrics = analytics.reduce(
    (acc, item) => {
      const m = item.metrics;
      return {
        profile_views: acc.profile_views + (m.profile_views || 0),
        unique_visitors: acc.unique_visitors + (m.unique_visitors || 0),
        chatbot_opens: acc.chatbot_opens + (m.chatbot_opens || 0),
        consultation_requests: acc.consultation_requests + (m.consultation_requests || 0),
        leads_generated: acc.leads_generated + (m.leads_generated || 0),
        traffic_sources: {
          direct: acc.traffic_sources.direct + (m.traffic_sources?.direct || 0),
          referral: acc.traffic_sources.referral + (m.traffic_sources?.referral || 0),
          social: acc.traffic_sources.social + (m.traffic_sources?.social || 0),
          search: acc.traffic_sources.search + (m.traffic_sources?.search || 0),
          other: acc.traffic_sources.other + (m.traffic_sources?.other || 0),
        },
      };
    },
    {
      profile_views: 0,
      unique_visitors: 0,
      chatbot_opens: 0,
      consultation_requests: 0,
      leads_generated: 0,
      traffic_sources: {
        direct: 0,
        referral: 0,
        social: 0,
        search: 0,
        other: 0,
      },
    }
  );

  return {
    status: 200,
    body: {
      success: true,
      period,
      data: analytics,
      summary: totalMetrics,
      count: analytics.length,
    },
  };
};

export const exportProfileAnalyticsService = async (userId, options) => {
  const analyticsResult = await getProfileAnalyticsService(userId, options);
  
  if (analyticsResult.status !== 200) {
    return analyticsResult;
  }

  const { data } = analyticsResult.body;

  if (options.format === 'csv') {
    const csvRows = [
      'Date,Profile Views,Unique Visitors,Chatbot Opens,Consultation Requests,Leads Generated',
    ];

    data.forEach((item) => {
      const m = item.metrics;
      csvRows.push(
        [
          item.date,
          m.profile_views || 0,
          m.unique_visitors || 0,
          m.chatbot_opens || 0,
          m.consultation_requests || 0,
          m.leads_generated || 0,
        ].join(',')
      );
    });

    return {
      status: 200,
      body: { success: true, data: csvRows.join('\n') },
    };
  }

  return analyticsResult;
};

export const updateThemeService = async (userId, themeData) => {
  const profile = await PublicProfile.findOne({ user_id: userId });

  if (!profile) {
    return {
      status: 404,
      body: { success: false, message: 'Public profile not found' },
    };
  }

  if (themeData.theme_color !== undefined) {
    profile.theme_color = themeData.theme_color;
  }
  
  if (themeData.custom_css !== undefined) {
    profile.custom_css = themeData.custom_css;
  }

  await profile.save();

  return {
    status: 200,
    body: {
      success: true,
      message: 'Theme updated successfully',
      theme_color: profile.theme_color,
      custom_css: profile.custom_css,
    },
  };
};
