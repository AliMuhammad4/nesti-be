import mongoose from 'mongoose';

const WORKSPACE_APPOINTMENT_STATUSES = ['booked', 'canceled'];

const workspaceAppointmentSchema = new mongoose.Schema(
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
    lead_profile_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadProfile',
      default: null,
      index: true,
    },
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      default: null,
    },
    status: {
      type: String,
      enum: WORKSPACE_APPOINTMENT_STATUSES,
      default: 'booked',
      index: true,
    },
    source: {
      type: String,
      default: 'calendly',
    },
    booked_via_nurture: {
      type: Boolean,
      default: false,
    },
    invitee_email: {
      type: String,
      default: null,
    },
    /** Calendly-scheduled event start when known. */
    scheduled_start: {
      type: Date,
      default: null,
    },
    /** When Nesti recorded the booking (display fallback). */
    recorded_at: {
      type: Date,
      default: Date.now,
    },
    canceled_at: {
      type: Date,
      default: null,
    },
    calendly_invitee_uri: {
      type: String,
      default: null,
    },
    calendly_event_uri: {
      type: String,
      default: null,
    },
    nurture_log_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NurtureLog',
      default: null,
    },
  },
  { timestamps: true },
);

workspaceAppointmentSchema.index({ user_id: 1, status: 1, scheduled_start: -1, recorded_at: -1 });
workspaceAppointmentSchema.index({ calendly_invitee_uri: 1 }, { unique: true, sparse: true });
workspaceAppointmentSchema.index({ user_id: 1, lead_match_id: 1, status: 1 });

export default mongoose.model('WorkspaceAppointment', workspaceAppointmentSchema);
