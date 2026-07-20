import ProfessionalCall from '../../models/ProfessionalCall.js';
import { isMultiparty, normalize, publicCall } from './callPublicShape.js';
import {
  LIVE_STATUSES,
  TERMINAL_RETENTION_MS,
  TOKEN_REJOIN_GUARD_MS,
  expireStaleCalls,
  failure,
  finalizeArtifactState,
  loadCall,
} from './callRegistryShared.js';

async function updateMultipartyParticipant({ threadId, roomName, userId, state }) {
  const tid = normalize(threadId);
  const room = normalize(roomName);
  const uid = normalize(userId);
  await expireStaleCalls({ threadId: tid, roomName: room });
  const existing = await loadCall(room);
  if (!existing || existing.thread_id !== tid) {
    return failure('call_not_found', 'This call has ended or is no longer available.', 404);
  }
  if (!isMultiparty(existing)) return null;
  if (!(existing.participant_ids || []).map(normalize).includes(uid)) {
    return failure('not_a_participant', `You cannot ${state} this call.`, 403);
  }
  if (uid === existing.caller_id && state === 'declined') {
    return failure('caller_cannot_decline', 'The caller must cancel the call instead.', 400);
  }
  if (!LIVE_STATUSES.includes(existing.status)) {
    return { ok: true, call: publicCall(existing), action: state, terminal: true };
  }

  const now = new Date();
  const timestampKey = state === 'declined' ? 'declined_at' : 'left_at';
  const call = await ProfessionalCall.findOneAndUpdate(
    {
      room_name: room,
      thread_id: tid,
      call_scope: 'multiparty',
      participant_ids: uid,
      status: { $in: LIVE_STATUSES },
      participant_states: { $elemMatch: { user_id: uid } },
    },
    {
      $set: {
        'participant_states.$[participant].status': state,
        [`participant_states.$[participant].${timestampKey}`]: now,
      },
    },
    {
      returnDocument: 'after',
      arrayFilters: [{ 'participant.user_id': uid }],
    },
  ).lean();
  if (!call) return failure('invalid_call_state', `This call can no longer be ${state}.`);
  if (state === 'left') {
    // This condition is evaluated by MongoDB after the participant update.
    // Concurrent joins/leaves serialize on the document: a join either lands
    // first and prevents termination, or termination wins and blocks the join.
    await ProfessionalCall.findOneAndUpdate(
      {
        room_name: room,
        thread_id: tid,
        status: { $in: LIVE_STATUSES },
        participant_states: { $not: { $elemMatch: { status: 'joined' } } },
      },
      {
        $set: {
          status: 'ended',
          cleanup_status: 'pending',
          cleanup_next_attempt_at: now,
          cleanup_final_after: new Date(now.getTime() + TOKEN_REJOIN_GUARD_MS),
          ended_at: now,
          ended_by_id: uid,
          expires_at: now,
          delete_at: new Date(now.getTime() + TERMINAL_RETENTION_MS),
        },
        $unset: { active_thread_key: 1 },
      },
      { returnDocument: 'after' },
    ).lean();
  }
  let current = await loadCall(room);
  const terminal = !LIVE_STATUSES.includes(current?.status);
  if (terminal) current = await finalizeArtifactState(current);
  return { ok: true, call: publicCall(current), action: state, terminal };
}

async function transitionTerminal({ threadId, roomName, userId, kind, hostOnly = false }) {
  const tid = normalize(threadId);
  const room = normalize(roomName);
  const uid = normalize(userId);
  await expireStaleCalls({ threadId: tid, roomName: room });
  const existingBeforeTransition = await loadCall(room);
  if (hostOnly) {
    if (
      existingBeforeTransition &&
      existingBeforeTransition.thread_id === tid &&
      existingBeforeTransition.caller_id !== uid
    ) {
      return failure('host_only_end', 'Only the call host can end this call for everyone.', 403);
    }
  }
  const allowedStatuses = kind === 'declined' ? ['ringing'] : LIVE_STATUSES;
  const filter = {
    room_name: room,
    thread_id: tid,
    participant_ids: uid,
    status: { $in: allowedStatuses },
  };
  if (kind === 'declined') filter.caller_id = { $ne: uid };
  if (hostOnly) filter.caller_id = uid;
  const now = new Date();
  const participantStatus = kind === 'declined' ? 'declined' : 'left';
  const participantTimestamp = kind === 'declined' ? 'declined_at' : 'left_at';
  const participantFilter =
    kind === 'ended' && isMultiparty(existingBeforeTransition)
      ? { 'participant.status': { $ne: 'declined' } }
      : { 'participant.user_id': uid };
  const call = await ProfessionalCall.findOneAndUpdate(
    filter,
    {
      $set: {
        status: kind,
        'participant_states.$[participant].status': participantStatus,
        [`participant_states.$[participant].${participantTimestamp}`]: now,
        cleanup_status: 'pending',
        cleanup_next_attempt_at: now,
        cleanup_final_after: new Date(now.getTime() + TOKEN_REJOIN_GUARD_MS),
        ended_at: now,
        ended_by_id: uid,
        expires_at: now,
        delete_at: new Date(now.getTime() + TERMINAL_RETENTION_MS),
      },
      $unset: { active_thread_key: 1 },
    },
    { returnDocument: 'after', arrayFilters: [participantFilter] },
  ).lean();
  if (call) {
    const finalized = kind === 'ended' ? await finalizeArtifactState(call) : call;
    return { ok: true, call: publicCall(finalized) };
  }

  const existing = await loadCall(room);
  if (!existing || existing.thread_id !== tid) {
    return failure('call_not_found', `This call has already ${kind === 'ended' ? 'ended' : 'finished'}.`, 404);
  }
  if (!existing.participant_ids.includes(uid)) {
    return failure('not_a_participant', `You cannot ${kind === 'ended' ? 'end' : 'decline'} this call.`, 403);
  }
  if (kind === 'declined' && existing.caller_id === uid) {
    return failure('caller_cannot_decline', 'The caller must cancel the call instead.', 400);
  }
  // Terminal operations are idempotent so room cleanup can be retried.
  if (existing.status === kind || (kind === 'ended' && !LIVE_STATUSES.includes(existing.status))) {
    const finalized = kind === 'ended' ? await finalizeArtifactState(existing) : existing;
    return { ok: true, call: publicCall(finalized) };
  }
  return failure('invalid_call_state', `This call can no longer be ${kind}.`);
}

export async function declineCall(args) {
  const participantResult = await updateMultipartyParticipant({ ...args, state: 'declined' });
  if (participantResult) return participantResult;
  return transitionTerminal({ ...args, kind: 'declined' });
}

export async function leaveCall(args) {
  const participantResult = await updateMultipartyParticipant({ ...args, state: 'left' });
  if (participantResult) return participantResult;
  return transitionTerminal({ ...args, kind: 'ended' });
}

export async function endCall(args) {
  const existing = await loadCall(args.roomName);
  if (isMultiparty(existing) && normalize(existing.caller_id) !== normalize(args.userId)) {
    return leaveCall(args);
  }
  return transitionTerminal({
    ...args,
    kind: 'ended',
    hostOnly: isMultiparty(existing),
  });
}
