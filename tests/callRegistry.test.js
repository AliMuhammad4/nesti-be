import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import ProfessionalCall from '../models/ProfessionalCall.js';
import {
  authorizeCallJoin,
  clearCallRegistryForTests,
  createPendingCall,
  declineCall,
  endCall,
  leaveCall,
  markCallActive,
  markCallInvited,
  recheckCallJoin,
} from '../services/proChat/callRegistry.js';

const records = [];
let nextId = 1;

function matches(record, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((item) => matches(record, item));
    if (key === '$and') return expected.every((item) => matches(record, item));
    const actual = record[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if (
        '$in' in expected &&
        !(Array.isArray(actual)
          ? actual.some((item) => expected.$in.includes(item))
          : expected.$in.includes(actual))
      ) {
        return false;
      }
      if ('$ne' in expected && actual === expected.$ne) return false;
      if ('$gt' in expected && !(actual > expected.$gt)) return false;
      if ('$lte' in expected && !(actual <= expected.$lte)) return false;
      if ('$exists' in expected && expected.$exists !== (actual !== undefined)) return false;
      if ('$elemMatch' in expected) {
        return Array.isArray(actual) && actual.some((item) => matches(item, expected.$elemMatch));
      }
      if ('$not' in expected) {
        if (
          expected.$not.$elemMatch &&
          Array.isArray(actual) &&
          actual.some((item) => matches(item, expected.$not.$elemMatch))
        ) {
          return false;
        }
      }
      return true;
    }
    if (Array.isArray(actual)) return actual.includes(expected);
    return actual === expected;
  });
}

function applyUpdate(record, update, options = {}) {
  if (Array.isArray(update)) {
    const set = update[0].$set;
    if (typeof set.status === 'string') {
      record.status = set.status;
      if (set.started_at?.$ifNull && !record.started_at) {
        record.started_at = set.started_at.$ifNull[1];
      }
    } else {
      const uid = set.status.$cond[0].$and[0].$ne[1];
      if (record.caller_id !== uid && record.status !== 'active') record.status = 'connecting';
      if (set.connecting_at?.$cond && record.caller_id !== uid && !record.connecting_at) {
        record.connecting_at = set.connecting_at.$cond[2].$ifNull[1];
      }
      const participant = record.participant_states?.find((item) => item.user_id === uid);
      if (participant && set.participant_states?.$map) {
        const choice =
          set.participant_states.$map.in.$cond[1].$mergeObjects[1];
        participant.transcription_consent = choice.transcription_consent;
        participant.transcription_consented_at = choice.transcription_consented_at;
        participant.transcription_consent_recorded_at =
          choice.transcription_consent_recorded_at;
        participant.transcription_consent_version =
          choice.transcription_consent_version;
      }
    }
    record.expires_at =
      set.expires_at instanceof Date
        ? set.expires_at
        : new Date(Date.now() + 2 * 60 * 1000);
    record.delete_at = set.delete_at;
    return;
  }
  for (const [key, value] of Object.entries(update.$set || {})) {
    const positional = key.match(/^participant_states\.\$\[participant\]\.(.+)$/);
    if (!positional) {
      record[key] = value;
      continue;
    }
    const participantFilter = Object.fromEntries(
      Object.entries(options.arrayFilters?.[0] || {}).map(([filterKey, filterValue]) => [
        filterKey.replace(/^participant\./, ''),
        filterValue,
      ]),
    );
    for (const participant of record.participant_states || []) {
      if (matches(participant, participantFilter)) participant[positional[1]] = value;
    }
  }
  for (const key of Object.keys(update.$unset || {})) delete record[key];
  for (const [key, value] of Object.entries(update.$inc || {})) {
    record[key] = (record[key] || 0) + value;
  }
}

function queryResult(value) {
  return { lean: async () => (value == null ? value : structuredClone(value)) };
}

