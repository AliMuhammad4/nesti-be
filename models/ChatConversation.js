import mongoose from 'mongoose';

const chatConversationSchema = new mongoose.Schema(
  {
    session_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    visitor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Visitor',
    },
    embed_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatbotEmbedUrl',
    },
    embed_token: {
      type: String,
    },
    agent_type: {
      type: String,
      enum: ['agent', 'broker', 'lawyer'],
      default: 'agent',
    },
    channel: {
      type: String,
      default: 'web',
    },
    intent: {
      type: String,
      enum: ['buy', 'sell'],
      default: 'buy',
    },
    lead_score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    lead_grade: {
      type: String,
      enum: ['hot', 'warm', 'cold', 'unscored'],
      default: 'unscored',
    },
    lead_classification: {
      type: String,
      enum: [
        'Hot Buyer', 'Warm Buyer', 'Cold Buyer',
        'Hot Seller', 'Warm Seller', 'Cold Seller',
        'Hot Lead', 'Warm Lead', 'Cold Lead',
        'Hot Mortgage Lead', 'Warm Mortgage Lead', 'Cold Mortgage Lead',
        'Hot Lawyer Lead', 'Warm Lawyer Lead', 'Cold Lawyer Lead',
        'unclassified',
      ],
      default: 'unclassified',
    },
    lead_reasons: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    is_qualified: {
      type: Boolean,
      default: false,
    },
    emotional_state: {
      type: String,
      default: 'neutral',
    },
    is_automated_booking_enabled: {
      type: Boolean,
      default: false,
    },
    last_interaction_at: {
      type: Date,
      default: Date.now,
    },
    form_data: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('ChatConversation', chatConversationSchema);
