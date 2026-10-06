import mongoose from 'mongoose';

const landingChatSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'landing', unique: true },
    enabled: { type: Boolean, default: true },
    welcome_message: { type: String, default: '' },
    display_name: { type: String, default: 'Nesti' },
    consent_line: { type: String, default: '' },
    signup_cta_copy: { type: String, default: '' },
    client_guide: { type: String, default: '' },
    agent_guide: { type: String, default: '' },
    broker_guide: { type: String, default: '' },
    lawyer_guide: { type: String, default: '' },
    auto_welcome_followup: { type: Boolean, default: false },
    dual_write_inquiry: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model('LandingChatSetting', landingChatSettingSchema);
