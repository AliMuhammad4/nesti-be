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
}, { timestamps: true });

export default mongoose.model('CalendarIntegration', calendarIntegrationSchema);
