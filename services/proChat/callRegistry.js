import ProfessionalCall from '../../models/ProfessionalCall.js';
import {
  noConsentArtifactSet,
  participantConsentFields,
} from './callArtifactFields.js';
import {
  isMultiparty,
  normalize,
  participantStates,
  publicCall,
} from './callPublicShape.js';
import { scheduleTranscriptionWorkerDispatch } from './callTranscriptionDispatchService.js';
import { verifyLiveKitCallPresence } from './liveKitRoomService.js';

const PREPARING_TTL_MS = 60 * 1000;
const RINGING_TTL_MS = 90 * 1000;
const ACTIVE_TTL_MS = 4 * 60 * 60 * 1000;
const CONNECTING_TTL_MS = 2 * 60 * 1000;
const TERMINAL_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const TOKEN_REJOIN_GUARD_MS = 70 * 1000;
const LIVE_STATUSES = ['preparing', 'ringing', 'connecting', 'active'];

async function finalizeArtifactState(call) {
  if (!call?.started_at) return call;
  const now = new Date();
  const hasConsent = participantStates(call).some(
    (participant) => participant.transcription_consent === true,
  );
  if (!hasConsent) {
    await ProfessionalCall.updateOne(
      {
        _id: call._id,
        transcription_status: { $in: ['pending', 'dispatching', 'active', 'failed'] },
      },
      { $set: noConsentArtifactSet() },
    );
    return loadCall(call.room_name);
  }

  // The worker owns completion after all participant streams have drained.
  // The deadline is a recovery barrier for a crashed worker.
  await ProfessionalCall.updateOne(
    {
      _id: call._id,
      transcription_status: { $in: ['pending', 'dispatching', 'active', 'failed'] },
    },
    {
      $set: {
        transcription_status: 'active',
        transcription_drain_deadline: new Date(now.getTime() + 30_000),
        transcription_error_code: '',
        transcription_error_message: '',
        minutes_status: 'pending',
      },
    },
  );
  return loadCall(call.room_name);
}

function failure(code, message, status = 409) {
  return { ok: false, code, message, status };
}

function isDuplicateKey(error) {
  return Number(error?.code) === 11000;
}

async function expireStaleCalls({ threadId, roomName } = {}) {
  const now = new Date();
  const filter = {
    status: { $in: LIVE_STATUSES },
    expires_at: { $lte: now },
  };
  if (threadId || roomName) {
    filter.$or = [];
    if (threadId) filter.$or.push({ active_thread_key: normalize(threadId) });
    if (roomName) filter.$or.push({ room_name: normalize(roomName) });
  }
  await ProfessionalCall.updateMany(filter, {
    $set: {
      status: 'expired',
      ended_at: now,
      cleanup_status: 'pending',
      cleanup_next_attempt_at: now,
      cleanup_final_after: new Date(now.getTime() + TOKEN_REJOIN_GUARD_MS),
      expires_at: now,
      delete_at: new Date(now.getTime() + TERMINAL_RETENTION_MS),
    },
    $unset: { active_thread_key: 1 },
  });
  const artifactFilter = {
    status: 'expired',
    started_at: { $ne: null },
    transcription_status: { $in: ['pending', 'dispatching', 'active'] },
  };
  if (threadId || roomName) {
    artifactFilter.$or = [];
    if (threadId) artifactFilter.$or.push({ thread_id: normalize(threadId) });
    if (roomName) artifactFilter.$or.push({ room_name: normalize(roomName) });
  }
  await ProfessionalCall.updateMany(
    {
      ...artifactFilter,
      participant_states: { $not: { $elemMatch: { transcription_consent: true } } },
    },
    { $set: noConsentArtifactSet() },
  );
  await ProfessionalCall.updateMany({
    ...artifactFilter,
    participant_states: { $elemMatch: { transcription_consent: true } },
  }, {
    $set: {
      transcription_status: 'active',
      transcription_drain_deadline: new Date(now.getTime() + 30_000),
      minutes_status: 'pending',
    },
  });
}

