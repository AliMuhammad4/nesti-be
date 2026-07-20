import ProfessionalCall from '../../models/ProfessionalCall.js';
import { isMultiparty, normalize, participantStates, publicCall } from './callPublicShape.js';
import { scheduleTranscriptionWorkerDispatch } from './callTranscriptionDispatchService.js';
import { verifyLiveKitCallPresence } from './liveKitRoomService.js';
import {
  ACTIVE_TTL_MS,
  CONNECTING_TTL_MS,
  LIVE_STATUSES,
  TERMINAL_RETENTION_MS,
  expireStaleCalls,
  failure,
  loadCall,
} from './callRegistryShared.js';

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
  const existingConsent = participantBeforeJoin?.transcription_consent;
  const nextConsent = existingConsent === true ? true : transcriptionConsent;
  const nextConsentedAt =
    nextConsent === true
      ? participantBeforeJoin?.transcription_consented_at || new Date()
      : null;

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
                        transcription_consent: nextConsent,
                        transcription_consented_at: nextConsentedAt,
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
    if (['connecting', 'active'].includes(call.status)) {
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
  const mediaPresent = await verifyLiveKitCallPresence(
    room,
    existingBeforeUpdate.participant_ids,
    { minPresent: calleeActivatingDirectCall ? 1 : 2 },
  );
  if (!mediaPresent) {
    return failure(
      'media_not_ready',
      'The call is still waiting for participants to connect.',
      409,
    );
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
    scheduleTranscriptionWorkerDispatch(activated._id);
    return { ok: true, call: publicCall(activated) };
  }
  return failure('invalid_call_state', 'This call cannot be activated.', 409);
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
