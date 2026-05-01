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
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatConversation',
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

/** At most one in-flight outbound referral per referrer + conversation (pending/accepted). */
referralSchema.index(
  { user_id: 1, conversation_id: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'accepted'] } },
  }
);

export default mongoose.model('Referral', referralSchema);
