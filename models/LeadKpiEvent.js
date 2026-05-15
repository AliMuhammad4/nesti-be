import mongoose from 'mongoose';

const leadKpiEventSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lead_match_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadMatch',
      default: null,
      index: true,
    },
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      default: null,
      index: true,
    },
    event_type: {
      type: String,
      required: true,
      index: true,
    },
    grade: { type: String, default: null },
    appointment_status: { type: String, default: null },
    urgency: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    occurred_at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

leadKpiEventSchema.index({ user_id: 1, occurred_at: -1 });
leadKpiEventSchema.index({ user_id: 1, event_type: 1, occurred_at: -1 });

const LeadKpiEvent = mongoose.model('LeadKpiEvent', leadKpiEventSchema, 'lead_kpi_events');

export default LeadKpiEvent;
