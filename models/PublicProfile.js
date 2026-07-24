import mongoose from 'mongoose';
import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';

const serviceSchema = new mongoose.Schema({
  icon: { type: String, default: null },
  title: { type: String, required: true },
  description: { type: String, default: null },
  cta_text: { type: String, default: 'Learn More' },
}, { _id: true });

const testimonialSchema = new mongoose.Schema({
  client_name: { type: String, required: true },
  client_photo_url: { type: String, default: null },
  rating: { type: Number, min: 1, max: 5, default: 5 },
  text: { type: String, required: true },
  date: { type: Date, default: Date.now },
}, { _id: true });

const feedbackSubmissionSchema = new mongoose.Schema({
  client_name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 180 },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, required: true, trim: true, maxlength: 1000 },
  submitted_at: { type: Date, default: Date.now },
}, { _id: true });

const mortgageProgramSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  min_credit_score: { type: Number, default: null },
  down_payment_min: { type: String, default: null },
}, { _id: true });

const credentialSchema = new mongoose.Schema({
  title: { type: String, required: true },
  issuer: { type: String, required: true },
  year: { type: Number, required: true },
}, { _id: true });

// Storefront content is revisioned so unpublished authoring changes cannot
// affect the public storefront.
const storefrontBlockSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 100 },
  type: { type: String, required: true, maxlength: 80 },
  data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { _id: false });

const storefrontBrandKitSchema = new mongoose.Schema({
  logo_url: { type: String, default: null },
  cover_url: { type: String, default: null },
  profile_photo_url: { type: String, default: null },
  logo_size: { type: Number, min: 24, max: 72, default: 40 },
  cover_position_x: { type: Number, min: 0, max: 100, default: 50 },
  cover_position_y: { type: Number, min: 0, max: 100, default: 50 },
  cover_zoom: { type: Number, min: 1, max: 3, default: 1 },
  profile_position_x: { type: Number, min: 0, max: 100, default: 50 },
  profile_position_y: { type: Number, min: 0, max: 100, default: 25 },
  profile_zoom: { type: Number, min: 1, max: 3, default: 1 },
  primary_color: { type: String, default: null },
  secondary_color: { type: String, default: null },
  accent_color: { type: String, default: null },
  font_family: { type: String, default: null },
  business_name: { type: String, default: null },
  button_shape: { type: String, enum: ['square', 'rounded', 'pill', null], default: null },
}, { _id: false });

const storefrontTemplateSchema = new mongoose.Schema({
  id: { type: String, default: null, maxlength: 100 },
  name: { type: String, default: null, maxlength: 120 },
  version: { type: String, default: null, maxlength: 40 },
}, { _id: false });

const storefrontRevisionSchema = new mongoose.Schema({
  blocks: { type: [storefrontBlockSchema], default: [] },
  brandKit: { type: storefrontBrandKitSchema, default: () => ({}) },
  template: { type: storefrontTemplateSchema, default: () => ({}) },
  updated_at: { type: Date, default: null },
  published_at: { type: Date, default: null },
}, { _id: false });

const publicProfileSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  
  professional_type: {
    type: String,
    enum: PROFESSIONAL_TYPE_VALUES,
    required: true,
  },
  
  // Public visibility
  enabled: {
    type: Boolean,
    default: false,
  },
  
  // Unique URL slug (e.g., /p/sarah-johnson)
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  
  // Hero Section
  cover_photo_url: {
    type: String,
    default: null,
  },
  profile_photo_url: {
    type: String,
    default: null,
  },
  headline: {
    type: String,
    default: null,
    maxlength: 100,
  },
  tagline: {
    type: String,
    default: null,
    maxlength: 200,
  },
  
  // Role-specific stats
  stats: {
    // Agent stats
    homes_sold: { type: Number, default: 0 },
    sales_volume: { type: Number, default: 0 },
    client_rating: { type: Number, min: 0, max: 5, default: 0 },
    years_experience: { type: Number, default: 0 },
    
    // Mortgage Broker stats
    loans_funded: { type: Number, default: 0 },
    approval_rate: { type: Number, min: 0, max: 100, default: 0 },
    avg_approval_days: { type: Number, default: 0 },
    
    // Lawyer stats
    transactions_closed: { type: Number, default: 0 },
    years_practice: { type: Number, default: 0 },
    bar_associations: [{ type: String }],
  },
  
  // Content Sections
  about: {
    type: String,
    default: null,
    maxlength: 2000,
  },
  
  services: [serviceSchema],
  
  testimonials: [testimonialSchema],
  feedback_submissions: [feedbackSubmissionSchema],
  
  // Agent-specific content
  featured_listings: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
  }],
  top_listings: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
  }],
  sold_listings: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
  }],
  
  // Mortgage Broker-specific content
  mortgage_programs: [mortgageProgramSchema],
  calculator_widgets_enabled: {
    type: Boolean,
    default: false,
  },
  
  // Lawyer-specific content
  practice_areas: [{ type: String }],
  credentials: [credentialSchema],
  
  // Social & Contact
  social_links: {
    linkedin: { type: String, default: null },
    facebook: { type: String, default: null },
    instagram: { type: String, default: null },
    twitter: { type: String, default: null },
    website: { type: String, default: null },
  },
  
  // Partnerships (for cross-professional referrals)
  partner_professionals: [{
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    role: { type: String },
  }],
  
  // Customization
  theme_color: {
    type: String,
    default: null,
  },
  custom_css: {
    type: String,
    default: null,
  },
  
  // SEO
  seo_meta: {
    title: { type: String, default: null, maxlength: 60 },
    description: { type: String, default: null, maxlength: 160 },
    keywords: [{ type: String }],
  },

  // AI business storefront foundation. Keep it separate from the legacy
  // public-profile fields to preserve all existing profile API behavior.
  storefront: {
    draft: { type: storefrontRevisionSchema, default: null },
    published: { type: storefrontRevisionSchema, default: null },
  },
  
}, { timestamps: true });

// `slug` and `user_id` already get unique indexes from the `unique: true` field options.
// Compound index for the public listing browser (enabled + role filter).
publicProfileSchema.index({ enabled: 1, professional_type: 1 });

export default mongoose.model('PublicProfile', publicProfileSchema);
