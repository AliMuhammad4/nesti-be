import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      required: true,
      index: true,
    },
    session_id: {
      type: String,
      index: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    agent_type: {
      type: String,
    },
    intent: {
      type: String,
    },
    channel: {
      type: String,
      default: 'web',
    },
    lead_score: {
      type: Number,
      default: 0,
    },
    lead_grade: {
      type: String,
      enum: ['hot', 'warm', 'cold', 'unscored'],
      default: 'unscored',
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model('ChatMessage', chatMessageSchema);
