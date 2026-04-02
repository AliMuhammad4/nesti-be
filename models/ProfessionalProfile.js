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
  calendly_link: {
    type: String,
  },
  mortgage_calendly_link_hot: {
    type: String,
  },
  mortgage_calendly_link_warm: {
    type: String,
  },
  mortgage_calendly_link_early: {
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
}, { timestamps: true });

export default mongoose.model('ProfessionalProfile', professionalProfileSchema);
