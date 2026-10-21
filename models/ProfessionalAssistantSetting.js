import mongoose from 'mongoose';
import { ASSISTANT_ROLES } from '../services/professionalAssistant/catalog.js';

const faqSchema = new mongoose.Schema(
  {
    id: { type: String, default: '' },
    question: { type: String, default: '', maxlength: 240 },
    answer: { type: String, default: '', maxlength: 1200 },
    is_default: { type: Boolean, default: false },
    approved: { type: Boolean, default: false },
    source: { type: String, enum: ['manual', 'generated'], default: 'manual' },
  },
  { _id: false },
);

const customToneSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: '' },
    guidance: { type: String, default: '' },
  },
  { _id: false },
);

const professionalAssistantSettingSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    role: { type: String, enum: ASSISTANT_ROLES, required: true },
    applied: { type: Boolean, default: false },
    bot_name: { type: String, default: '', maxlength: 40 },
    display_name: { type: String, default: '', maxlength: 80 },
    bot_persona_title: { type: String, default: '', maxlength: 80 },
    welcome_message: { type: String, default: '', maxlength: 2000 },
    signup_cta_copy: { type: String, default: '', maxlength: 400 },
    consent_line: { type: String, default: '', maxlength: 400 },
    personalities: { type: [String], default: [] },
    custom_tones: { type: [customToneSchema], default: [] },
    languages: { type: [String], default: [] },
    auto_detect_language: { type: Boolean, default: true },
    communication_style: { type: String, default: 'conversational' },
    formality: { type: String, enum: ['formal', 'professional', 'casual'], default: 'professional' },
    use_emojis: { type: Boolean, default: false },
    address_by_first_name: { type: Boolean, default: true },
    suggest_consultation: { type: Boolean, default: true },
    services: { type: [String], default: [] },
    country: { type: String, default: '' },
    region: { type: String, default: '' },
    cities: { type: [String], default: [] },
    neighbourhoods: { type: [String], default: [] },
    virtual_consultations: { type: Boolean, default: false },
    jurisdictions: { type: [String], default: [] },
    differentiators: { type: [String], default: [] },
    custom_expertise: { type: [String], default: [] },
    unique_note: { type: String, default: '' },
    faqs: { type: [faqSchema], default: [] },
    services_pricing: { type: String, default: '' },
    custom_guidance: { type: String, default: '' },
    website_import_url: { type: String, default: '' },
    faq_upload_note: { type: String, default: '' },
    qualification_questions: { type: [String], default: [] },
    next_actions: { type: [String], default: [] },
    hot_guidance: { type: String, default: '' },
    warm_guidance: { type: String, default: '' },
    cold_guidance: { type: String, default: '' },
    voice_accent: { type: String, default: '' },
    transfer_calls: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model('ProfessionalAssistantSetting', professionalAssistantSettingSchema);
