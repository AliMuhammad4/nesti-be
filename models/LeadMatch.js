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
    /** Mixed bag: contact, calendly, session, embed_token, etc.
     * `agent_notes`: append-only `[{ id, text, created_at, author_user_id, author_label? }]` (cap in service). */
    compatibility_factors: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    icp_fit: {
      fit_score: { type: Number, default: null },
      fit_tier: { type: String, enum: ['perfect_match', 'good_match', 'low_match', null], default: null },
      matched_factors: [{ type: String }],
      missing_factors: [{ type: String }],
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

leadMatchSchema.index({ user_id: 1, 'icp_fit.fit_tier': 1, lead_profile_id: 1 });
leadMatchSchema.index({ user_id: 1, lead_profile_id: 1 });

export default mongoose.model('LeadMatch', leadMatchSchema);
