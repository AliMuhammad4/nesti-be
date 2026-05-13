import mongoose from 'mongoose';

const professionalChatMessageSchema = new mongoose.Schema(
  {
    thread_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProfessionalChatThread',
      required: true,
      index: true,
    },
    sender_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Optional client id for dedupe/optimistic UI reconciliation. */
    client_id: {
      type: String,
      default: null,
      index: true,
    },
    body: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 5000,
    },
  },
  { timestamps: true }
);

professionalChatMessageSchema.index({ thread_id: 1, createdAt: -1 });
professionalChatMessageSchema.index({ thread_id: 1, client_id: 1, sender_user_id: 1 });

export default mongoose.model('ProfessionalChatMessage', professionalChatMessageSchema);

