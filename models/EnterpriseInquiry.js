import mongoose from 'mongoose';
import crypto from 'crypto';
import { ENTERPRISE_INQUIRY_STATUSES } from '../constants/validationEnums.js';

const enterpriseInquirySchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  email: { type: String, default: '', index: true },
  phone: { type: String, default: '' },
  preferred_contact: { type: String, enum: ['', 'email', 'phone', 'either'], default: '' },
  full_name: { type: String, default: '' },
  interest_role: { type: String, default: '' },
  source: { type: String, enum: ['demo', 'contact', 'landing_chat', 'direct_inquiry', ''], default: '' },
  city: { type: String, default: '' },
  country: { type: String, default: '' },
  inquiry_topic: { type: String, enum: ['', 'demo', 'inquiry', 'support'], default: '' },
  company_name: {
    type: String,
    required: true,
  },
  team_size: {
    type: Number,
  },
  message: {
    type: String,
  },
  status: {
    type: String,
    enum: ENTERPRISE_INQUIRY_STATUSES,
    default: 'pending',
  },
  pipeline_stage: {
    type: String,
    enum: ['', 'new', 'calling', 'ready'],
    default: '',
  },
  voice_outcome: {
    type: String,
    enum: ['', 'interested', 'callback', 'declined', 'plan_recommended'],
    default: '',
  },
  voice_outcome_plan: { type: String, default: '' },
  voice_outcome_note: { type: String, default: '' },
  voice_outcome_at: { type: Date, default: null },
  session_id: { type: String, default: '', index: true },
  lead_score: { type: Number, default: 0 },
  lead_grade: { type: String, default: '' },
  chat_state: {
    pain_point: { type: String, default: '' },
    feature: { type: String, default: '' },
    features_explained: { type: [String], default: [] },
    questions_asked: { type: [String], default: [] },
    turns: { type: Number, default: 0 },
  },
  chat_events: {
    type: [{
      type: { type: String, default: '' },
      detail: { type: String, default: '' },
      at: { type: Date, default: Date.now },
    }],
    default: [],
  },
  transcript: {
    type: [{
      role: { type: String, enum: ['user', 'assistant'], required: true },
      text: { type: String, default: '' },
      at: { type: Date, default: Date.now },
    }],
    default: [],
  },
  insights: {
    summary: { type: String, default: '' },
    services: { type: [String], default: [] },
    plan_fit: { type: String, default: '' },
    next_step: { type: String, default: '' },
    generated_at: { type: Date, default: null },
  },
  close_outcome: { type: String, enum: ['', 'won', 'lost'], default: '' },
  close_note: { type: String, default: '' },
  closed_at: { type: Date, default: null },
  reopen_count: { type: Number, default: 0 },
  reopened_at: { type: Date, default: null },
  follow_up_pending: { type: Boolean, default: false },
  email_draft: {
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    origin: { type: String, enum: ['', 'auto', 'manual'], default: '' },
    updated_at: { type: Date, default: null },
  },
  guide_emails: {
    type: [{
      to_email: { type: String, default: '' },
      subject: { type: String, default: '' },
      body: { type: String, default: '' },
      type: { type: String, enum: ['automatic', 'manual'], default: 'manual' },
      status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sent' },
      idempotency_key: { type: String, default: () => crypto.randomUUID() },
      sent_at: { type: Date, default: Date.now },
    }],
    default: [],
  },
}, { timestamps: true });

enterpriseInquirySchema.index({ source: 1, close_outcome: 1, createdAt: -1 });
enterpriseInquirySchema.index({ source: 1, createdAt: -1 });

export default mongoose.model('EnterpriseInquiry', enterpriseInquirySchema);
