import mongoose from 'mongoose';

const leadMatchSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lead_type: {
    type: String,
    enum: ['BuyerProfile', 'SellerProfile'],
    required: true,
  },
  lead_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'lead_type'
  },
  match_status: {
    type: String,
    enum: ['new', 'consult_booked', 'showing_booked', 'nurturing', 'converted'],
    default: 'new',
  },
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatConversation',
  }
}, { timestamps: true });

export default mongoose.model('LeadMatch', leadMatchSchema);
