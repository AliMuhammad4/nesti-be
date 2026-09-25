import mongoose from 'mongoose';
import { ENTERPRISE_INQUIRY_STATUSES } from '../constants/validationEnums.js';

const enterpriseInquirySchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  email: { type: String, default: '', index: true },
  phone: { type: String, default: '' },
  full_name: { type: String, default: '' },
  interest_role: { type: String, default: '' },
  source: { type: String, enum: ['demo', 'contact', ''], default: '' },
  company_name: {
    type: String,
    required: true,
  },
  team_size: {
    type: Number,
  },
  message: {
    type: String,
  },
  status: {
    type: String,
    enum: ENTERPRISE_INQUIRY_STATUSES,
    default: 'pending',
  },
  voice_outcome: {
    type: String,
    enum: ['', 'interested', 'callback', 'declined', 'plan_recommended'],
    default: '',
  },
  voice_outcome_plan: { type: String, default: '' },
  voice_outcome_note: { type: String, default: '' },
  voice_outcome_at: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('EnterpriseInquiry', enterpriseInquirySchema);
