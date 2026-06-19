import mongoose from 'mongoose';
import { NURTURE_LOG_STATUSES } from '../constants/validationEnums.js';

const nurtureLogSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lead_match_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeadMatch',
    default: null,
    index: true,
  },
  lead_profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeadProfile',
    default: null,
    index: true,
  },
  /** Calendly-scheduled start when webhook marks meeting_booked (ISO-aligned Date). */
  calendly_scheduled_start: {
    type: Date,
    default: null,
  },
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatConversation',
    default: null,
  },
  to_email: {
    type: String,
    required: true,
  },
  subject: {
    type: String,
    required: true,
  },
  body: {
    type: String,
    required: true,
  },
  sent_at: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: NURTURE_LOG_STATUSES,
    default: 'sent',
  },
  automation_type: {
    type: String,
    default: '',
    index: true,
  },
  idempotency_key: {
    type: String,
    default: '',
  },
  followup_due_for: {
    type: Date,
    default: null,
  },
  meeting_booked: {
    type: Boolean,
    default: false,
    index: true,
  },
  meeting_booked_at: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

nurtureLogSchema.index({ user_id: 1, createdAt: -1 });
nurtureLogSchema.index({ user_id: 1, status: 1, createdAt: -1 });
nurtureLogSchema.index({ user_id: 1, lead_match_id: 1, createdAt: -1 });
nurtureLogSchema.index({ user_id: 1, lead_profile_id: 1, createdAt: -1 });
nurtureLogSchema.index({ automation_type: 1, followup_due_for: 1, createdAt: -1 });
nurtureLogSchema.index({ idempotency_key: 1 });
nurtureLogSchema.index({ user_id: 1, meeting_booked: 1, calendly_scheduled_start: 1 });

export default mongoose.model('NurtureLog', nurtureLogSchema);
