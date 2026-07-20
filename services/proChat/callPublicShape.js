import { participantConsentFields } from './callArtifactFields.js';

export function normalize(value) {
  return String(value || '').trim();
}

export function participantStates(call) {
  const stored = Array.isArray(call?.participant_states) ? call.participant_states : [];
  if (stored.length) {
    return stored.map((participant) => ({
      user_id: normalize(participant.user_id),
      status: participant.status || 'invited',
      invited_at: participant.invited_at || null,
      joined_at: participant.joined_at || null,
      declined_at: participant.declined_at || null,
      left_at: participant.left_at || null,
      ...participantConsentFields(participant),
    }));
  }
  return (call?.participant_ids || []).map((userId) => ({
    user_id: normalize(userId),
    status: normalize(userId) === normalize(call?.caller_id) ? 'joined' : 'invited',
    invited_at: null,
    joined_at: normalize(userId) === normalize(call?.caller_id) ? call?.createdAt || null : null,
    declined_at: null,
    left_at: null,
    transcription_consent: null,
    transcription_consented_at: null,
    transcription_consent_recorded_at: null,
    transcription_consent_version: '',
  }));
}

export function isMultiparty(call) {
  return call?.call_scope === 'multiparty';
}

export function publicCall(call) {
  if (!call) return null;
  return {
    call_id: normalize(call._id),
    room_name: call.room_name,
    thread_id: call.thread_id,
    caller_id: call.caller_id,
    participant_ids: (call.participant_ids || []).map(normalize).filter(Boolean),
    participant_states: participantStates(call),
    call_scope: call.call_scope || 'direct',
    call_type: call.call_type,
    status: call.status,
    transcription_policy_version: call.transcription_policy_version || '1',
    transcription_status: call.transcription_status || 'pending',
    transcription_error_code: call.transcription_error_code || '',
    transcription_error_message: call.transcription_error_message || '',
    minutes_status: call.minutes_status || 'not_ready',
    created_at: call.createdAt,
    invited_at: call.invited_at || null,
    connecting_at: call.connecting_at || null,
    started_at: call.started_at || null,
    ended_at: call.ended_at || null,
    ended_by_id: call.ended_by_id || '',
    expires_at: new Date(call.expires_at).toISOString(),
    cleanup_status: call.cleanup_status,
  };
}
