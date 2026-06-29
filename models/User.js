import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { USER_ROLE, USER_ROLE_VALUES } from '../constants/roles.js';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: false,
  },
  auth_provider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local',
  },
  google_id: {
    type: String,
    default: null,
    index: true,
    sparse: true,
  },
  first_name: {
    type: String,
    required: true,
  },
  last_name: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    default: '',
  },
  role: {
    type: String,
    enum: USER_ROLE_VALUES,
    default: USER_ROLE.AGENT,
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
  reset_password_token: {
    type: String,
  },
  reset_password_expires: {
    type: Date,
  },
  /** Public HTTPS URL (e.g. Cloudinary) for avatar in app shell / dashboard. */
  profile_image: {
    type: String,
    default: null,
  },
  /** Public HTTPS URL for dashboard / marketing cover background. */
  cover_image: {
    type: String,
    default: null,
  },
}, { timestamps: true });
userSchema.pre('save', async function () {
  if (!this.password || !this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};
export default mongoose.model('User', userSchema);
