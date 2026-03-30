import mongoose from 'mongoose';
import {
  PROFESSIONAL_TYPE_VALUES,
  WIDGET_AGENT_TYPE,
  WIDGET_AGENT_TYPE_VALUES,
} from '../constants/roles.js';

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
    /** Denormalized from ChatbotEmbedUrl.widget_role for flow routing without an extra join. */
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
      enum: ['booked', 'canceled'],
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
          status:     { type: String, enum: ['completed', 'failed', 'skipped'], required: true },
          detail:     { type: String },
        },
      ],
      default: [],
    },
    /**
     * Calendly may deliver `invitee.created` more than once; we atomically claim each invitee
     * dedupe key so digest email runs only once per booking.
     */
    post_booking_digest_dedupes: {
      type:    [String],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model('ChatConversation', chatConversationSchema);
