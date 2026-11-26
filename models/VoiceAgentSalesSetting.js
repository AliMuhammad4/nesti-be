import mongoose from 'mongoose';

const voiceAgentSalesSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'sales', unique: true },
    voice: { type: String, default: 'marin' },
    speech_speed: { type: Number, default: 1 },
    vad_eagerness: { type: String, default: 'medium' },
    barge_in: { type: Boolean, default: true },
    silence_seconds: { type: Number, default: 12 },
    // "auto": Ravi answers in the caller's language; "english": English only.
    language_mode: { type: String, default: 'auto' },
    voice_engine: { type: String, default: 'pipeline' },
    stt_model: { type: String, default: 'openai/gpt-4o-mini-transcribe' },
    tts_model: { type: String, default: 'eleven_flash_v2_5' },
    tts_voice: { type: String, default: '' },
    client_services: { type: String, default: '' },
    agent_services: { type: String, default: '' },
    broker_services: { type: String, default: '' },
    lawyer_services: { type: String, default: '' },
    client_questions: { type: mongoose.Schema.Types.Mixed, default: undefined },
    agent_questions: { type: mongoose.Schema.Types.Mixed, default: undefined },
    broker_questions: { type: mongoose.Schema.Types.Mixed, default: undefined },
    lawyer_questions: { type: mongoose.Schema.Types.Mixed, default: undefined },
    sample_key: { type: String, default: '' },
    clone_voice_id: { type: String, default: '' },
    clone_error: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('VoiceAgentSalesSetting', voiceAgentSalesSettingSchema);
