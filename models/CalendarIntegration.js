import mongoose from 'mongoose';
import { CALENDAR_PROVIDERS } from '../constants/validationEnums.js';

const calendarIntegrationSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  provider: {
    type: String,
    enum: CALENDAR_PROVIDERS,
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
  calendly_slug: {
    type: String,
  },
  calendly_user_uri: {
    type: String,
  },
  calendly_slug_mismatch: {
    type:    Boolean,
    default: false,
  },
  /** Filled when Calendly webhooks are registered (OAuth callback or manual register). */
  calendly_webhook_url: { type: String },
  calendly_webhook_registered_at: { type: Date },
  calendly_webhook_register_error: { type: String },
  /** "calendly_plan" = plan/trial does not allow webhooks; "other" = technical or unknown. */
  calendly_webhook_error_kind: { type: String },
}, { timestamps: true });

export default mongoose.model('CalendarIntegration', calendarIntegrationSchema);
