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
  },
  { timestamps: true },
);

export default mongoose.model('UserRewardBalance', userRewardBalanceSchema);
