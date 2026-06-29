import mongoose from 'mongoose';

const clientProfileSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    annual_income: {
      type: Number,
      default: null,
    },
    employment_status: {
      type: String,
      enum: ['full_time', 'part_time', 'self_employed', 'contract', 'unemployed', 'student', 'retired', 'other', ''],
      default: '',
    },
    current_savings: {
      type: Number,
      default: null,
    },
    monthly_savings: {
      type: Number,
      default: null,
    },
    dream_home_price: {
      type: Number,
      default: null,
    },
    purchase_timeline: {
      type: String,
      enum: ['1_year', '2_years', '3_years', '5_years', 'exploring'],
      default: null,
    },
    preferred_location: {
      type: String,
      trim: true,
      default: '',
    },
    down_payment_goal: {
      type: Number,
      default: null,
    },
    homeownership_progress_score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    months_to_goal: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

clientProfileSchema.index({ user_id: 1 });

export default mongoose.model('ClientProfile', clientProfileSchema);
