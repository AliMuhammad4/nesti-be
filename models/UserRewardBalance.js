import mongoose from 'mongoose';

const userRewardBalanceSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    points_balance: {
      type: Number,
      required: true,
      default: 0,
    },
    last_event_at: {
      type: Date,
      default: null,
    },
    tier: {
      type: String,
      enum: ['bronze', 'silver', 'gold', 'platinum', 'elite'],
      default: 'bronze',
      index: true,
    },
    reputation_score: {
      type: Number,
      default: 50,
      min: 0,
      max: 100,
    },
    pending_credit_cents: {
      type: Number,
      default: 0,
      min: 0,
    },
    paid_referral_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    auto_apply_credits: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

export default mongoose.model('UserRewardBalance', userRewardBalanceSchema);
