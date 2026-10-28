import mongoose from 'mongoose';

const leadDocumentSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', default: null },
    session_id: { type: String, default: '', index: true },
    lead_match_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadMatch', default: null },
    original_filename: { type: String, default: 'document' },
    mime_type: { type: String, default: '' },
    bytes: { type: Number, default: 0 },
    kind: { type: String, enum: ['image', 'pdf', 'word'], required: true },
    r2_key: { type: String, required: true },
    status: { type: String, enum: ['uploaded', 'reading', 'ready', 'failed'], default: 'uploaded' },
    extracted_text: { type: String, default: '' },
    text_ready: { type: Boolean, default: false },
    summary: { type: String, default: '' },
    key_facts: { type: [String], default: [] },
    document_type: { type: String, default: '' },
    preview: { type: Boolean, default: false },
  },
  { timestamps: true },
);

leadDocumentSchema.index({ user_id: 1, lead_match_id: 1 });
leadDocumentSchema.index({ conversation_id: 1, createdAt: -1 });

export default mongoose.model('LeadDocument', leadDocumentSchema);
