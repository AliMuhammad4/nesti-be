import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import ProfessionalCallTranscriptSegment from '../models/ProfessionalCallTranscriptSegment.js';
import {
  callRelativeTranscriptTimes,
  persistFinalTranscriptSegment,
} from '../services/proChat/transcriptSegmentService.js';

let writes = 0;
let stored = null;

test.before(() => {
  mock.method(ProfessionalCallTranscriptSegment, 'updateOne', async (filter, update, options) => {
    assert.equal(options.upsert, true);
    assert.deepEqual(filter, {
      call_id: '64b000000000000000000004',
      segment_id: 'participant:track:0:1',
    });
    writes += 1;
    if (!stored) {
      stored = update.$setOnInsert;
      return { upsertedCount: 1, matchedCount: 0 };
    }
    return { upsertedCount: 0, matchedCount: 1 };
  });
});

test('final segment persistence is speaker-attributed and idempotent', async () => {
  const input = {
    callId: '64b000000000000000000004',
    segmentId: 'participant:track:0:1',
    participant: { identity: 'user-1', name: 'Alex Agent' },
    publication: { sid: 'track-1' },
    alternative: {
      text: ' Send the documents. ',
      language: 'en',
      startTime: 1.25,
      endTime: 2.5,
      confidence: 0.97,
    },
    model: 'gpt-4o-mini-transcribe',
  };
  assert.equal(await persistFinalTranscriptSegment(input), true);
  assert.equal(await persistFinalTranscriptSegment(input), true);
  assert.equal(writes, 2);
  assert.equal(stored.speaker_user_id, 'user-1');
  assert.equal(stored.speaker_name, 'Alex Agent');
  assert.equal(stored.text, 'Send the documents.');
  assert.equal(stored.start_time_ms, 1250);
  assert.equal(stored.end_time_ms, 2500);
  assert.equal(stored.final, true);
});

test('blank interim-like text is never persisted', async () => {
  const before = writes;
  const persisted = await persistFinalTranscriptSegment({
    callId: '64b000000000000000000004',
    segmentId: 'blank',
    participant: { identity: 'user-1' },
    publication: { sid: 'track-1' },
    alternative: { text: '  ' },
    model: 'gpt-4o-mini-transcribe',
  });
  assert.equal(persisted, false);
  assert.equal(writes, before);
});

test('late participant offsets preserve call-relative transcript ordering', () => {
  const earlyParticipant = callRelativeTranscriptTimes(
    { startTime: 30, endTime: 31 },
    0,
  );
  const lateParticipant = callRelativeTranscriptTimes(
    { startTime: 1, endTime: 2 },
    120000,
  );
  assert.deepEqual(earlyParticipant, { startTimeMs: 30000, endTimeMs: 31000 });
  assert.deepEqual(lateParticipant, { startTimeMs: 121000, endTimeMs: 122000 });
  assert.ok(lateParticipant.startTimeMs > earlyParticipant.endTimeMs);
});
