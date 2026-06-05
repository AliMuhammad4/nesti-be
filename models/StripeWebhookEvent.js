import mongoose from 'mongoose';

const stripeWebhookEventSchema = new mongoose.Schema(
  {
    event_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    event_type: {
      type: String,
      default: '',
      index: true,
    },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      default: 'processing',
      index: true,
    },
    error: {
      type: String,
      default: '',
    },
  },
  { timestamps: true },
);

stripeWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.model('StripeWebhookEvent', stripeWebhookEventSchema);
