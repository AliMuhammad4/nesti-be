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

export default mongoose.model('Referral', referralSchema);
