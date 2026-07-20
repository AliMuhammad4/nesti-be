import test from 'node:test';
import assert from 'node:assert/strict';
import {
  containsNonLatinScript,
  createCallEchoTracker,
  isDuplicateTranscript,
  passesTranscriptionConfidence,
  shouldPersistTranscriptAlternative,
} from '../workers/lib/transcriptionQuality.js';
import { fallbackMinutesFromSegments } from '../services/proChat/callMinutesFormatting.js';

test('containsNonLatinScript detects non-Latin script', () => {
  assert.equal(containsNonLatinScript('Deploy on Render'), false);
  assert.equal(containsNonLatinScript('So backend کو deploy'), true);
});

test('passesTranscriptionConfidence drops explicit low scores only', () => {
  assert.equal(
    passesTranscriptionConfidence({ text: 'hello', confidence: 0.92 }, 0.55),
    true,
  );
  assert.equal(
    passesTranscriptionConfidence({ text: 'Pega.', confidence: 0.4 }, 0.55),
    false,
  );
  assert.equal(passesTranscriptionConfidence({ text: 'hello' }, 0.55), true);
});

test('shouldPersistTranscriptAlternative combines confidence and duplicate checks', () => {
  assert.equal(
    shouldPersistTranscriptAlternative(
      { text: 'hello', confidence: 0.3 },
      { previousText: '' },
    ),
    false,
  );
  assert.equal(
    shouldPersistTranscriptAlternative(
      { text: 'hello', confidence: 0.95 },
      { previousText: 'hello' },
    ),
    false,
  );
  assert.equal(
    shouldPersistTranscriptAlternative(
      { text: 'My name is Ali.', confidence: 0.95 },
      { previousText: '' },
    ),
    true,
  );
  assert.equal(
    shouldPersistTranscriptAlternative(
      { text: 'はい。', confidence: 1 },
      { previousText: '' },
    ),
    false,
  );
  assert.equal(
    shouldPersistTranscriptAlternative(
      { text: 'Pega.', confidence: 1 },
      { previousText: '' },
    ),
    false,
  );
});

test('echo tracker drops short English bleed lines', () => {
  const tracker = createCallEchoTracker({ windowMs: 8000 });
  tracker.remember({
    speakerId: 'ali',
    text: 'and you can call me anytime',
    startTimeMs: 112000,
  });
  assert.equal(
    tracker.isEcho({
      speakerId: 'ahmed',
      text: 'you can call me anytime',
      startTimeMs: 112100,
    }),
    true,
  );
});

test('echo tracker drops delayed near-duplicates within wider window', () => {
  const tracker = createCallEchoTracker({ windowMs: 8000 });
  tracker.remember({
    speakerId: 'ali',
    text: 'There is a school near the house and children can easily go to school.',
    startTimeMs: 60000,
  });
  assert.equal(
    tracker.isEcho({
      speakerId: 'ahmed',
      text: 'where like there is a school near the house and children can easily go to school',
      startTimeMs: 66000,
    }),
    true,
  );
});

test('duplicate transcript detection catches stuttered finals', () => {
  assert.equal(isDuplicateTranscript('Available.', 'Available.'), true);
  assert.equal(isDuplicateTranscript('Available.', 'Available now.'), true);
  assert.equal(isDuplicateTranscript('Hello there', 'Goodbye'), false);
});

test('echo tracker drops cross-speaker bleed', () => {
  const tracker = createCallEchoTracker({ windowMs: 3500 });
  tracker.remember({
    speakerId: 'ali',
    text: 'And for printing I have been using a version',
    startTimeMs: 32000,
  });
  assert.equal(
    tracker.isEcho({
      speakerId: 'ahmed',
      text: 'And for printing I have been using our version.',
      startTimeMs: 32000,
    }),
    true,
  );
  assert.equal(
    tracker.isEcho({
      speakerId: 'ahmed',
      text: 'We deployed the backend on Render yesterday.',
      startTimeMs: 45000,
    }),
    false,
  );
});

test('echo tracker drops near-duplicate Urdu bleed', () => {
  const tracker = createCallEchoTracker({ windowMs: 5000 });
  tracker.remember({
    speakerId: 'ali',
    text: 'کیا حال چال؟',
    startTimeMs: 15800,
  });
  assert.equal(
    tracker.isEcho({
      speakerId: 'ahmed',
      text: 'کیا حال چہ?',
      startTimeMs: 15850,
    }),
    true,
  );
});

test('echo tracker drops near-simultaneous cross-script bleed', () => {
  // Same short utterance bled into both mics but STT auto-detected a
  // different language per channel, so text/script comparison alone misses it.
  const tracker = createCallEchoTracker({ windowMs: 8000 });
  tracker.remember({
    speakerId: 'ali',
    text: 'So if you have property available in Lahore.',
    startTimeMs: 54936,
  });
  assert.equal(
    tracker.isEcho({
      speakerId: 'ahmed',
      text: 'سو اگر آپ کو پراپرٹی دستیاب ہے.',
      startTimeMs: 54992,
    }),
    true,
  );
});

test('echo tracker keeps a later cross-script reply, not just bled audio', () => {
  // A real reply a full second later is normal conversation, not mic bleed.
  const tracker = createCallEchoTracker({ windowMs: 8000 });
  tracker.remember({
    speakerId: 'ali',
    text: 'پراپرٹی ہویا۔',
    startTimeMs: 64245,
  });
  assert.equal(
    tracker.isEcho({
      speakerId: 'ahmed',
      text: 'property.',
      startTimeMs: 65286,
    }),
    false,
  );
});

test('echo tracker keeps distinct same-script content spoken close together', () => {
  const tracker = createCallEchoTracker({ windowMs: 8000 });
  tracker.remember({
    speakerId: 'ali',
    text: 'Iran-Israeli war.',
    startTimeMs: 9004,
  });
  assert.equal(
    tracker.isEcho({
      speakerId: 'ahmed',
      text: 'Iran is very hot.',
      startTimeMs: 9180,
    }),
    false,
  );
});

test('fallbackMinutesFromSegments builds a summary from real speech', () => {
  const minutes = fallbackMinutesFromSegments([
    { speaker_name: 'Ali', text: 'Is the unit available?' },
    { speaker_name: 'Ahmed', text: 'Yes, from Monday.' },
  ]);
  assert.ok(minutes?.summary);
  assert.match(minutes.summary, /Ali|Ahmed|available/i);
});
