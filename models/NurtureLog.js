import mongoose from 'mongoose';

const nurtureLogSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatConversation',
    required: true,
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
    enum: ['sent', 'failed'],
    default: 'sent',
  }
}, { timestamps: true });

export default mongoose.model('NurtureLog', nurtureLogSchema);
