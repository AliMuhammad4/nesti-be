import mongoose from 'mongoose';

const professionalCallTranscriptSegmentSchema = new mongoose.Schema(
  {
    call_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProfessionalCall',
      required: true,
      index: true,
    },
    segment_id: { type: String, required: true },
    speaker_user_id: { type: String, required: true, index: true },
    speaker_name: { type: String, required: true, default: 'Participant' },
    track_sid: { type: String, required: true, default: '' },
    text: { type: String, required: true },
    language: { type: String, required: true, default: '' },
    start_time_ms: { type: Number, required: true, min: 0 },
    end_time_ms: { type: Number, required: true, min: 0 },
    confidence: { type: Number, default: null },
    provider: { type: String, required: true, default: 'openai' },
    model: { type: String, required: true },
    final: { type: Boolean, required: true, default: true },
    // Matches call/minutes retention so raw speech text does not outlive the call record.
    delete_at: { type: Date, default: null },
  },
  { timestamps: true },
);

professionalCallTranscriptSegmentSchema.index(
  { call_id: 1, segment_id: 1 },
  { unique: true },
);
professionalCallTranscriptSegmentSchema.index({ call_id: 1, start_time_ms: 1, _id: 1 });
professionalCallTranscriptSegmentSchema.index({ delete_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model(
  'ProfessionalCallTranscriptSegment',
  professionalCallTranscriptSegmentSchema,
);
