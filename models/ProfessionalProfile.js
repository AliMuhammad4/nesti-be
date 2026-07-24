import mongoose from 'mongoose';
import { PROFESSIONAL_TYPE, PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { PropertyMatchSettingsSchema } from './propertyMatchScoringShapes.js';

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

export default mongoose.model('ProfessionalProfile', professionalProfileSchema);
