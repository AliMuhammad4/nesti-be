import mongoose from 'mongoose';

const JOB_TTL_DAYS = 7;

const bulkNurtureJobItemSchema = new mongoose.Schema(
  {
    lead_profile_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadProfile',
      default: null,
      index: true,
    },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    selected_default: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'queued', 'generating', 'ready', 'sending', 'sent', 'skipped', 'error'],
      default: 'pending',
      index: true,
    },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    previewHtml: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  { _id: false },
);

const bulkNurtureJobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['bulk_nurture_draft', 'bulk_nurture_send'],
      required: true,
      index: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'paused', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    progress: {
      total: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      ready: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    filter: {
      icp_tier: { type: String, default: '' },
    },
    source_job_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BulkNurtureJob',
      default: null,
      index: true,
    },
    items: {
      type: [bulkNurtureJobItemSchema],
      default: [],
    },
    error: { type: String, default: '' },
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + JOB_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true },
);

bulkNurtureJobSchema.index({ user_id: 1, type: 1, updatedAt: -1 });
bulkNurtureJobSchema.index({ user_id: 1, status: 1, updatedAt: -1 });
bulkNurtureJobSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('BulkNurtureJob', bulkNurtureJobSchema);
