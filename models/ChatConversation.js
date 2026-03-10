import mongoose from 'mongoose';

const chatConversationSchema = new mongoose.Schema({
  session_id: {
    type: String,
    required: true,
    unique: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  visitor_id: {
    type: String,
  },
  intent: {
    type: String,
    enum: ['buyer', 'seller', 'mortgage_financing', 'legal_closing', 'professional', 'general', 'unknown'],
    default: 'unknown',
  },
  lead_classification: {
    type: String,
    enum: ['Hot Buyer', 'Warm Buyer', 'Cold Buyer', 'Hot Seller', 'Warm Seller', 'Cold Seller', 'unclassified'],
    default: 'unclassified',
  },
  lead_score: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  emotional_state: {
    type: String,
  },
  is_automated_booking_enabled: {
    type: Boolean,
    default: false,
  }
}, { timestamps: true });

export default mongoose.model('ChatConversation', chatConversationSchema);
