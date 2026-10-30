import mongoose from 'mongoose';

const landingChatSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'landing', unique: true },
    enabled: { type: Boolean, default: true },
    welcome_message: { type: String, default: '' },
    bot_name: { type: String, default: 'Ravi' },
    display_name: { type: String, default: 'Nesti' },
    bot_persona_title: { type: String, default: '24/7 Real Estate Copilot' },
    personality: {
      type: String,
      enum: ['friendly', 'executive', 'luxury', 'sales', 'caring', 'consultative'],
      default: 'friendly',
    },
    formality: {
      type: String,
      enum: ['formal', 'professional', 'casual'],
      default: 'professional',
    },
    consent_line: { type: String, default: '' },
    signup_cta_copy: { type: String, default: '' },
    client_guide: { type: String, default: '' },
    agent_guide: { type: String, default: '' },
    broker_guide: { type: String, default: '' },
    lawyer_guide: { type: String, default: '' },
    role_customizations: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    previous_settings: { type: mongoose.Schema.Types.Mixed, default: null },
    auto_welcome_followup: { type: Boolean, default: false },
    dual_write_inquiry: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model('LandingChatSetting', landingChatSettingSchema);
