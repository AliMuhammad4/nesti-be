import mongoose from 'mongoose';
import { ENTERPRISE_INQUIRY_STATUSES } from '../constants/validationEnums.js';

const enterpriseInquirySchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
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
  }
}, { timestamps: true });

export default mongoose.model('EnterpriseInquiry', enterpriseInquirySchema);
