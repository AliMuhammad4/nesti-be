import mongoose from 'mongoose';

const callParticipantSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true },
    status: {
      type: String,
      enum: ['invited', 'joined', 'declined', 'left'],
      required: true,
      default: 'invited',
    },
    invited_at: { type: Date, default: null },
    joined_at: { type: Date, default: null },
    declined_at: { type: Date, default: null },
    left_at: { type: Date, default: null },
    // null = choice not recorded yet; true/false = explicit choice.
    transcription_consent: { type: Boolean, default: null },
    transcription_consented_at: { type: Date, default: null },
    transcription_consent_recorded_at: { type: Date, default: null },
    transcription_consent_version: { type: String, default: '' },
  },
  { _id: false },
);

const professionalCallSchema = new mongoose.Schema(
  {
    room_name: { type: String, required: true, unique: true, index: true },
    thread_id: { type: String, required: true, index: true },
    // Present only while this call owns the thread. The unique index is the
    // cross-process mutex that permits at most one live call per thread.
    active_thread_key: { type: String },
    caller_id: { type: String, required: true },
    participant_ids: { type: [String], required: true },
    participant_states: { type: [callParticipantSchema], default: [] },
    call_scope: {
      type: String,
      enum: ['direct', 'multiparty'],
      required: true,
      default: 'direct',
    },
    call_type: { type: String, enum: ['voice', 'video'], required: true },
    transcription_policy_version: { type: String, required: true, default: '1' },
    transcription_status: {
      type: String,
      enum: ['pending', 'dispatching', 'active', 'completed', 'failed', 'disabled'],
      default: 'pending',
      index: true,
    },
    transcription_dispatch_id: { type: String, default: '' },
    transcription_dispatch_generation: { type: String, default: '' },
    transcription_dispatched_at: { type: Date, default: null },
    transcription_started_at: { type: Date, default: null },
    transcription_completed_at: { type: Date, default: null },
    transcription_drain_deadline: { type: Date, default: null, index: true },
    transcript_segment_count: { type: Number, default: 0 },
    transcript_updated_at: { type: Date, default: null },
    transcription_failed_at: { type: Date, default: null },
    transcription_error_code: { type: String, default: '' },
    transcription_error_message: { type: String, default: '' },
    minutes_status: {
      type: String,
      enum: ['not_ready', 'pending', 'processing', 'ready', 'failed'],
      default: 'not_ready',
      index: true,
    },
    status: {
      type: String,
      enum: ['preparing', 'ringing', 'connecting', 'active', 'declined', 'ended', 'expired'],
      required: true,
      index: true,
    },
    invited_at: { type: Date, default: null },
    connecting_at: { type: Date, default: null },
    started_at: { type: Date, default: null },
    ended_at: { type: Date, default: null, index: true },
    ended_by_id: { type: String, default: '' },
    expires_at: { type: Date, required: true, index: true },
    delete_at: { type: Date, required: true },
    cleanup_status: {
      type: String,
      enum: ['not_needed', 'pending', 'in_progress', 'completed'],
      default: 'not_needed',
      index: true,
    },
    cleanup_attempts: { type: Number, default: 0 },
    cleanup_next_attempt_at: { type: Date, default: null, index: true },
    cleanup_final_after: { type: Date, default: null },
    cleanup_lease_until: { type: Date, default: null },
    cleanup_last_error: { type: String, default: '' },
  },
  { timestamps: true },
);

professionalCallSchema.index(
  { active_thread_key: 1 },
  {
    unique: true,
    partialFilterExpression: { active_thread_key: { $type: 'string' } },
  },
);
professionalCallSchema.index({ delete_at: 1 }, { expireAfterSeconds: 0 });
professionalCallSchema.index({ cleanup_status: 1, cleanup_next_attempt_at: 1 });
professionalCallSchema.index({ participant_ids: 1, createdAt: -1 });
professionalCallSchema.index({ status: 1, minutes_status: 1, ended_at: 1 });

export default mongoose.model('ProfessionalCall', professionalCallSchema);
