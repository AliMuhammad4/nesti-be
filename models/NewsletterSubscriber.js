import mongoose from 'mongoose';
import crypto from 'crypto';

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    list_name: { type: String, default: 'The Ravinna Report' },
    consent: { type: Boolean, default: true },
    unsubscribe_token: { type: String, required: true, unique: true },
    unsubscribed_at: { type: Date, default: null },
  },
  { timestamps: true },
);

newsletterSubscriberSchema.statics.token = function token() {
  return crypto.randomBytes(24).toString('hex');
};

export default mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema);
