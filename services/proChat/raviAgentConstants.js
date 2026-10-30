const DEFAULT_PRODUCTION_AGENT_NAME = 'nesti-ravi-sales';
const DEFAULT_DEV_AGENT_NAME = 'nesti-ravi-sales-dev';

export function resolveRaviAgentName(env = process.env) {
  const override = String(env.RAVI_AGENT_NAME || '').trim();
  if (override) return override;
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') return DEFAULT_PRODUCTION_AGENT_NAME;
  return DEFAULT_DEV_AGENT_NAME;
}

export const RAVI_AGENT_NAME = resolveRaviAgentName();
export const RAVI_AGENT_DISPLAY_NAME = 'Ravi';
export const RAVI_AGENT_IDENTITY = 'nesti-ravi';
export const DEFAULT_RAVI_WORKER_PORT = 8082;

export function voiceRoomMinHumans(call) {
  if (call?.voice_target_type) return 1;
  return call?.call_scope === 'multiparty' ? 1 : 2;
}

export function canReactivateVoiceCall(status) {
  return !['ended', 'expired', 'declined'].includes(String(status || ''));
}
