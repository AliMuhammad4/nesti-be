import mongoose from 'mongoose';

const inviteLinkSchema = new mongoose.Schema(
  {
    inviter_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token_hash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    intended_role: {
      type: String,
      default: '',
    },
    intended_audience: {
      type: String,
      enum: ['professional', 'client', 'any'],
      default: 'any',
    },
    source_channel: {
      type: String,
      default: 'direct',
    },
    source_referral_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Referral',
      default: null,
    },
    source_conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      default: null,
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

inviteLinkSchema.index({ inviter_user_id: 1, createdAt: -1 });
inviteLinkSchema.index({ inviter_user_id: 1, is_active: 1, expires_at: 1 });

export default mongoose.model('InviteLink', inviteLinkSchema);
