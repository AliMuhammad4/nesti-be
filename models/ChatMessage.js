import mongoose from 'mongoose';
import { CHAT_MESSAGE_ROLES, LEAD_GRADES } from '../constants/validationEnums.js';

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
      enum: CHAT_MESSAGE_ROLES,
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
      enum: LEAD_GRADES,
      default: 'unscored',
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Fix #4 — compound index supports paginated transcript queries efficiently
chatMessageSchema.index({ conversation_id: 1, createdAt: 1 });

export default mongoose.model('ChatMessage', chatMessageSchema);
