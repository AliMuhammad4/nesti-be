import mongoose from 'mongoose';
const professionalNotificationSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    notification_type: {
      type: String,
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    severity: {
      type: String,
      enum: ['info', 'high', 'critical'],
      default: 'info',
    },
    read_at: { type: Date, default: null, index: true },
    action: { type: mongoose.Schema.Types.Mixed, default: null },
    lead_match_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadMatch', default: null },
    lead_profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadProfile', default: null },
    conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', default: null },
    session_id: { type: String, default: null },
    grade: { type: String, default: null },
    score: { type: Number, default: null },
    intent: { type: String, default: null },
    appointment_status: { type: String, default: null },
    urgency: { type: String, default: null },
    urgency_window: { type: String, default: null },
    speed_to_lead_tip: { type: String, default: null },
    outcomes_headline: { type: String, default: null },
    booking_cta: { type: String, default: null },
    primary_next_action: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

professionalNotificationSchema.index({ user_id: 1, created_at: -1 });

const ProfessionalNotification = mongoose.model(
  'ProfessionalNotification',
  professionalNotificationSchema,
  'notifications'
);

export default ProfessionalNotification;
