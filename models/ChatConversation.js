import mongoose from 'mongoose';
import {
  PROFESSIONAL_TYPE_VALUES,
  WIDGET_AGENT_TYPE,
  WIDGET_AGENT_TYPE_VALUES,
} from '../constants/roles.js';
import {
  CALENDLY_BOOKING_STATUSES,
  CHAT_INTENTS,
  LEAD_CLASSIFICATIONS,
  LEAD_GRADES,
  POST_BOOKING_RUN_STATUSES,
} from '../constants/validationEnums.js';

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
    embed_flow_role: {
      type: String,
      enum: PROFESSIONAL_TYPE_VALUES,
    },
    agent_type: {
      type: String,
      enum: WIDGET_AGENT_TYPE_VALUES,
      default: WIDGET_AGENT_TYPE.AGENT,
    },
    channel: {
      type: String,
      default: 'web',
    },
    intent: {
      type: String,
      enum: CHAT_INTENTS,
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
      enum: LEAD_GRADES,
      default: 'unscored',
    },
    lead_classification: {
      type: String,
      enum: LEAD_CLASSIFICATIONS,
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
      default: true,
    },
    last_interaction_at: {
      type: Date,
      default: Date.now,
    },
    form_data: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    /** Set by POST /api/webhooks/calendly when invitee books or cancels (see calendlyWebhookService). */
    calendly_booking_status: {
      type: String,
      enum: CALENDLY_BOOKING_STATUSES,
    },
    calendly_booking_at: {
      type: Date,
    },
    /** Idempotent post–Calendly-booking jobs (see postBookingAutomations.js). */
    post_booking_automation_runs: {
      type: [
        {
          key:        { type: String, required: true },
          dedupe_key: { type: String, required: true },
          ran_at:     { type: Date, default: Date.now },
          status:     { type: String, enum: POST_BOOKING_RUN_STATUSES, required: true },
          detail:     { type: String },
        },
      ],
      default: [],
    },
    post_booking_digest_dedupes: {
      type:    [String],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model('ChatConversation', chatConversationSchema);
