import mongoose from 'mongoose';
import { validateProChatAttachmentLimits } from '../utils/proChatUtils.js';

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    secure_url: { type: String, default: null },
    open_url: { type: String, default: null },
    download_url: { type: String, default: null },
    public_id: { type: String, default: null },
    resource_type: { type: String, default: null }, // image | raw | video | auto
    format: { type: String, default: null },
    bytes: { type: Number, default: null },
    original_filename: { type: String, default: null },
    filename: { type: String, default: null },
    mime_type: { type: String, default: null },
  },
  { _id: false }
);

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
      maxlength: 5000,
      default: '',
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
  },
  { timestamps: true }
);

professionalChatMessageSchema.index({ thread_id: 1, createdAt: -1 });
professionalChatMessageSchema.index({ thread_id: 1, client_id: 1, sender_user_id: 1 });

// NOTE: Keep this hook sync (no `next`) to avoid callback-signature mismatches across mongoose versions.
professionalChatMessageSchema.pre('validate', function () {
  const body = String(this.body || '').trim();
  const atts = Array.isArray(this.attachments) ? this.attachments : [];
  if (!body && atts.length < 1) {
    this.invalidate('body', 'Message must include text or at least one attachment.');
  }
  const attachmentLimit = validateProChatAttachmentLimits(atts);
  if (!attachmentLimit.ok) {
    this.invalidate('attachments', `${attachmentLimit.message}.`);
  }
  for (const a of atts) {
    const url = String(a?.secure_url || a?.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      this.invalidate('attachments', 'Attachment url is invalid.');
      break;
    }
  }
});

export default mongoose.model('ProfessionalChatMessage', professionalChatMessageSchema);

