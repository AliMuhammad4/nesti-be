import mongoose from 'mongoose';
import { LEAD_TYPES, LEAD_QUALITY_LEVELS } from '../constants/validationEnums.js';

const leadAttributionSchema = new mongoose.Schema(
  {
    lead_type: {
      type: String,
      enum: LEAD_TYPES,
      default: 'unknown',
    },
    source: {
      type: String,
      default: 'chatbot',
    },
    converted: {
      type: Boolean,
      default: false,
    },
    lead_profile_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadProfile',
      default: null,
    },
    lead_match_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadMatch',
      default: null,
      index: true,
    },
    session_id: {
      type: String,
    },
    ip_address: {
      type: String,
    },
    user_agent: {
      type: String,
    },
    referrer_url: {
      type: String,
    },
    landing_page: {
      type: String,
    },
    utm_source: {
      type: String,
    },
    utm_medium: {
      type: String,
    },
    utm_campaign: {
      type: String,
    },
    utm_content: {
      type: String,
    },
    utm_term: {
      type: String,
    },
    initial_score: {
      type: Number,
      default: 0,
    },
    initial_quality: {
      type: String,
      enum: LEAD_QUALITY_LEVELS,
      default: 'cold',
    },
  },
  { timestamps: true }
);

export default mongoose.model('LeadAttribution', leadAttributionSchema);
