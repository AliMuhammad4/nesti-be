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
      enum: ['full_time', 'self_employed', 'contract', 'new_job', 'unemployed', 'part_time', 'student', 'retired', 'other', ''],
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
    home_goal: {
      type: String,
      trim: true,
      default: '',
    },
    home_goals: [
      {
        type: String,
        trim: true,
      },
    ],
    preferred_locations: [
      {
        type: String,
        trim: true,
      },
    ],
    purchase_timeline: {
      type: String,
      enum: ['asap', '1-3 months', '3-6 months', '6-12 months', 'browsing', '1_year', '2_years', '3_years', '5_years', 'exploring'],
      default: null,
    },
    preferred_location: {
      type: String,
      trim: true,
      default: '',
    },
    mortgage_status: {
      type: String,
      trim: true,
      default: '',
    },
    realtor_status: {
      type: String,
      trim: true,
      default: '',
    },
    viewing_readiness: {
      type: String,
      trim: true,
      default: '',
    },
    offer_readiness: {
      type: String,
      trim: true,
      default: '',
    },
    motivation_reason: {
      type: String,
      trim: true,
      default: '',
    },
    living_situation: {
      type: String,
      trim: true,
      default: '',
    },
    purchase_purpose: {
      type: String,
      trim: true,
      default: '',
    },
    preferred_contact_method: {
      type: String,
      trim: true,
      default: '',
    },
    best_time_to_contact: {
      type: String,
      trim: true,
      default: '',
    },
    working_styles: [
      {
        type: String,
        trim: true,
      },
    ],
    priority_tags: [
      {
        type: String,
        trim: true,
      },
    ],
    languages: [
      {
        type: String,
        trim: true,
      },
    ],
    preferred_experience: {
      type: String,
      trim: true,
      default: '',
    },
    comfort_preferences: [
      {
        type: String,
        trim: true,
      },
    ],
    onboarding_autosaved_at: {
      type: Date,
      default: null,
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

export default mongoose.model('ClientProfile', clientProfileSchema);
