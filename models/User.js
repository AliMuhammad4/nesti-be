import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  first_name: {
    type: String,
    required: true,
  },
  last_name: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['agent', 'lawyer', 'mortgage_broker', 'admin'],
    default: 'agent',
  },
  is_verified: {
    type: Boolean,
    default: false,
  },
  otp: {
    type: String,
  },
  otp_expires_at: {
    type: Date,
  },
  account_status: {
    type: String,
    enum: ['free_trial', 'active', 'expired', 'canceled'],
    default: 'free_trial',
  },
  subscription_tier: {
    type: String,
    enum: ['starter', 'pro', 'enterprise'],
    default: 'starter',
  },
  trial_ends_at: {
    type: Date,
  },
  stripe_customer_id: {
    type: String,
  },
  stripe_subscription_id: {
    type: String,
  },
  reset_password_token: {
    type: String,
  },
  reset_password_expires: {
    type: Date,
  }
}, { timestamps: true });

// Password hashing middleware
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model('User', userSchema);
