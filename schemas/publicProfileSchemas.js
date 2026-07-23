import Joi from 'joi';
import { storefrontDraftSchema } from '../services/publicProfile/storefrontValidation.js';

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

export { storefrontDraftSchema };

export const saveStorefrontDraftSchema = Joi.object({
  draft: storefrontDraftSchema.required(),
}).unknown(false);

export const generateStorefrontDraftSchema = Joi.object({
  template_key: Joi.string().trim().max(80).optional(),
  onboarding: Joi.object().unknown(true).max(20).optional(),
  brand_kit: Joi.object({
    business_name: Joi.string().trim().max(120).allow('').optional(),
    logo_url: Joi.string().uri().allow('').optional(),
    logo_dark_url: Joi.string().uri().allow('').optional(),
    primary_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow('').optional(),
    accent_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow('').optional(),
    font: Joi.string().trim().max(80).allow('').optional(),
    button_shape: Joi.string().trim().max(30).allow('').optional(),
    image_style: Joi.string().trim().max(80).allow('').optional(),
    essentials: Joi.object().unknown(true).max(20).optional(),
  }).unknown(false).optional(),
}).unknown(false);

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

export const submitPublicLeadSchema = Joi.object({
  full_name: Joi.string().trim().max(120).required(),
  email: Joi.string().trim().email().allow('').empty('').optional(),
  phone: Joi.string().trim().max(40).allow('').empty('').optional(),
  intent: Joi.string().valid('buy', 'sell', 'unspecified').optional(),
  location: Joi.string().trim().max(180).allow('').optional(),
  address: Joi.string().trim().max(220).allow('').optional(),
  budget: Joi.string().trim().max(80).allow('').optional(),
  price: Joi.string().trim().max(80).allow('').optional(),
  timeline: Joi.string().trim().max(80).allow('').optional(),
  property_type: Joi.string().trim().max(80).allow('').optional(),
  beds: Joi.string().trim().max(20).allow('').optional(),
  baths: Joi.string().trim().max(20).allow('').optional(),
  must_have_features: Joi.string().trim().max(500).allow('').optional(),
  parking_required: Joi.string().trim().max(20).allow('').optional(),
  backyard_needed: Joi.string().trim().max(20).allow('').optional(),
  school_district_important: Joi.string().trim().max(20).allow('').optional(),
  inquired_property: Joi.object({
    id: Joi.string().trim().max(80).allow('', null).optional(),
    title: Joi.string().trim().max(180).allow('', null).optional(),
    address: Joi.string().trim().max(240).allow('', null).optional(),
    location: Joi.string().trim().max(180).allow('', null).optional(),
    expected_price: Joi.string().trim().max(80).allow('', null).optional(),
    property_type: Joi.string().trim().max(80).allow('', null).optional(),
    bedrooms: Joi.alternatives().try(Joi.string().trim().max(20), Joi.number()).allow('', null).optional(),
    bathrooms: Joi.alternatives().try(Joi.string().trim().max(20), Joi.number()).allow('', null).optional(),
    square_footage: Joi.alternatives().try(Joi.string().trim().max(30), Joi.number()).allow('', null).optional(),
    seller_name: Joi.string().trim().max(120).allow('', null).optional(),
    seller_email: Joi.string().trim().email().allow('', null).optional(),
    seller_phone: Joi.string().trim().max(40).allow('', null).optional(),
    listed_by_name: Joi.string().trim().max(120).allow('', null).optional(),
    images: Joi.array().items(Joi.string().uri()).max(8).optional(),
  })
    .optional(),
  property_images: Joi.array()
    .items(
      Joi.object({
        url: Joi.string().uri().allow('').optional(),
        secure_url: Joi.string().uri().allow('').optional(),
      })
        .or('url', 'secure_url')
        .unknown(true),
    )
    .max(8)
    .optional(),
  message: Joi.string().trim().max(2000).allow('').optional(),
  preferred_contact_method: Joi.string().trim().max(40).allow('').optional(),
  best_time_to_contact: Joi.string().trim().max(80).allow('').optional(),
  mortgage_status: Joi.string().trim().max(80).allow('').optional(),
  realtor_status: Joi.string().trim().max(80).allow('').optional(),
  motivation_reason: Joi.string().trim().max(120).allow('').optional(),
  viewing_readiness: Joi.string().trim().max(80).allow('').optional(),
  living_situation: Joi.string().trim().max(80).allow('').optional(),
  urgency_readiness: Joi.string().trim().max(80).allow('').optional(),
  mortgage_timeline: Joi.string().trim().max(80).allow('').optional(),
  pre_approval_status: Joi.string().trim().max(80).allow('').optional(),
  credit_score_range: Joi.string().trim().max(80).allow('').optional(),
  employment_status: Joi.string().trim().max(80).allow('').optional(),
  household_income: Joi.string().trim().max(80).allow('').optional(),
  down_payment_readiness: Joi.string().trim().max(80).allow('').optional(),
  property_budget: Joi.string().trim().max(80).allow('').optional(),
  purchase_purpose: Joi.string().trim().max(80).allow('').optional(),
  urgency_signal: Joi.string().trim().max(80).allow('').optional(),
  transaction_stage: Joi.string().trim().max(80).allow('').optional(),
  closing_timeline: Joi.string().trim().max(80).allow('').optional(),
  transaction_type: Joi.string().trim().max(80).allow('').optional(),
  property_value: Joi.string().trim().max(80).allow('').optional(),
  realtor_involved: Joi.string().trim().max(20).allow('').optional(),
  first_time_buyer: Joi.string().trim().max(20).allow('').optional(),
  legal_services_needed: Joi.string().trim().max(220).allow('').optional(),
  session_id: Joi.string().trim().max(120).allow('').optional(),
  visitor_id: Joi.string().trim().max(120).allow('').optional(),
}).or('email', 'phone');

export const submitPublicFeedbackSchema = Joi.object({
  client_name: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().email().max(180).required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  text: Joi.string().trim().min(20).max(1000).required(),
  website: Joi.string().allow('').max(0).optional(),
}).unknown(false);
