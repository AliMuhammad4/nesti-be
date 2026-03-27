import mongoose from 'mongoose';

const calendarIntegrationSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  provider: {
    type: String,
    enum: ['google', 'calendly'],
    required: true,
  },
  access_token: {
    type: String,
    required: true,
  },
  refresh_token: {
    type: String,
  },
  expires_at: {
    type: Date,
  },
  account_email: {
    type: String,
  },
  /** Lowercase Calendly scheduling slug from GET /users/me (OAuth account). */
  calendly_slug: {
    type: String,
  },
  /** True when professionalProfile.calendly_link points at a different slug — webhooks will not match bookings. */
  calendly_slug_mismatch: {
    type:    Boolean,
    default: false,
  },
}, { timestamps: true });

export default mongoose.model('CalendarIntegration', calendarIntegrationSchema);
