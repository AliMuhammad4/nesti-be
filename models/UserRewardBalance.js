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
  },
  { timestamps: true },
);

export default mongoose.model('UserRewardBalance', userRewardBalanceSchema);
