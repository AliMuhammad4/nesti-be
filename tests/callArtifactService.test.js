import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import ProfessionalCall from '../models/ProfessionalCall.js';
import ProfessionalCallMinutes from '../models/ProfessionalCallMinutes.js';
import ProfessionalCallTranscriptSegment from '../models/ProfessionalCallTranscriptSegment.js';
import {
  getCallArtifactStatus,
  getCallMinutes,
  getCallTranscript,
} from '../services/proChat/callArtifactService.js';

const userId = '64b000000000000000000001';
const otherUserId = '64b000000000000000000002';
const callId = '64b000000000000000000004';
const call = {
  _id: callId,
  participant_ids: [userId, otherUserId],
  participant_states: [
    { user_id: userId, transcription_consent: true },
    { user_id: otherUserId, transcription_consent: false },
  ],
  transcription_policy_version: '2026-07',
  transcription_status: 'completed',
  minutes_status: 'ready',
};
const segment = {
  _id: '64b000000000000000000005',
  segment_id: 'speaker:track:0:1',
  speaker_user_id: userId,
  speaker_name: 'Alex Agent',
  text: 'We agreed to send the documents.',
  language: 'en',
  start_time_ms: 1200,
  end_time_ms: 3400,
  confidence: 0.98,
};

function transcriptQuery(result) {
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

test.before(() => {
  mock.method(ProfessionalCall, 'findOne', (filter) => ({
    lean: async () =>
      filter._id === callId && call.participant_ids.includes(filter.participant_ids)
        ? call
        : null,
  }));
  mock.method(ProfessionalCallTranscriptSegment, 'find', () => transcriptQuery([segment]));
  mock.method(ProfessionalCallTranscriptSegment, 'countDocuments', async () => 1);
  mock.method(ProfessionalCallMinutes, 'findOne', () => ({
    lean: async () => ({
      call_id: callId,
      status: 'ready',
      summary: 'Documents will be sent.',
      topics: ['Documents'],
      decisions: ['Send documents'],
      action_items: [{ owner: 'Alex', task: 'Send documents', due_date: '' }],
      follow_ups: [],
      model: 'gpt-4.1-mini',
      prompt_version: 'call-minutes-v1',
      ready_at: new Date('2026-07-01T10:05:00.000Z'),
    }),
  }));
});

test('consenting participant can read artifact status, transcript, and minutes', async () => {
  const status = await getCallArtifactStatus({ currentUserId: userId, callId });
  assert.equal(status.status, 200);
  assert.equal(status.body.artifacts.transcript_segment_count, 1);
  assert.equal(status.body.artifacts.minutes_status, 'ready');

  const transcript = await getCallTranscript({
    currentUserId: userId,
    callId,
    page: 1,
    limit: 25,
  });
  assert.equal(transcript.status, 200);
  assert.equal(transcript.body.segments[0].speaker_name, 'Alex Agent');
  assert.equal(transcript.body.pagination.total, 1);

  const minutes = await getCallMinutes({ currentUserId: userId, callId });
  assert.equal(minutes.status, 200);
  assert.equal(minutes.body.minutes.summary, 'Documents will be sent.');
  assert.equal(minutes.body.minutes.action_items[0].task, 'Send documents');
});

test('non-consenting participant cannot read transcript or minutes', async () => {
  const status = await getCallArtifactStatus({ currentUserId: otherUserId, callId });
  assert.equal(status.status, 403);
  assert.equal(status.body.code, 'viewer_no_transcription_consent');

  const transcript = await getCallTranscript({
    currentUserId: otherUserId,
    callId,
  });
  assert.equal(transcript.status, 403);
  assert.equal(transcript.body.code, 'viewer_no_transcription_consent');

  const minutes = await getCallMinutes({ currentUserId: otherUserId, callId });
  assert.equal(minutes.status, 403);
  assert.equal(minutes.body.code, 'viewer_no_transcription_consent');
});

test('non-participants and malformed ids cannot access artifacts', async () => {
  const forbidden = await getCallTranscript({
    currentUserId: '64b000000000000000000009',
    callId,
  });
  assert.equal(forbidden.status, 404);
  const malformed = await getCallMinutes({ currentUserId: userId, callId: 'bad' });
  assert.equal(malformed.status, 400);
});
