import mongoose from 'mongoose';
import { REFERRAL_STATUSES } from '../constants/validationEnums.js';

const referralSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  target_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  /** @deprecated Legacy rows only — new referrals use lead_match_id. */
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatConversation',
    default: null,
  },
  lead_match_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeadMatch',
    required: true,
  },
  target_vertical: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: REFERRAL_STATUSES,
    default: 'pending',
  },
  notes: {
    type: String,
  }
}, { timestamps: true });

/** At most one in-flight referral per referrer lead + target (pending/accepted). */
referralSchema.index(
  { user_id: 1, lead_match_id: 1, target_user_id: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'accepted'] } },
  }
);
referralSchema.index({ user_id: 1, createdAt: -1 });
referralSchema.index({ target_user_id: 1, createdAt: -1 });
referralSchema.index({ user_id: 1, status: 1, createdAt: -1 });
referralSchema.index({ target_user_id: 1, status: 1, createdAt: -1 });
referralSchema.index({ lead_match_id: 1, status: 1 });

export default mongoose.model('Referral', referralSchema);
