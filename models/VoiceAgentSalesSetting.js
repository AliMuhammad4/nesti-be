import mongoose from 'mongoose';

const voiceAgentSalesSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'sales', unique: true },
    voice: { type: String, default: 'marin' },
    speech_speed: { type: Number, default: 1 },
    vad_eagerness: { type: String, default: 'medium' },
    barge_in: { type: Boolean, default: true },
    silence_seconds: { type: Number, default: 8 },
    client_services: { type: String, default: '' },
    agent_services: { type: String, default: '' },
    broker_services: { type: String, default: '' },
    lawyer_services: { type: String, default: '' },
    sample_key: { type: String, default: '' },
    clone_voice_id: { type: String, default: '' },
    clone_error: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('VoiceAgentSalesSetting', voiceAgentSalesSettingSchema);
