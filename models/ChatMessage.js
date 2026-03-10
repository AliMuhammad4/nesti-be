import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  conversation_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatConversation',
    required: true,
  },
  sender_type: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  }
}, { timestamps: true });

export default mongoose.model('ChatMessage', chatMessageSchema);
