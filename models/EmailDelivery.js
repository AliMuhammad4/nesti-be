import mongoose from 'mongoose';

const emailDeliverySchema = new mongoose.Schema({
  idempotency_key: { type: String, required: true },
  recipient: { type: String, required: true },
  subject: { type: String, required: true },
  text_body: { type: String, required: true },
  html_body: { type: String, default: '' },
  source: { type: String, default: '' },
  status: {
    type: String,
    enum: ['sending', 'sent', 'failed', 'uncertain'],
    default: 'sending',
    index: true,
  },
  attempt_count: { type: Number, default: 1 },
  provider_message_id: { type: String, default: '' },
  last_error: { type: String, default: '' },
}, { timestamps: true });

emailDeliverySchema.index({ idempotency_key: 1 }, { unique: true });
emailDeliverySchema.index({ source: 1, status: 1, updatedAt: -1 });

export default mongoose.model('EmailDelivery', emailDeliverySchema);
