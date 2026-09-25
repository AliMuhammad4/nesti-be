export const CALL_PROVIDERS = Object.freeze({
  LIVEKIT: 'livekit',
  TWILIO: 'twilio',
});

export const RECORDING_STATUSES = Object.freeze([
  'not_requested',
  'pending',
  'processing',
  'ready',
  'failed',
  'expired',
]);

export function isTwilioCall(call) {
  return String(call?.provider || '') === CALL_PROVIDERS.TWILIO;
}

export function flagEnabled(name, defaultValue = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return defaultValue;
}

export function voiceAgentEnabled() {
  return flagEnabled('VOICE_AGENT_ENABLED', false);
}

export function twilioVoiceEnabled() {
  return flagEnabled('TWILIO_VOICE_ENABLED', false) && voiceAgentEnabled();
}

export function voiceRecordingEnabled() {
  return flagEnabled('VOICE_RECORDING_R2_ENABLED', false) && twilioVoiceEnabled();
}

export function voiceAgentAutocommitEnabled() {
  return flagEnabled('VOICE_AGENT_AUTOCOMMIT', false);
}
