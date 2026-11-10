import mongoose from 'mongoose';

export const SUPPORT_REQUEST_STATUSES = ['new', 'open', 'in_progress', 'resolved', 'closed'];

const noteSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, maxlength: 4000 },
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } },
);

const replySchema = new mongoose.Schema(
  {
    subject: { type: String, default: '' },
    body: { type: String, required: true, maxlength: 10000 },
    to_email: { type: String, default: '' },
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    provider_message_id: { type: String, default: '' },
    error: { type: String, default: '' },
    author_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'sent_at', updatedAt: false } },
);

/** A support / contact request sent from a professional's web page contact form (not a lead). */
const professionalSupportRequestSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    professional_profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfessionalProfile', default: null },
    public_profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PublicProfile', default: null },
    professional_type: { type: String, default: '' },
    full_name: { type: String, default: '', maxlength: 120 },
    email: { type: String, default: '', maxlength: 200 },
    phone: { type: String, default: '', maxlength: 40 },
    topic_key: { type: String, default: '' },
    topic: { type: String, default: '', maxlength: 200 },
    message: { type: String, default: '', maxlength: 4000 },
    preferred_contact_method: { type: String, default: '' },
    best_time_to_contact: { type: String, default: '' },
    location: { type: String, default: '', maxlength: 400 },
    page_source: { type: String, default: 'contact_page' },
    status: { type: String, enum: SUPPORT_REQUEST_STATUSES, default: 'new', index: true },
    notes: { type: [noteSchema], default: [] },
    replies: { type: [replySchema], default: [] },
    read_at: { type: Date, default: null },
    submission_count: { type: Number, default: 1 },
    last_submitted_at: { type: Date, default: Date.now },
    session_id: { type: String, default: '' },
    visitor_id: { type: String, default: '' },
    referrer: { type: String, default: '' },
    migrated_from_lead_match_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

professionalSupportRequestSchema.index({ user_id: 1, createdAt: -1 });
professionalSupportRequestSchema.index({ user_id: 1, status: 1, createdAt: -1 });
professionalSupportRequestSchema.index(
  { migrated_from_lead_match_id: 1 },
  { unique: true, partialFilterExpression: { migrated_from_lead_match_id: { $type: 'objectId' } } },
);

export default mongoose.model('ProfessionalSupportRequest', professionalSupportRequestSchema);
