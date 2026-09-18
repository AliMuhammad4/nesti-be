import mongoose from 'mongoose';
import { PROFESSIONAL_TYPE, PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { PropertyMatchSettingsSchema } from './propertyMatchScoringShapes.js';
import {
  CREDENTIAL_DOC_TYPE_VALUES,
  CREDENTIAL_EVENT_TYPE_VALUES,
  CREDENTIAL_STATUS,
  CREDENTIAL_STATUS_VALUES,
} from '../constants/credentialDocuments.js';

const credentialDocumentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: CREDENTIAL_DOC_TYPE_VALUES,
      required: true,
    },
    file_url: { type: String, required: true },
    file_key: { type: String, default: '' },
    file_name: { type: String, default: '' },
    mime_type: { type: String, default: '' },
    uploaded_at: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['uploaded', 'accepted', 'rejected'],
      default: 'uploaded',
    },
  },
  { _id: true },
);

const credentialEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    type: {
      type: String,
      enum: CREDENTIAL_EVENT_TYPE_VALUES,
      required: true,
    },
    actor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actor_role: { type: String, default: '' },
    reason: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true },
);

const professionalProfileSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  professional_type: {
    type: String,
    enum: PROFESSIONAL_TYPE_VALUES,
    default: PROFESSIONAL_TYPE.AGENT,
  },
  full_name: {
    type: String,
  },
  website: {
    type: String,
  },
  company_name: {
    type: String,
  },
  certificates: [
    {
      type: String,
    },
  ],
  phone: {
    type: String,
  },
  location: {
    type: String,
  },
  target_neighborhoods: {
    type: String,
  },
  experience: {
    type: String,
  },
  license_number: {
    type: String,
  },
  /** Credential verification (US/Canada). Separate from User.is_verified (email). */
  country: {
    type: String,
    default: null,
  },
  jurisdiction: {
    type: String,
    default: '',
  },
  nmls_id: {
    type: String,
    default: '',
  },
  credential_status: {
    type: String,
    enum: CREDENTIAL_STATUS_VALUES,
    default: CREDENTIAL_STATUS.NOT_STARTED,
    index: true,
  },
  credential_submitted_at: {
    type: Date,
    default: null,
  },
  credential_reviewed_at: {
    type: Date,
    default: null,
  },
  credential_reviewed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  credential_reject_reason: {
    type: String,
    default: '',
  },
  credential_documents: {
    type: [credentialDocumentSchema],
    default: [],
  },
  credential_events: {
    type: [credentialEventSchema],
    default: [],
  },
  social_media: {
    type: String,
  },
  transaction_volume: {
    type: String,
  },
  avg_sale_price: {
    type: String,
  },
  avg_home_price: {
    type: Number,
    default: null,
  },
  commission_rate_percent: {
    type: Number,
    default: null,
  },
  response_time: {
    type: String,
  },
  availability: {
    type: String,
  },
  support_level: {
    type: String,
  },
  negotiation_style: {
    type: String,
  },
  sales_approach: {
    type: String,
  },
  energy_style: {
    type: String,
  },
  personality_tag: {
    type: String,
  },
  awards: {
    type: String,
  },
  specializations: [
    {
      type: String,
    },
  ],
  communication_channels: [
    {
      type: String,
    },
  ],
  preferred_clients: [
    {
      type: String,
    },
  ],
  calendly_link: {
    type: String,
  },
  bio: {
    type: String,
  },
  property_match_scoring: {
    type: PropertyMatchSettingsSchema,
    required: false,
    default: undefined,
  },
  // New reference-based ICP storage.
  active_icp_profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IcpProfile',
    default: null,
  },
  icp_profile_ids: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IcpProfile',
    },
  ],
  // New matching fields
  languages_spoken: [
    {
      type: String,
      enum: [
        'english',
        'french',
        'punjabi',
        'tamil',
        'mandarin',
        'arabic',
        'spanish',
        'hindi',
        'urdu',
        'portuguese',
        'tagalog',
        'italian',
        'german',
        'japanese',
        'vietnamese',
        'other',
      ],
    },
  ],
  other_language_text: {
    type: String,
    default: '',
  },
  working_style_structured: {
    type: String,
    enum: ['educational_advisor', 'fast_deal_closer', 'data_driven', 'relationship_focused', 'investor_oriented'],
  },
  working_style_tags: [
    {
      type: String,
    },
  ],
  experience_level: {
    type: String,
    enum: ['junior', 'mid', 'senior', 'elite'],
  },
  core_specialization_tags: [
    {
      type: String,
    },
  ],
  specialty_strength_tags: [
    {
      type: String,
    },
  ],
  personality_style_tags: [
    {
      type: String,
    },
  ],
  service_area_primary_zones: [
    {
      type: String,
    },
  ],
  service_area_secondary_zones: [
    {
      type: String,
    },
  ],
  service_area_cities: [
    {
      type: String,
    },
  ],
  service_area_regions: [
    {
      type: String,
    },
  ],
}, { timestamps: true });

professionalProfileSchema.index({ credential_status: 1, credential_submitted_at: -1 });
professionalProfileSchema.index({ professional_type: 1, updatedAt: -1 });
professionalProfileSchema.index({ country: 1, credential_status: 1 });

export default mongoose.model('ProfessionalProfile', professionalProfileSchema);
