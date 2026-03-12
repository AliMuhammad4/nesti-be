import mongoose from 'mongoose';

const leadAttributionSchema = new mongoose.Schema(
  {
    lead_type: {
      type: String,
      enum: [
        'hot_buyer', 'warm_buyer', 'cold_buyer',
        'hot_seller', 'warm_seller', 'cold_seller',
        'unknown',
      ],
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
      enum: ['hot', 'warm', 'cold'],
      default: 'cold',
    },
  },
  { timestamps: true }
);

export default mongoose.model('LeadAttribution', leadAttributionSchema);
