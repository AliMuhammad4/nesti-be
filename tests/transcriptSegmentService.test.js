import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import ProfessionalCall from '../models/ProfessionalCall.js';
import ProfessionalCallTranscriptSegment from '../models/ProfessionalCallTranscriptSegment.js';
import {
  callRelativeTranscriptTimes,
  persistFinalTranscriptSegment,
} from '../services/proChat/transcriptSegmentService.js';

let writes = 0;
let stored = null;

test.before(() => {
  mock.method(ProfessionalCall, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({ delete_at: new Date('2030-01-01T00:00:00.000Z') }),
  }));
  mock.method(ProfessionalCall, 'updateOne', async () => ({ modifiedCount: 1 }));
  mock.method(ProfessionalCallTranscriptSegment, 'updateOne', async (filter, update, options) => {
    assert.equal(options.upsert, true);
    assert.equal(filter.call_id, '64b000000000000000000004');
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

test('filler and noise segments are never persisted', async () => {
  const before = writes;
  for (const junk of ['um', 'uh...', '[inaudible]', '...', 'Thanks for watching.', 'Nesti Notetaker joined']) {
    const persisted = await persistFinalTranscriptSegment({
      callId: '64b000000000000000000004',
      segmentId: `junk:${junk}`,
      participant: { identity: 'user-1', name: 'Alex' },
      publication: { sid: 'track-1' },
      alternative: { text: junk },
      model: 'gpt-4o-mini-transcribe',
    });
    assert.equal(persisted, false, `expected reject for: ${junk}`);
  }
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

test('zero provider timestamps fall back to wall-clock elapsed since call start', () => {
  const callStartedAtMs = Date.parse('2026-07-16T12:00:00.000Z');
  const first = callRelativeTranscriptTimes(
    { startTime: 0, endTime: 0 },
    18_000,
    { nowMs: callStartedAtMs + 18_000, callStartedAtMs },
  );
  const second = callRelativeTranscriptTimes(
    { startTime: 0, endTime: 0 },
    18_000,
    { nowMs: callStartedAtMs + 42_000, callStartedAtMs },
  );
  assert.deepEqual(first, { startTimeMs: 18_000, endTimeMs: 18_000 });
  assert.deepEqual(second, { startTimeMs: 42_000, endTimeMs: 42_000 });
  assert.ok(second.startTimeMs > first.startTimeMs);
});
