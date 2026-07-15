import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import ProfessionalCall from '../models/ProfessionalCall.js';
import ProfessionalChatThread from '../models/ProfessionalChatThread.js';
import User from '../models/User.js';
import {
  getCallRecord,
  listCallRecords,
} from '../services/proChat/callRecordService.js';

const userId = '64b000000000000000000001';
const otherUserId = '64b000000000000000000002';
const threadId = '64b000000000000000000003';
const callId = '64b000000000000000000004';
const call = {
  _id: callId,
  thread_id: threadId,
  room_name: `prochat:${threadId}:call-12345678`,
  caller_id: userId,
  participant_ids: [userId, otherUserId],
  call_type: 'voice',
  status: 'ended',
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
  started_at: new Date('2026-07-01T10:00:05.000Z'),
  ended_at: new Date('2026-07-01T10:02:05.000Z'),
  ended_by_id: otherUserId,
};

function listQuery(result) {
  return {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => result,
  };
}

function selectedQuery(result) {
  return {
    select() {
      return this;
    },
    lean: async () => result,
  };
}

test.before(() => {
  mock.method(ProfessionalCall, 'find', (filter) => {
    assert.equal(filter.participant_ids, userId);
    return listQuery([call]);
  });
  mock.method(ProfessionalCall, 'countDocuments', async () => 1);
  mock.method(ProfessionalCall, 'findOne', (filter) => ({
    lean: async () =>
      filter._id === callId && filter.participant_ids === userId ? call : null,
  }));
  mock.method(User, 'find', () =>
    selectedQuery([
      { _id: userId, first_name: 'Alex', last_name: 'Agent', role: 'agent' },
      { _id: otherUserId, first_name: 'Casey', last_name: 'Client', role: 'client' },
    ]),
  );
  mock.method(ProfessionalChatThread, 'find', () =>
    selectedQuery([{ _id: threadId, thread_type: 'dm', title: null }]),
  );
});

test('lists only the authenticated participant call records with details', async () => {
  const result = await listCallRecords({
    currentUserId: userId,
    page: 1,
    limit: 20,
    callType: 'voice',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.records.length, 1);
  assert.equal(result.body.records[0].direction, 'outgoing');
  assert.equal(result.body.records[0].duration_seconds, 120);
  assert.equal(result.body.records[0].other_participants[0].full_name, 'Casey Client');
});

test('returns an authorized call detail and rejects malformed ids', async () => {
  const detail = await getCallRecord({ currentUserId: userId, callId });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.record.id, callId);
  const invalid = await getCallRecord({ currentUserId: userId, callId: 'invalid' });
  assert.equal(invalid.status, 400);
});

test('classifies ended calls without a connection by direction', async () => {
  const originalStartedAt = call.started_at;
  const originalCallerId = call.caller_id;
  try {
    call.started_at = null;
    call.caller_id = userId;
    const outgoing = await getCallRecord({ currentUserId: userId, callId });
    assert.equal(outgoing.body.record.status, 'unanswered');

    call.caller_id = otherUserId;
    const incoming = await getCallRecord({ currentUserId: userId, callId });
    assert.equal(incoming.body.record.status, 'expired');
  } finally {
    call.started_at = originalStartedAt;
    call.caller_id = originalCallerId;
  }
});

test('validates call history filters', async () => {
  const invalidStatus = await listCallRecords({
    currentUserId: userId,
    status: 'unknown',
  });
  assert.equal(invalidStatus.status, 400);
});
