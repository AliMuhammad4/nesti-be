import mongoose from 'mongoose';

const inviteAttributionSchema = new mongoose.Schema(
  {
    invite_link_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InviteLink',
      required: true,
      index: true,
    },
    token_hash: {
      type: String,
      required: true,
      index: true,
    },
    session_id: {
      type: String,
      default: '',
      index: true,
    },
    visitor_id: {
      type: String,
      default: '',
      index: true,
    },
    fingerprint_hash: {
      type: String,
      default: '',
      index: true,
    },
    source_channel: {
      type: String,
      default: 'direct',
    },
    source_referrer: {
      type: String,
      default: '',
    },
    landing_path: {
      type: String,
      default: '',
    },
    first_clicked_at: {
      type: Date,
      required: true,
      default: Date.now,
    },
    last_clicked_at: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'converted', 'expired'],
      default: 'pending',
      index: true,
    },
    consumed_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    consumed_at: {
      type: Date,
      default: null,
    },
    conversion_context: {
      method: { type: String, default: '' },
      path: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

inviteAttributionSchema.index(
  { token_hash: 1, session_id: 1, visitor_id: 1, fingerprint_hash: 1 },
  { unique: true, sparse: true },
);
inviteAttributionSchema.index({ consumed_by_user_id: 1, createdAt: -1 });

export default mongoose.model('InviteAttribution', inviteAttributionSchema);
