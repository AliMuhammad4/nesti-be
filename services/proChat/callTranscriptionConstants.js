/**
 * LiveKit agent identity for call transcription.
 * Dev and production MUST use different agent names when they share the same
 * LiveKit project — otherwise a local `npm run dev` worker steals production
 * jobs and fails with "call was not found" (wrong Mongo).
 */

const DEFAULT_PRODUCTION_AGENT_NAME = 'nesti-call-transcriber';
const DEFAULT_DEV_AGENT_NAME = 'nesti-call-transcriber-dev';

export function resolveTranscriptionAgentName(env = process.env) {
  const override = String(env.CALL_TRANSCRIPTION_AGENT_NAME || '').trim();
  if (override) return override;
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') return DEFAULT_PRODUCTION_AGENT_NAME;
  return DEFAULT_DEV_AGENT_NAME;
}

/** Resolved once at module load from the current process env. */
export const TRANSCRIPTION_AGENT_NAME = resolveTranscriptionAgentName();
export const TRANSCRIPTION_AGENT_DISPLAY_NAME = 'Nesti Minutes';
export const TRANSCRIPTION_AGENT_IDENTITY = 'nesti-notetaker';
export const DEFAULT_TRANSCRIPTION_WORKER_PORT = 8081;