test.before(() => {
  mock.method(ProfessionalCall, 'findOne', (filter) => {
    return queryResult(records.find((record) => matches(record, filter)) || null);
  });
  mock.method(ProfessionalCall, 'find', (filter) => {
    const matched = records.filter((record) => matches(record, filter));
    const query = {
      select() {
        return query;
      },
      limit(count) {
        query._limit = count;
        return query;
      },
      lean: async () => {
        const rows = matched.map((record) => structuredClone(record));
        return Number.isFinite(query._limit) ? rows.slice(0, query._limit) : rows;
      },
    };
    return query;
  });
  mock.method(ProfessionalCall, 'findOneAndUpdate', (filter, update, options) => {
    if (Array.isArray(update)) assert.equal(options?.updatePipeline, true);
    const record = records.find((item) => matches(item, filter)) || null;
    if (record) applyUpdate(record, update, options);
    return queryResult(record);
  });
  mock.method(ProfessionalCall, 'updateMany', async (filter, update) => {
    const found = records.filter((record) => matches(record, filter));
    found.forEach((record) => applyUpdate(record, update));
    return { modifiedCount: found.length };
  });
  mock.method(ProfessionalCall, 'updateOne', async (filter, update) => {
    const record = records.find((item) => matches(item, filter)) || null;
    if (record) applyUpdate(record, update);
    return { modifiedCount: record ? 1 : 0 };
  });
  mock.method(ProfessionalCall, 'create', async (values) => {
    if (
      records.some(
        (record) =>
          record.room_name === values.room_name ||
          (record.active_thread_key && record.active_thread_key === values.active_thread_key),
      )
    ) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    // Yield once so concurrent starts contend as they would at the unique index.
    await Promise.resolve();
    if (records.some((record) => record.active_thread_key === values.active_thread_key)) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    const record = {
      _id: String(nextId++),
      cleanup_status: 'not_needed',
      createdAt: new Date(),
      ...values,
    };
    records.push(record);
    return { toObject: () => record };
  });
  mock.method(ProfessionalCall, 'deleteMany', async () => {
    records.splice(0);
  });
});

test.beforeEach(async () => {
  await clearCallRegistryForTests();
});

const baseCall = {
  threadId: 'thread-1',
  roomName: 'prochat:thread-1:call-12345678',
  callerId: 'user-1',
  callType: 'voice',
  participantIds: ['user-1', 'user-2'],
  transcriptionConsent: true,
};

test('explicit transcription choice is stored per participant including false', async () => {
  const noConsentStart = await createPendingCall({
    ...baseCall,
    transcriptionConsent: false,
  });
  assert.equal(noConsentStart.ok, true);
  const callerState = noConsentStart.call.participant_states.find(
    (participant) => participant.user_id === 'user-1',
  );
  assert.equal(callerState.transcription_consent, false);
  assert.ok(callerState.transcription_consent_recorded_at);
  assert.equal(callerState.transcription_consent_version, '1');

  await clearCallRegistryForTests();
  const created = await createPendingCall(baseCall);
  assert.equal(
    created.call.participant_states.find((participant) => participant.user_id === 'user-1')
      .transcription_consent,
    true,
  );
  // Invitees stay unset until they make an explicit choice.
  assert.equal(
    created.call.participant_states.find((participant) => participant.user_id === 'user-2')
      .transcription_consent,
    null,
  );
  await markCallInvited(baseCall);
  const noConsentJoin = await authorizeCallJoin({
    threadId: baseCall.threadId,
    roomName: baseCall.roomName,
    userId: 'user-2',
    transcriptionConsent: false,
  });
  assert.equal(noConsentJoin.ok, true);
  const noConsentJoinState = noConsentJoin.call.participant_states.find(
    (participant) => participant.user_id === 'user-2',
  );
  assert.equal(noConsentJoinState.transcription_consent, false);
  assert.ok(noConsentJoinState.transcription_consent_recorded_at);
  assert.equal(noConsentJoinState.transcription_consent_version, '1');
  const joined = await authorizeCallJoin({
    threadId: baseCall.threadId,
    roomName: baseCall.roomName,
    userId: 'user-2',
    transcriptionConsent: true,
  });
  assert.equal(
    joined.call.participant_states.find((participant) => participant.user_id === 'user-2')
      .transcription_consent,
    true,
  );
  // Allowed minutes cannot be revoked by a later rejoin with false.
  const sticky = await authorizeCallJoin({
    threadId: baseCall.threadId,
    roomName: baseCall.roomName,
    userId: 'user-2',
    transcriptionConsent: false,
  });
  assert.equal(
    sticky.call.participant_states.find((participant) => participant.user_id === 'user-2')
      .transcription_consent,
    true,
  );
});

