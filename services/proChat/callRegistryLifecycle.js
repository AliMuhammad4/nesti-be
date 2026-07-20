import ProfessionalCall from '../../models/ProfessionalCall.js';
import { normalize, publicCall } from './callPublicShape.js';
import {
  ACTIVE_TTL_MS,
  LIVE_STATUSES,
  PREPARING_TTL_MS,
  RINGING_TTL_MS,
  TERMINAL_RETENTION_MS,
  VIDEO_PREPARING_TTL_MS,
  expireStaleCalls,
  failure,
  isDuplicateKey,
  loadCall,
} from './callRegistryShared.js';

export async function createPendingCall({
  threadId,
  roomName,
  callerId,
  callType,
  participantIds,
  callScope = 'direct',
  transcriptionConsent,
  transcriptionPolicyVersion = process.env.CALL_TRANSCRIPTION_CONSENT_VERSION || '1',
}) {
  const tid = normalize(threadId);
  const room = normalize(roomName);
  const caller = normalize(callerId);
  const participants = [...new Set((participantIds || []).map(normalize).filter(Boolean))];
  const scope = callScope === 'multiparty' ? 'multiparty' : 'direct';
  if (!participants.includes(caller)) {
    return failure('not_a_participant', 'Caller is not a conversation participant.', 403);
  }
  if (typeof transcriptionConsent !== 'boolean') {
    return failure(
      'transcription_consent_choice_required',
      'An explicit transcription consent choice is required before joining the call.',
      400,
    );
  }

  await expireStaleCalls({ threadId: tid, roomName: room });
  const existing = await loadCall(room);
  if (existing) {
    if (existing.thread_id !== tid || existing.caller_id !== caller) {
      return failure('invalid_call_owner', 'This call belongs to another participant.', 403);
    }
    if (existing.call_type !== callType) {
      return failure('call_type_mismatch', 'The call type cannot be changed after starting.');
    }
    if (LIVE_STATUSES.includes(existing.status)) {
      return { ok: true, call: publicCall(existing) };
    }
    return failure('call_ended', 'This call has already ended.', 410);
  }

  try {
    const call = await ProfessionalCall.create({
      room_name: room,
      thread_id: tid,
      active_thread_key: tid,
      caller_id: caller,
      participant_ids: participants,
      participant_states: participants.map((userId) => ({
        user_id: userId,
        status: userId === caller ? 'joined' : 'invited',
        joined_at: userId === caller ? new Date() : null,
        transcription_consent: userId === caller ? transcriptionConsent === true : null,
        transcription_consented_at:
          userId === caller && transcriptionConsent === true ? new Date() : null,
        transcription_consent_recorded_at: userId === caller ? new Date() : null,
        transcription_consent_version:
          userId === caller ? normalize(transcriptionPolicyVersion) || '1' : '',
      })),
      call_scope: scope,
      call_type: callType,
      transcription_policy_version: normalize(transcriptionPolicyVersion) || '1',
      transcription_status: 'pending',
      minutes_status: 'not_ready',
      status: 'preparing',
      expires_at: new Date(
        Date.now() + (callType === 'video' ? VIDEO_PREPARING_TTL_MS : PREPARING_TTL_MS),
      ),
      delete_at: new Date(
        Date.now() +
          (callType === 'video' ? VIDEO_PREPARING_TTL_MS : PREPARING_TTL_MS) +
          TERMINAL_RETENTION_MS,
      ),
    });
    return { ok: true, call: publicCall(call.toObject()) };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const sameRoom = await loadCall(room);
    if (
      sameRoom &&
      sameRoom.thread_id === tid &&
      sameRoom.caller_id === caller &&
      sameRoom.call_type === callType &&
      LIVE_STATUSES.includes(sameRoom.status)
    ) {
      return { ok: true, call: publicCall(sameRoom) };
    }
    return failure('call_in_progress', 'Another call is already active in this conversation.');
  }
}

