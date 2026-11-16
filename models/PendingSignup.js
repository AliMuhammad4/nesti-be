import mongoose from 'mongoose';

/**
 * Email signup waiting for its email code. The account is created only after the code
 * is verified. Nothing secret is sent back to the browser: the password is a bcrypt hash
 * and the code is stored as an HMAC.
 */
const pendingSignupSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    first_name: { type: String, required: true },
    last_name: { type: String, required: true },
    phone: { type: String, default: '' },
    role: { type: String, required: true },
    invite_token: { type: String, default: '' },
    session_nonce: { type: String, required: true },
    otp_hash: { type: String, required: true },
    otp_expires_at: { type: Date, required: true },
    otp_attempts: { type: Number, default: 0 },
    /** Wrong codes across every code sent for this email while the record lives. */
    total_attempts: { type: Number, default: 0 },
    resend_count: { type: Number, default: 0 },
    /** Codes sent (signup + resends) in the current hour window, and when that window began. */
    codes_in_window: { type: Number, default: 0 },
    window_started_at: { type: Date, default: null },
    /** Removed by Mongo once this passes. */
    expires_at: { type: Date, required: true },
  },
  { timestamps: true },
);

pendingSignupSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
// Phone checks at signup look up other pending signups by number.
pendingSignupSchema.index({ phone: 1 });

export default mongoose.models.PendingSignup || mongoose.model('PendingSignup', pendingSignupSchema);
