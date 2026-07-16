import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import ProfessionalCall from '../models/ProfessionalCall.js';
import ProfessionalCallMinutes from '../models/ProfessionalCallMinutes.js';
import ProfessionalCallTranscriptSegment from '../models/ProfessionalCallTranscriptSegment.js';
import {
  chunkTranscriptSegments,
  generateMinutesFromSegments,
  normalizeMinutes,
  processMinutesForCall,
  setCallMinutesOpenAIClientForTests,
} from '../services/proChat/callMinutesService.js';

const callId = '64b000000000000000000004';
let completionCalls = 0;
let minutesStatus = 'pending';
let availableSegments = [];
let deletedMinutes = 0;
let callUpdate = null;
let existingMinutes = null;
const fakeOpenAI = {
  chat: {
    completions: {
      create: async () => {
        completionCalls += 1;
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Participants discussed documents.',
                  topics: ['Documents'],
                  decisions: [],
                  action_items: [{ owner: 'Alex', task: 'Send documents', due_date: '' }],
                  follow_ups: [],
                }),
              },
            },
          ],
        };
      },
    },
  },
};

const segments = [
  {
    _id: '64b000000000000000000005',
    speaker_name: 'Alex',
    text: `First ${'a'.repeat(850)}`,
    start_time_ms: 0,
  },
  {
    _id: '64b000000000000000000006',
    speaker_name: 'Casey',
    text: `Second ${'b'.repeat(850)}`,
    start_time_ms: 1000,
  },
  {
    _id: '64b000000000000000000007',
    speaker_name: 'Alex',
    text: `Third ${'c'.repeat(850)}`,
    start_time_ms: 2000,
  },
];

function segmentQuery(result) {
  return {
    sort() {
      return this;
    },
    lean: async () => result,
  };
}

test.before(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.CALL_MINUTES_CHUNK_CHARACTERS = '1000';
  setCallMinutesOpenAIClientForTests(fakeOpenAI);
  mock.method(ProfessionalCallMinutes, 'updateOne', async (_filter, update) => {
    if (update.$set?.status) minutesStatus = update.$set.status;
    return { modifiedCount: 1, upsertedCount: update.$setOnInsert ? 1 : 0 };
  });
  mock.method(ProfessionalCallMinutes, 'deleteOne', async () => {
    deletedMinutes += 1;
    return { deletedCount: 0 };
  });
  mock.method(ProfessionalCallMinutes, 'findOne', () => ({
    lean: async () => existingMinutes,
  }));
  mock.method(ProfessionalCallMinutes, 'findOneAndUpdate', (filter) => {
    assert.equal(filter.call_id, callId);
    assert.deepEqual(filter.status.$in, ['pending', 'failed']);
    assert.ok(filter.$and.some((clause) => clause.$or?.some((item) => 'lease_until' in item)));
    return {
      lean: async () => ({
        _id: '64b000000000000000000008',
        call_id: callId,
        attempts: 1,
        status: 'processing',
      }),
    };
  });
  mock.method(ProfessionalCall, 'updateOne', async (_filter, update) => {
    callUpdate = update;
    return { modifiedCount: 1 };
  });
  mock.method(ProfessionalCallTranscriptSegment, 'find', () =>
    segmentQuery(availableSegments),
  );
});

test.beforeEach(() => {
  availableSegments = segments;
  deletedMinutes = 0;
  callUpdate = null;
  existingMinutes = null;
});

test('long transcripts are bounded into speaker-attributed chunks', () => {
  const chunks = chunkTranscriptSegments(segments, 1000);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.every((chunk) => chunk.length <= 1000), true);
  assert.match(chunks[0], /Alex:/);
});

test('structured minutes normalization removes malformed content', () => {
  const normalized = normalizeMinutes({
    summary: ' **Summary** about documents ',
    topics: [' Topic ', null, 'Nesti Notetaker joined'],
    action_items: [{ task: ' Do it ', owner: 'Alex' }, { owner: 'Nobody' }],
    follow_ups: ['- Follow up tomorrow', 'this call was transcribed'],
  });
  assert.equal(normalized.summary, 'Summary about documents');
  assert.deepEqual(normalized.topics, ['Topic']);
  assert.deepEqual(normalized.action_items, [
    { owner: 'Alex', task: 'Do it', due_date: '' },
  ]);
  assert.deepEqual(normalized.follow_ups, ['Follow up tomorrow']);
});

test('long transcript generation performs hierarchical reconciliation', async () => {
  const before = completionCalls;
  const generated = await generateMinutesFromSegments(segments);
  assert.ok(generated.chunkCount >= 3);
  assert.ok(completionCalls - before > generated.chunkCount);
  assert.equal(generated.minutes.action_items[0].task, 'Send documents');
});

test('minutes processing uses an atomic lease and publishes ready state', async () => {
  minutesStatus = 'pending';
  const processed = await processMinutesForCall({
    _id: callId,
    thread_id: '64b000000000000000000003',
    room_name: 'prochat:thread:call',
    participant_ids: ['user-1', 'user-2'],
    transcription_status: 'completed',
    ended_at: new Date(),
    delete_at: new Date(Date.now() + 60000),
  });
  assert.equal(processed, true);
  assert.equal(minutesStatus, 'ready');
});

test('ready minutes are not regenerated for the same transcript version', async () => {
  const transcriptUpdatedAt = new Date();
  existingMinutes = {
    status: 'ready',
    transcript_segment_count: segments.length,
    transcript_version_at: transcriptUpdatedAt,
  };
  const before = completionCalls;
  const processed = await processMinutesForCall({
    _id: callId,
    transcript_updated_at: transcriptUpdatedAt,
    ended_at: new Date(),
  });
  assert.equal(processed, false);
  assert.equal(completionCalls, before);
});

test('terminal call without transcript creates no minutes artifact', async () => {
  availableSegments = [];
  const before = completionCalls;
  const processed = await processMinutesForCall({
    _id: callId,
    transcription_status: 'completed',
    ended_at: new Date(),
  });
  assert.equal(processed, false);
  assert.equal(completionCalls, before);
  assert.equal(deletedMinutes, 1);
  assert.equal(callUpdate.$set.transcription_status, 'completed');
  assert.equal(callUpdate.$set.minutes_status, 'not_ready');
  assert.equal(callUpdate.$set.transcription_error_code, 'no_transcript_segments');
});
