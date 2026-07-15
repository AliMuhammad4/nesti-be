import mongoose from 'mongoose';

const actionItemSchema = new mongoose.Schema(
  {
    owner: { type: String, default: '' },
    task: { type: String, required: true },
    due_date: { type: String, default: '' },
  },
  { _id: false },
);

const professionalCallMinutesSchema = new mongoose.Schema(
  {
    call_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProfessionalCall',
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'ready', 'failed'],
      required: true,
      default: 'pending',
      index: true,
    },
    summary: { type: String, default: '' },
    topics: { type: [String], default: [] },
    decisions: { type: [String], default: [] },
    action_items: { type: [actionItemSchema], default: [] },
    follow_ups: { type: [String], default: [] },
    model: { type: String, default: '' },
    prompt_version: { type: String, default: '' },
    transcript_segment_count: { type: Number, default: 0 },
    transcript_version_at: { type: Date, default: null },
    transcript_character_count: { type: Number, default: 0 },
    chunk_count: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    lease_owner: { type: String, default: '' },
    lease_until: { type: Date, default: null, index: true },
    next_attempt_at: { type: Date, default: null, index: true },
    last_error: { type: String, default: '' },
    ready_at: { type: Date, default: null },
    delete_at: { type: Date, required: true },
  },
  { timestamps: true },
);

professionalCallMinutesSchema.index({ status: 1, next_attempt_at: 1, lease_until: 1 });
professionalCallMinutesSchema.index({ delete_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('ProfessionalCallMinutes', professionalCallMinutesSchema);
