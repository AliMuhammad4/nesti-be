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
  /**
   * Fine-grained admin capabilities. Fail-closed: empty grants nothing;
   * include '*' (ADMIN_PERMISSION.ALL) for full access.
   */
  admin_permissions: {
    type: [String],
    default: [],
  },
  is_verified: {
    type: Boolean,
    default: false,
  },
  /** Platform admin can suspend accounts; protect rejects inactive users. */
  is_active: {
    type: Boolean,
    default: true,
    index: true,
  },
  suspended_at: {
    type: Date,
    default: null,
  },
  suspended_reason: {
    type: String,
    default: '',
  },
  /** Result of the last suspend/reinstate notice email (sent in the background). */
  account_status_email: {
    kind: { type: String, default: '' },
    status: { type: String, default: '' },
    at: { type: Date, default: null },
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
  /** Wrong reset codes entered for the current code; the code is dropped after the limit. */
  reset_password_attempts: {
    type: Number,
    default: 0,
  },
  /** Wrong reset codes across all codes in the current hour window (account-wide ceiling). */
  reset_window_started_at: {
    type: Date,
    default: null,
  },
  reset_failures_in_window: {
    type: Number,
    default: 0,
  },
  /** Wrong current passwords on Change Password; every session is signed out at the limit. */
  password_change_failures: {
    type: Number,
    default: 0,
  },
  password_change_window_started_at: {
    type: Date,
    default: null,
  },
  /** Wrong passwords in a row (any IP); the login locks briefly at the limit. */
  failed_login_count: {
    type: Number,
    default: 0,
  },
  login_locked_until: {
    type: Date,
    default: null,
  },
  /** Bumped on password reset/change so older session tokens stop working. */
  token_version: {
    type: Number,
    default: 0,
  },
  /** Client signup trial (one per client account; set once at account creation). */
  client_trial_started_at: {
    type: Date,
    default: null,
  },
  client_trial_ends_at: {
    type: Date,
    default: null,
  },
  /** Trial reminder emails already sent (the daily trial job skips these). */
  trial_notices: {
    ending_sent_at: { type: Date, default: null },
    ended_sent_at: { type: Date, default: null },
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
  /** Dashboard cover crop controls. Percent values match CSS object-position. */
  cover_image_position: {
    x: { type: Number, default: 50, min: 0, max: 100 },
    y: { type: Number, default: 50, min: 0, max: 100 },
  },
  cover_image_zoom: {
    type: Number,
    default: 1,
    min: 1,
    max: 3,
  },
}, { timestamps: true });

// One account per mobile number; accounts without a number are not indexed.
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string', $gt: '' } } },
);

userSchema.pre('save', async function () {
  if (!this.password || !this.isModified('password')) {
    return;
  }
  // Pending email signups store a bcrypt hash already; do not hash it twice.
  if (this.$locals?.passwordAlreadyHashed) {
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