test('no-consent direct call activates and terminates without minutes work', async () => {
  const noConsentCall = { ...baseCall, transcriptionConsent: false };
  assert.equal((await createPendingCall(noConsentCall)).ok, true);
  await markCallInvited(noConsentCall);
  assert.equal(
    (
      await authorizeCallJoin({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: 'user-2',
        transcriptionConsent: false,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await markCallActive({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: 'user-2',
        callType: 'voice',
      })
    ).call.status,
    'active',
  );
  const ended = await endCall({
    threadId: baseCall.threadId,
    roomName: baseCall.roomName,
    userId: 'user-2',
  });
  assert.equal(ended.call.transcription_status, 'disabled');
  assert.equal(ended.call.minutes_status, 'not_ready');
  assert.equal(ended.call.transcription_error_code, 'no_transcription_consent');
});

test('mixed-consent group participants all join while choices stay isolated', async () => {
  const groupCall = {
    ...baseCall,
    participantIds: ['user-1', 'user-2', 'user-3'],
    callScope: 'multiparty',
    transcriptionConsent: false,
  };
  await createPendingCall(groupCall);
  await markCallInvited(groupCall);
  await authorizeCallJoin({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-2',
    transcriptionConsent: true,
  });
  const joinedWithoutConsent = await authorizeCallJoin({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-3',
    transcriptionConsent: false,
  });
  const choices = new Map(
    joinedWithoutConsent.call.participant_states.map((participant) => [
      participant.user_id,
      participant.transcription_consent,
    ]),
  );
  assert.deepEqual(
    Object.fromEntries(choices),
    { 'user-1': false, 'user-2': true, 'user-3': false },
  );
  assert.equal(
    (
      await markCallActive({
        threadId: groupCall.threadId,
        roomName: groupCall.roomName,
        userId: 'user-3',
        callType: 'voice',
      })
    ).call.status,
    'active',
  );
});

test('call registry enforces persistent lifecycle without marking token joins active', async () => {
  assert.equal((await createPendingCall(baseCall)).ok, true);
  assert.equal((await markCallInvited(baseCall)).call.status, 'ringing');
  assert.equal(
    (
      await authorizeCallJoin({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: 'user-2',
        transcriptionConsent: true,
      })
    ).call.status,
    'connecting',
  );
  assert.equal(
    (
      await markCallActive({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: 'user-2',
        callType: 'voice',
      })
    ).call.status,
    'active',
  );
  const ended = await endCall({
    threadId: baseCall.threadId,
    roomName: baseCall.roomName,
    userId: 'user-2',
  });
  assert.equal(ended.ok, true);
  assert.equal(ended.call.transcription_status, 'active');
  assert.equal(ended.call.minutes_status, 'pending');
  assert.equal(
    (
      await recheckCallJoin({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: 'user-2',
        callType: 'voice',
      })
    ).code,
    'call_ended',
  );
});

test('unique thread ownership blocks concurrent starts across instances', async () => {
  const [first, second] = await Promise.all([
    createPendingCall(baseCall),
    createPendingCall({ ...baseCall, roomName: 'prochat:thread-1:call-87654321' }),
  ]);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal([first, second].find((result) => !result.ok).code, 'call_in_progress');
});

test('decline is atomic, recipient-only, and idempotent for cleanup retries', async () => {
  await createPendingCall(baseCall);
  await markCallInvited(baseCall);
  assert.equal(
    (
      await declineCall({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: baseCall.callerId,
      })
    ).code,
    'caller_cannot_decline',
  );
  const declined = await declineCall({
    threadId: baseCall.threadId,
    roomName: baseCall.roomName,
    userId: 'user-2',
  });
  assert.equal(declined.call.cleanup_status, 'pending');
  assert.equal(
    (
      await declineCall({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: 'user-2',
      })
    ).ok,
    true,
  );
});

test('non-participants cannot join or end a call', async () => {
  await createPendingCall(baseCall);
  assert.equal(
    (
      await authorizeCallJoin({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: 'user-3',
        transcriptionConsent: true,
      })
    ).code,
    'not_a_participant',
  );
  assert.equal(
    (
      await endCall({
        threadId: baseCall.threadId,
        roomName: baseCall.roomName,
        userId: 'user-3',
      })
    ).code,
    'not_a_participant',
  );
});

test('stored call type remains authoritative', async () => {
  await createPendingCall(baseCall);
  assert.equal((await createPendingCall({ ...baseCall, callType: 'video' })).code, 'call_type_mismatch');
  assert.equal((await markCallInvited({ ...baseCall, callType: 'video' })).code, 'call_type_mismatch');
});

test('multiparty calls snapshot members and track independent participant state', async () => {
  const groupCall = {
    ...baseCall,
    participantIds: ['user-1', 'user-2', 'user-3'],
    callScope: 'multiparty',
  };
  const created = await createPendingCall(groupCall);
  assert.equal(created.call.call_scope, 'multiparty');
  assert.deepEqual(created.call.participant_ids, groupCall.participantIds);
  assert.equal(
    created.call.participant_states.find((participant) => participant.user_id === 'user-1').status,
    'joined',
  );

  const invited = await markCallInvited({
    ...groupCall,
    currentParticipantIds: groupCall.participantIds,
  });
  assert.deepEqual(invited.invitee_ids, ['user-2', 'user-3']);

  const declined = await declineCall({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-2',
  });
  assert.equal(declined.terminal, false);
  assert.equal(declined.call.status, 'ringing');
  assert.equal(declined.call.cleanup_status, 'not_needed');
  assert.equal(
    declined.call.participant_states.find((participant) => participant.user_id === 'user-2').status,
    'declined',
  );
  assert.equal(
    (
      await authorizeCallJoin({
        threadId: groupCall.threadId,
        roomName: groupCall.roomName,
        userId: 'user-2',
        transcriptionConsent: true,
      })
    ).code,
    'reinvite_required',
  );
});

test('targeted reinvite requires both snapshot and current thread membership', async () => {
  const groupCall = {
    ...baseCall,
    participantIds: ['user-1', 'user-2', 'user-3'],
    callScope: 'multiparty',
  };
  await createPendingCall(groupCall);
  await markCallInvited({ ...groupCall, currentParticipantIds: groupCall.participantIds });
  await declineCall({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-2',
  });

  assert.equal(
    (
      await markCallInvited({
        ...groupCall,
        targetUserId: 'user-4',
        currentParticipantIds: [...groupCall.participantIds, 'user-4'],
      })
    ).code,
    'not_in_call_snapshot',
  );
  assert.equal(
    (
      await markCallInvited({
        ...groupCall,
        targetUserId: 'user-2',
        currentParticipantIds: ['user-1', 'user-3'],
      })
    ).code,
    'not_a_current_member',
  );
  const reinvited = await markCallInvited({
    ...groupCall,
    targetUserId: 'user-2',
    currentParticipantIds: groupCall.participantIds,
  });
  assert.deepEqual(reinvited.invitee_ids, ['user-2']);
  assert.equal(
    reinvited.call.participant_states.find((participant) => participant.user_id === 'user-2').status,
    'invited',
  );
});

test('only multiparty host ends everyone while members leave independently', async () => {
  const groupCall = {
    ...baseCall,
    participantIds: ['user-1', 'user-2', 'user-3'],
    callScope: 'multiparty',
  };
  await createPendingCall(groupCall);
  await markCallInvited({ ...groupCall, currentParticipantIds: groupCall.participantIds });
  await authorizeCallJoin({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-2',
    transcriptionConsent: true,
  });
  await markCallActive({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-2',
    callType: 'voice',
  });

  const memberEnded = await endCall({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-2',
  });
  assert.equal(memberEnded.action, 'left');
  assert.equal(memberEnded.terminal, false);
  assert.equal(memberEnded.call.status, 'active');

  const hostEnded = await endCall({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-1',
  });
  assert.equal(hostEnded.call.status, 'ended');
  assert.equal(hostEnded.call.cleanup_status, 'pending');
});

test('leaving as the last joined multiparty participant terminates the room', async () => {
  const groupCall = {
    ...baseCall,
    participantIds: ['user-1', 'user-2', 'user-3'],
    callScope: 'multiparty',
  };
  await createPendingCall(groupCall);
  await markCallInvited({ ...groupCall, currentParticipantIds: groupCall.participantIds });
  const left = await leaveCall({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-1',
  });
  assert.equal(left.terminal, true);
  assert.equal(left.call.status, 'ended');
  assert.equal(left.call.cleanup_status, 'pending');
});

test('concurrent multiparty state changes are preserved and last leave terminates once safe', async () => {
  const groupCall = {
    ...baseCall,
    participantIds: ['user-1', 'user-2', 'user-3'],
    callScope: 'multiparty',
  };
  await createPendingCall(groupCall);
  await markCallInvited({ ...groupCall, currentParticipantIds: groupCall.participantIds });
  await Promise.all(
    ['user-2', 'user-3'].map((userId) =>
      authorizeCallJoin({
        threadId: groupCall.threadId,
        roomName: groupCall.roomName,
        userId,
        transcriptionConsent: true,
      }),
    ),
  );
  await Promise.all(
    ['user-2', 'user-3'].map((userId) =>
      markCallActive({
        threadId: groupCall.threadId,
        roomName: groupCall.roomName,
        userId,
        callType: 'voice',
      }),
    ),
  );

  const joined = await recheckCallJoin({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-1',
    callType: 'voice',
  });
  assert.deepEqual(
    joined.call.participant_states
      .filter((participant) => participant.status === 'joined')
      .map((participant) => participant.user_id)
      .sort(),
    ['user-1', 'user-2', 'user-3'],
  );

  await Promise.all(
    groupCall.participantIds.map((userId) =>
      leaveCall({
        threadId: groupCall.threadId,
        roomName: groupCall.roomName,
        userId,
      }),
    ),
  );
  const ended = await endCall({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-1',
  });
  assert.equal(ended.call.status, 'ended');
  assert.equal(ended.call.cleanup_status, 'pending');
  assert.equal(
    ended.call.participant_states.every((participant) => participant.status === 'left'),
    true,
  );
});

test('concurrent reinvite, join, decline, and leave mutate only their participant', async () => {
  const groupCall = {
    ...baseCall,
    participantIds: ['user-1', 'user-2', 'user-3'],
    callScope: 'multiparty',
  };
  await createPendingCall(groupCall);
  await markCallInvited({ ...groupCall, currentParticipantIds: groupCall.participantIds });
  await declineCall({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-2',
  });

  await Promise.all([
    markCallInvited({
      ...groupCall,
      targetUserId: 'user-2',
      currentParticipantIds: groupCall.participantIds,
    }),
    leaveCall({
      threadId: groupCall.threadId,
      roomName: groupCall.roomName,
      userId: 'user-3',
    }),
  ]);
  let current = await recheckCallJoin({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-1',
    callType: 'voice',
  });
  assert.equal(
    current.call.participant_states.find((participant) => participant.user_id === 'user-2').status,
    'invited',
  );
  assert.equal(
    current.call.participant_states.find((participant) => participant.user_id === 'user-3').status,
    'left',
  );

  await authorizeCallJoin({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-2',
    transcriptionConsent: true,
  });
  await markCallInvited({
    ...groupCall,
    targetUserId: 'user-3',
    currentParticipantIds: groupCall.participantIds,
  });
  await Promise.all([
    markCallActive({
      threadId: groupCall.threadId,
      roomName: groupCall.roomName,
      userId: 'user-2',
      callType: 'voice',
    }),
    declineCall({
      threadId: groupCall.threadId,
      roomName: groupCall.roomName,
      userId: 'user-3',
    }),
  ]);
  current = await recheckCallJoin({
    threadId: groupCall.threadId,
    roomName: groupCall.roomName,
    userId: 'user-1',
    callType: 'voice',
  });
  assert.equal(
    current.call.participant_states.find((participant) => participant.user_id === 'user-2').status,
    'joined',
  );
  assert.equal(
    current.call.participant_states.find((participant) => participant.user_id === 'user-3').status,
    'declined',
  );
});
