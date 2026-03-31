import mongoose from 'mongoose';
import { LEAD_TYPES, MATCH_STATUSES } from '../constants/validationEnums.js';

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
      enum: LEAD_TYPES,
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
      enum: MATCH_STATUSES,
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
