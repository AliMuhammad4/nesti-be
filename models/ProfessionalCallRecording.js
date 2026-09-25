import mongoose from 'mongoose';

const professionalCallRecordingSchema = new mongoose.Schema(
  {
    call_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProfessionalCall',
      required: true,
      index: true,
    },
    recording_sid: { type: String, required: true },
    call_sid: { type: String, default: '', index: true },
    source_url: { type: String, default: '' },
    duration_seconds: { type: Number, default: 0 },
    channels: { type: Number, default: 1 },
    codec: { type: String, default: '' },
    mime_type: { type: String, default: 'audio/mpeg' },
    r2_key: { type: String, default: '' },
    checksum_sha256: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    ingest_status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed', 'dead'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    retry_count: { type: Number, default: 0 },
    lease_owner: { type: String, default: '' },
    lease_until: { type: Date, default: null, index: true },
    next_attempt_at: { type: Date, default: null, index: true },
    last_error: { type: String, default: '' },
    legal_hold: { type: Boolean, default: false },
    deleted_at: { type: Date, default: null },
    purged_at: { type: Date, default: null },
    delete_at: { type: Date, default: null },
    idempotency_key: { type: String, required: true },
  },
  { timestamps: true },
);

professionalCallRecordingSchema.index({ recording_sid: 1 }, { unique: true });
professionalCallRecordingSchema.index({ idempotency_key: 1 }, { unique: true });
professionalCallRecordingSchema.index({ ingest_status: 1, next_attempt_at: 1, lease_until: 1 });
professionalCallRecordingSchema.index({ delete_at: 1, legal_hold: 1 });

export default mongoose.model('ProfessionalCallRecording', professionalCallRecordingSchema);
