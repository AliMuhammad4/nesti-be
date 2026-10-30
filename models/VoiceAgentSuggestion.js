import mongoose from 'mongoose';

const voiceAgentSuggestionSchema = new mongoose.Schema(
  {
    call_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProfessionalCall',
      required: true,
      index: true,
    },
    target_type: { type: String, enum: ['lead', 'client'], required: true },
    target_id: { type: String, required: true, index: true },
    action: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    confidence: { type: Number, default: 0 },
    rationale: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'applied', 'failed'],
      default: 'pending',
      index: true,
    },
    idempotency_key: { type: String, required: true },
    decided_by: { type: String, default: '' },
    decided_at: { type: Date, default: null },
    error_message: { type: String, default: '' },
  },
  { timestamps: true },
);

voiceAgentSuggestionSchema.index({ idempotency_key: 1 }, { unique: true });
voiceAgentSuggestionSchema.index({ call_id: 1, status: 1 });

export default mongoose.model('VoiceAgentSuggestion', voiceAgentSuggestionSchema);
