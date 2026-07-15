import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import ProfessionalCall from '../models/ProfessionalCall.js';
import { authorizeParticipantTranscriptionSession } from '../services/proChat/callTranscriptionSessionService.js';

const callId = '64b000000000000000000004';
const roomName = 'prochat:thread:call';
const participantIds = ['user-1', 'user-2', 'user-3'];
const startedAt = new Date('2026-07-01T10:00:00.000Z');
let consent = false;
let participantStatus = 'invited';
let callStatus = 'active';
let hasJoinedAt = false;

test.before(() => {
  mock.method(ProfessionalCall, 'findOne', (filter) => {
    assert.equal(filter._id, callId);
    assert.equal(filter.room_name, roomName);
    assert.equal(filter.participant_ids, 'user-3');
    assert.equal(filter.participant_states.$elemMatch.user_id, 'user-3');
    assert.equal(filter.participant_states.$elemMatch.transcription_consent, true);
    assert.ok(Array.isArray(filter.participant_states.$elemMatch.$or));
    return {
      select() {
        return this;
      },
      lean: async () => {
        const statusAllowed = ['invited', 'joined'].includes(participantStatus) || hasJoinedAt;
        return consent && callStatus === filter.status && statusAllowed
          ? {
              _id: callId,
              started_at: startedAt,
              participant_ids: participantIds,
              transcription_policy_version: '2026-07',
            }
          : null;
      },
    };
  });
});

test.beforeEach(() => {
  consent = false;
  participantStatus = 'invited';
  callStatus = 'active';
  hasJoinedAt = false;
});

test('late group joiner is authorized only after current server-side consent', async () => {
  const input = {
    callId,
    roomName,
    participantIdentity: 'user-3',
    expectedParticipantIds: participantIds,
  };
  assert.equal(await authorizeParticipantTranscriptionSession(input), null);

  consent = true;
  const authorized = await authorizeParticipantTranscriptionSession(input);
  assert.equal(authorized.participant_identity, 'user-3');
  assert.equal(authorized.started_at_ms, startedAt.getTime());
});

test('stale rejoin state and dispatch snapshot tampering are rejected', async () => {
  consent = true;
  participantStatus = 'left';
  hasJoinedAt = false;
  assert.equal(
    await authorizeParticipantTranscriptionSession({
      callId,
      roomName,
      participantIdentity: 'user-3',
      expectedParticipantIds: participantIds,
    }),
    null,
  );

  participantStatus = 'invited';
  assert.equal(
    await authorizeParticipantTranscriptionSession({
      callId,
      roomName,
      participantIdentity: 'user-3',
      expectedParticipantIds: ['user-1', 'user-3'],
    }),
    null,
  );

  callStatus = 'ended';
  assert.equal(
    await authorizeParticipantTranscriptionSession({
      callId,
      roomName,
      participantIdentity: 'user-3',
      expectedParticipantIds: participantIds,
    }),
    null,
  );
});
