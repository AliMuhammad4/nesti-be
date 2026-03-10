import mongoose from 'mongoose';

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
    enum: ['pending', 'contacted', 'resolved'],
    default: 'pending',
  }
}, { timestamps: true });

export default mongoose.model('EnterpriseInquiry', enterpriseInquirySchema);