export async function markCallInvited({
  threadId,
  roomName,
  callerId,
  callType,
  targetUserId,
  currentParticipantIds,
}) {
  const tid = normalize(threadId);
  const room = normalize(roomName);
  const caller = normalize(callerId);
  const target = normalize(targetUserId);
  await expireStaleCalls({ threadId: tid, roomName: room });
  const existing = await loadCall(room);
  if (!existing || existing.thread_id !== tid) {
    return failure('call_not_found', 'This call is no longer available.', 404);
  }
  if (existing.caller_id !== caller) {
    return failure('invalid_call_owner', 'Only the caller can send this invitation.', 403);
  }
  if (callType && existing.call_type !== callType) {
    return failure('call_type_mismatch', 'The call type does not match the active call.');
  }
  if (!['preparing', 'ringing', 'connecting', 'active'].includes(existing.status)) {
    return failure('invalid_call_state', 'This call can no longer be invited.');
  }

  const snapshotIds = (existing.participant_ids || []).map(normalize);
  const currentIds = Array.isArray(currentParticipantIds)
    ? new Set(currentParticipantIds.map(normalize).filter(Boolean))
    : null;
  if (target) {
    if (target === caller) {
      return failure('invalid_reinvite_target', 'The call host cannot invite themself.', 400);
    }
    if (!snapshotIds.includes(target)) {
      return failure('not_in_call_snapshot', 'This user was not a participant when the call started.', 403);
    }
    if (currentIds && !currentIds.has(target)) {
      return failure('not_a_current_member', 'This user is no longer a conversation member.', 403);
    }
  }

  const inviteeIds = (target ? [target] : snapshotIds.filter((id) => id !== caller))
    .filter((id) => !currentIds || currentIds.has(id));
  if (!inviteeIds.length) {
    return failure('no_invitees', 'There are no current call participants to invite.', 409);
  }

  const now = new Date();
  const call = await ProfessionalCall.findOneAndUpdate(
    {
      room_name: room,
      thread_id: tid,
      caller_id: caller,
      status: { $in: LIVE_STATUSES },
      ...(callType ? { call_type: callType } : {}),
    },
    {
      $set: {
        'participant_states.$[participant].status': 'invited',
        'participant_states.$[participant].invited_at': now,
        'participant_states.$[participant].declined_at': null,
        'participant_states.$[participant].left_at': null,
      },
    },
    {
      returnDocument: 'after',
      arrayFilters: [
        {
          'participant.user_id': { $in: inviteeIds },
          'participant.status': { $ne: 'joined' },
        },
      ],
    },
  ).lean();
  if (!call) return failure('invalid_call_state', 'This call can no longer be invited.');
  const ringingExpiry = new Date(now.getTime() + RINGING_TTL_MS);
  const activeExpiry = new Date(now.getTime() + ACTIVE_TTL_MS);
  await ProfessionalCall.findOneAndUpdate(
    { room_name: room, thread_id: tid, status: 'preparing' },
    {
      $set: {
        status: 'ringing',
        invited_at: now,
        expires_at: ringingExpiry,
        delete_at: new Date(ringingExpiry.getTime() + TERMINAL_RETENTION_MS),
      },
    },
    { returnDocument: 'after' },
  ).lean();
  await ProfessionalCall.findOneAndUpdate(
    { room_name: room, thread_id: tid, status: 'ringing' },
    {
      $set: {
        invited_at: call.invited_at || now,
        expires_at: ringingExpiry,
        delete_at: new Date(ringingExpiry.getTime() + TERMINAL_RETENTION_MS),
      },
    },
    { returnDocument: 'after' },
  ).lean();
  await ProfessionalCall.findOneAndUpdate(
    { room_name: room, thread_id: tid, status: 'active' },
    {
      $set: {
        expires_at: activeExpiry,
        delete_at: new Date(activeExpiry.getTime() + TERMINAL_RETENTION_MS),
      },
    },
    { returnDocument: 'after' },
  ).lean();
  const current = await loadCall(room);
  if (!current || !LIVE_STATUSES.includes(current.status)) {
    return failure('call_ended', 'This call ended before the invitation was sent.', 410);
  }
  return {
    ok: true,
    call: publicCall(current),
    invitee_ids: inviteeIds,
    targeted: Boolean(target),
  };
}
