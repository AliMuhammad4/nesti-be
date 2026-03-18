import mongoose from 'mongoose';

const leadMatchSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    professional_profile_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProfessionalProfile',
    },
    lead_type: {
      type: String,
      enum: [
        'hot_buyer', 'warm_buyer', 'cold_buyer',
        'hot_seller', 'warm_seller', 'cold_seller',
        'hot_client', 'warm_client', 'cold_client',
        'unknown',
      ],
      default: 'unknown',
    },
    lead_profile_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadProfile',
      default: null,
    },
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      index: true,
    },
    match_score: {
      type: Number,
      default: 0,
    },
    match_status: {
      type: String,
      enum: ['new', 'consult_booked', 'showing_booked', 'nurturing', 'converted'],
      default: 'new',
    },
    compatibility_factors: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    contact_count: {
      type: Number,
      default: 0,
    },
    first_contact_at: {
      type: Date,
    },
    last_contact_at: {
      type: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.model('LeadMatch', leadMatchSchema);
