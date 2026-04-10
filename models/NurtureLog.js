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

export default mongoose.model('NurtureLog', nurtureLogSchema);
