import mongoose from 'mongoose';

const adminAuditLogSchema = new mongoose.Schema(
  {
    actor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Professional (or other) user the admin was acting on behalf of, when applicable. */
    on_behalf_of_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    action: {
      type: String,
      required: true,
      maxlength: 120,
      index: true,
    },
    target_type: {
      type: String,
      default: '',
      maxlength: 80,
      index: true,
    },
    target_id: {
      type: String,
      default: '',
      maxlength: 80,
      index: true,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    outcome: {
      type: String,
      enum: ['ok', 'error'],
      default: 'ok',
      index: true,
    },
    error_message: {
      type: String,
      default: '',
      maxlength: 2000,
    },
  },
  { timestamps: true },
);

adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ actor_user_id: 1, createdAt: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1 });

export default mongoose.model('AdminAuditLog', adminAuditLogSchema);
