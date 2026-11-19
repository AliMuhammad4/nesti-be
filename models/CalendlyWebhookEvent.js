import mongoose from 'mongoose';

/**
 * Durable inbox for Calendly webhook deliveries: stored before Calendly gets its 200,
 * processed by in-process workers, retried with backoff after failures or restarts.
 */
const calendlyWebhookEventSchema = new mongoose.Schema({
  /** sha256 of event|invitee|event uri|created_at|email: the same delivery is stored once. */
  dedupe_key:      { type: String, required: true, unique: true },
  event:           { type: String, default: null },
  /** Raw JSON body exactly as Calendly sent it. */
  raw_body:        { type: String, required: true },
  status:          { type: String, enum: ['pending', 'processing', 'done', 'failed', 'dead'], default: 'pending', index: true },
  attempts:        { type: Number, default: 0 },
  next_attempt_at: { type: Date, default: () => new Date(), index: true },
  locked_at:       { type: Date, default: null },
  last_error:      { type: String, default: null },
  processed_at:    { type: Date, default: null },
  result_reason:   { type: String, default: null },
}, { timestamps: true });

// Keep a 30-day trail; duplicates within that window are still recognised.
calendlyWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.models.CalendlyWebhookEvent
  || mongoose.model('CalendlyWebhookEvent', calendlyWebhookEventSchema);
