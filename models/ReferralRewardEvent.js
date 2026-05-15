import mongoose from 'mongoose';

const referralRewardEventSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    event_type: {
      type: String,
      required: true,
      index: true,
    },
    points_delta: {
      type: Number,
      required: true,
    },
    idempotency_key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    source_model: {
      type: String,
      default: '',
    },
    source_id: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    occurred_at: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true },
);

referralRewardEventSchema.index({ user_id: 1, occurred_at: -1 });

export default mongoose.model('ReferralRewardEvent', referralRewardEventSchema);
