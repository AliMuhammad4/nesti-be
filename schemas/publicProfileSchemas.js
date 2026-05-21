import Joi from 'joi';

export const updatePublicProfileSchema = Joi.object({
  slug: Joi.string().min(3).max(50).lowercase().trim().pattern(/^[a-z0-9-]+$/).optional(),
  enabled: Joi.boolean().optional(),
  
  cover_photo_url: Joi.string().uri().allow(null, '').optional(),
  profile_photo_url: Joi.string().uri().allow(null, '').optional(),
  headline: Joi.string().max(100).allow(null, '').optional(),
  tagline: Joi.string().max(200).allow(null, '').optional(),
  about: Joi.string().max(2000).allow(null, '').optional(),
  
  stats: Joi.object({
    homes_sold: Joi.number().min(0).optional(),
    sales_volume: Joi.number().min(0).optional(),
    client_rating: Joi.number().min(0).max(5).optional(),
    years_experience: Joi.number().min(0).optional(),
    loans_funded: Joi.number().min(0).optional(),
    approval_rate: Joi.number().min(0).max(100).optional(),
    avg_approval_days: Joi.number().min(0).optional(),
    transactions_closed: Joi.number().min(0).optional(),
    years_practice: Joi.number().min(0).optional(),
    bar_associations: Joi.array().items(Joi.string()).optional(),
  }).optional(),
  
  services: Joi.array().items(
    Joi.object({
      icon: Joi.string().allow(null, '').optional(),
      title: Joi.string().required(),
      description: Joi.string().allow(null, '').optional(),
      cta_text: Joi.string().optional(),
    })
  ).optional(),
  
  testimonials: Joi.array().items(
    Joi.object({
      client_name: Joi.string().required(),
      client_photo_url: Joi.string().uri().allow(null, '').optional(),
      rating: Joi.number().min(1).max(5).optional(),
      text: Joi.string().required(),
      date: Joi.date().optional(),
    })
  ).optional(),
  
  featured_listings: Joi.array().items(Joi.string()).optional(),
  top_listings: Joi.array().items(Joi.string()).optional(),
  sold_listings: Joi.array().items(Joi.string()).optional(),
  
  mortgage_programs: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      description: Joi.string().required(),
      min_credit_score: Joi.number().min(300).max(850).allow(null).optional(),
      down_payment_min: Joi.string().allow(null, '').optional(),
    })
  ).optional(),
  
  calculator_widgets_enabled: Joi.boolean().optional(),
  
  practice_areas: Joi.array().items(Joi.string()).optional(),
  
  credentials: Joi.array().items(
    Joi.object({
      title: Joi.string().required(),
      issuer: Joi.string().required(),
      year: Joi.number().min(1900).max(new Date().getFullYear()).required(),
    })
  ).optional(),
  
  social_links: Joi.object({
    linkedin: Joi.string().uri().allow(null, '').optional(),
    facebook: Joi.string().uri().allow(null, '').optional(),
    instagram: Joi.string().uri().allow(null, '').optional(),
    twitter: Joi.string().uri().allow(null, '').optional(),
    website: Joi.string().uri().allow(null, '').optional(),
  }).optional(),
  
  partner_professionals: Joi.array().items(
    Joi.object({
      user_id: Joi.string().required(),
      role: Joi.string().optional(),
    })
  ).optional(),
  
  seo_meta: Joi.object({
    title: Joi.string().max(60).allow(null, '').optional(),
    description: Joi.string().max(160).allow(null, '').optional(),
    keywords: Joi.array().items(Joi.string()).optional(),
  }).optional(),
}).min(1);

export const updateThemeSchema = Joi.object({
  theme_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow(null, '').optional(),
  custom_css: Joi.string().max(5000).allow(null, '').optional(),
}).min(1);

export const trackAnalyticsSchema = Joi.object({
  visitor_id: Joi.string().required(),
  event_type: Joi.string().valid(
    'profile_view',
    'listing_view',
    'listing_click',
    'listing_save',
    'service_click',
    'cta_click',
    'chatbot_open',
    'consultation_request',
    'contact_click',
    'social_click',
    'partner_click'
  ).required(),
  event_data: Joi.object().optional(),
  session_id: Joi.string().required(),
  referrer: Joi.string().allow(null, '').optional(),
  listing_id: Joi.string().allow(null).optional(),
  service_id: Joi.string().allow(null).optional(),
  cta_type: Joi.string().allow(null, '').optional(),
  duration_seconds: Joi.number().min(0).allow(null).optional(),
});