async function loadCall(roomName) {
  return ProfessionalCall.findOne({ room_name: normalize(roomName) }).lean();
}

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
      expires_at: new Date(Date.now() + PREPARING_TTL_MS),
      delete_at: new Date(Date.now() + PREPARING_TTL_MS + TERMINAL_RETENTION_MS),
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

export async function authorizeCallJoin({
  threadId,
  roomName,
  userId,
  callType,
  transcriptionConsent,
  transcriptionPolicyVersion = process.env.CALL_TRANSCRIPTION_CONSENT_VERSION || '1',
}) {
  const tid = normalize(threadId);
  const room = normalize(roomName);
  const uid = normalize(userId);
  if (typeof transcriptionConsent !== 'boolean') {
    return failure(
      'transcription_consent_choice_required',
      'An explicit transcription consent choice is required before joining the call.',
      400,
    );
  }
  await expireStaleCalls({ threadId: tid, roomName: room });
  const existingBeforeJoin = await loadCall(room);
  const participantBeforeJoin = participantStates(existingBeforeJoin).find(
    (participant) => participant.user_id === uid,
  );
  if (
    isMultiparty(existingBeforeJoin) &&
    participantBeforeJoin &&
    ['declined', 'left'].includes(participantBeforeJoin.status)
  ) {
    return failure('reinvite_required', 'The call host must invite you again before you can join.', 403);
  }

  // A token request means accepted/connecting, not that media connected.
  const call = await ProfessionalCall.findOneAndUpdate(
    {
      room_name: room,
      thread_id: tid,
      participant_ids: uid,
      status: { $in: ['ringing', 'connecting', 'active'] },
      $or: [
        { call_scope: { $ne: 'multiparty' } },
        {
          participant_states: {
            $elemMatch: { user_id: uid, status: { $in: ['invited', 'joined'] } },
          },
        },
      ],
      ...(callType ? { call_type: callType } : {}),
    },
    [
      {
        $set: {
          status: {
            $cond: [
              { $and: [{ $ne: ['$caller_id', uid] }, { $ne: ['$status', 'active'] }] },
              'connecting',
              '$status',
            ],
          },
          expires_at: {
            $cond: [
              { $eq: ['$status', 'active'] },
              new Date(Date.now() + ACTIVE_TTL_MS),
              new Date(Date.now() + CONNECTING_TTL_MS),
            ],
          },
          delete_at: new Date(Date.now() + ACTIVE_TTL_MS + TERMINAL_RETENTION_MS),
          connecting_at: {
            $cond: [
              { $eq: ['$caller_id', uid] },
              '$connecting_at',
              { $ifNull: ['$connecting_at', new Date()] },
            ],
          },
          participant_states: {
            $map: {
              input: '$participant_states',
              as: 'participant',
              in: {
                $cond: [
                  { $eq: ['$$participant.user_id', uid] },
                  {
                    $mergeObjects: [
                      '$$participant',
                      {
                        transcription_consent: transcriptionConsent,
                        transcription_consented_at: transcriptionConsent ? new Date() : null,
                        transcription_consent_recorded_at: new Date(),
                        transcription_consent_version:
                          normalize(transcriptionPolicyVersion) || '1',
                      },
                    ],
                  },
                  '$$participant',
                ],
              },
            },
          },
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true },
  ).lean();
  if (call) {
    if (call.status === 'active') {
      scheduleTranscriptionWorkerDispatch(call._id);
    }
    return { ok: true, call: publicCall(call) };
  }

  const existing = await loadCall(room);
  if (!existing || existing.thread_id !== tid) {
    return failure('call_not_found', 'This call has ended or is no longer available.', 404);
  }
  if (!existing.participant_ids.includes(uid)) {
    return failure('not_a_participant', 'You cannot join this call.', 403);
  }
  if (callType && existing.call_type !== callType) {
    return failure('call_type_mismatch', 'The call type does not match the active call.');
  }
  if (existing.status === 'preparing') {
    return failure('call_not_ready', 'The caller has not sent the invitation yet.');
  }
  return failure('call_ended', 'This call has already ended.', 410);
}

export async function markCallActive({ threadId, roomName, userId, callType }) {
  const tid = normalize(threadId);
  const room = normalize(roomName);
  const uid = normalize(userId);
  const now = new Date();
  const existingBeforeUpdate = await loadCall(room);
  if (!existingBeforeUpdate || existingBeforeUpdate.thread_id !== tid) {
    return failure('call_not_found', 'This call has ended or is no longer available.', 404);
  }
  if (!(existingBeforeUpdate.participant_ids || []).map(normalize).includes(uid)) {
    return failure('not_a_participant', 'You cannot activate this call.', 403);
  }
  if (callType && existingBeforeUpdate.call_type !== callType) {
    return failure('call_type_mismatch', 'The call type does not match the active call.');
  }
  if (!['connecting', 'active', 'ringing'].includes(existingBeforeUpdate.status)) {
    return failure('invalid_call_state', 'This call cannot be activated.', 409);
  }
  if (new Date(existingBeforeUpdate.expires_at).getTime() <= now.getTime()) {
    return failure('call_ended', 'This call has expired.', 410);
  }
  if (!isMultiparty(existingBeforeUpdate) && existingBeforeUpdate.caller_id === uid) {
    return failure('caller_cannot_activate', 'The recipient must activate the call.', 403);
  }
  const calleeActivatingDirectCall =
    !isMultiparty(existingBeforeUpdate) &&
    existingBeforeUpdate.caller_id !== uid &&
    ['connecting', 'ringing'].includes(existingBeforeUpdate.status);
  if (!calleeActivatingDirectCall) {
    const mediaPresent = await verifyLiveKitCallPresence(
      room,
      existingBeforeUpdate.participant_ids,
    );
    if (!mediaPresent) {
      return failure(
        'media_not_ready',
        'The call is still waiting for participants to connect.',
        409,
      );
    }
  }
  const activated = await ProfessionalCall.findOneAndUpdate(
    {
      room_name: room,
      thread_id: tid,
      participant_ids: uid,
      status: { $in: ['connecting', 'active', 'ringing'] },
      expires_at: { $gt: now },
      $or: [
        { call_scope: { $ne: 'multiparty' } },
        {
          participant_states: {
            $elemMatch: { user_id: uid, status: { $in: ['invited', 'joined'] } },
          },
        },
      ],
      ...(callType ? { call_type: callType } : {}),
    },
    {
      $set: {
        status: 'active',
        'participant_states.$[participant].status': 'joined',
        'participant_states.$[participant].joined_at': now,
        'participant_states.$[participant].declined_at': null,
        'participant_states.$[participant].left_at': null,
        started_at: existingBeforeUpdate.started_at || now,
        expires_at: new Date(now.getTime() + ACTIVE_TTL_MS),
        delete_at: new Date(now.getTime() + ACTIVE_TTL_MS + TERMINAL_RETENTION_MS),
      },
    },
    {
      returnDocument: 'after',
      arrayFilters: [
        { 'participant.user_id': uid, 'participant.status': { $ne: 'joined' } },
      ],
    },
  ).lean();
  if (activated) {
    return { ok: true, call: publicCall(activated) };
  }
  return failure('invalid_call_state', 'This call cannot be activated.', 409);
}

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

export async function recheckCallJoin({ threadId, roomName, userId, callType }) {
  const call = await ProfessionalCall.findOne({
    room_name: normalize(roomName),
    thread_id: normalize(threadId),
    participant_ids: normalize(userId),
    call_type: callType,
    status: { $in: LIVE_STATUSES },
    expires_at: { $gt: new Date() },
  }).lean();
  if (!call) {
    return failure('call_ended', 'This call ended while the token was being created.', 410);
  }
  const participant = participantStates(call).find(
    (item) => item.user_id === normalize(userId),
  );
  if (isMultiparty(call) && participant && ['declined', 'left'].includes(participant.status)) {
    return failure('reinvite_required', 'The call host must invite you again before you can join.', 403);
  }
  return { ok: true, call: publicCall(call) };
}

export async function clearCallRegistryForTests() {
  await ProfessionalCall.deleteMany({});
}
