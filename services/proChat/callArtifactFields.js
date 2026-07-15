/**
 * Shared call artifact field helpers — keep API shape identical across services.
 */

function text(value) {
  return String(value || '').trim();
}

export function serializeCallArtifacts(call = {}) {
  const rawError = text(call.transcription_error_message);
  return {
    transcription_policy_version: text(call.transcription_policy_version) || '1',
    transcription_status: text(call.transcription_status) || 'pending',
    transcription_error_code: text(call.transcription_error_code),
    transcription_error_message: rawError
      ? sanitizeArtifactErrorMessage(
          rawError,
          'Notes could not be prepared for this call.',
        )
      : '',
    minutes_status: text(call.minutes_status) || 'not_ready',
  };
}

export function serializeCallArtifactStatus(call = {}) {
  return {
    call_id: text(call._id),
    ...serializeCallArtifacts(call),
  };
}

/** Mongo $set when a started call ends with no consenting participants. */
export function noConsentArtifactSet() {
  return {
    transcription_status: 'disabled',
    transcription_completed_at: null,
    transcription_error_code: 'no_transcription_consent',
    transcription_error_message: 'No participants consented to transcription.',
    minutes_status: 'not_ready',
  };
}

/** Mongo $set when a started call ends with at least one consenting participant. */
export function consentCompletedArtifactSet(now = new Date()) {
  return {
    transcription_status: 'completed',
    transcription_completed_at: now,
    transcription_drain_deadline: null,
    transcription_error_code: '',
    transcription_error_message: '',
    minutes_status: 'pending',
  };
}

export function participantConsentFields(participant = {}) {
  const raw = participant.transcription_consent;
  const consent = raw === true ? true : raw === false ? false : null;
  return {
    transcription_consent: consent,
    transcription_consented_at: participant.transcription_consented_at || null,
    transcription_consent_recorded_at:
      participant.transcription_consent_recorded_at ||
      participant.transcription_consented_at ||
      null,
    transcription_consent_version: text(participant.transcription_consent_version),
  };
}

/** Client-safe minutes/processing errors — never leak provider internals. */
export function sanitizeArtifactErrorMessage(message, fallback = 'Something went wrong while preparing notes.') {
  const value = text(message);
  if (!value) return fallback;
  const lower = value.toLowerCase();
  if (
    lower.includes('api key') ||
    lower.includes('openai') ||
    lower.includes('econn') ||
    lower.includes('socket') ||
    lower.includes('mongo') ||
    lower.includes('stack') ||
    lower.includes('exception')
  ) {
    return fallback;
  }
  return value.length > 180 ? `${value.slice(0, 177)}…` : value;
}
