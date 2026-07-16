import test from 'node:test';
import assert from 'node:assert/strict';
import {
  refineTranscriptSegmentText,
  sanitizeTranscriptText,
  shouldPersistTranscriptText,
  stripMinutesMarkup,
} from '../services/proChat/transcriptTextCleaning.js';

test('sanitizeTranscriptText collapses whitespace and zero-width junk', () => {
  assert.equal(
    sanitizeTranscriptText('  Hello\u200B   world\nthere  '),
    'Hello world there',
  );
});

test('shouldPersistTranscriptText drops fillers noise and hallucinations', () => {
  assert.equal(shouldPersistTranscriptText('um'), false);
  assert.equal(shouldPersistTranscriptText('...'), false);
  assert.equal(shouldPersistTranscriptText('[inaudible]'), false);
  assert.equal(shouldPersistTranscriptText('Thanks for watching.'), false);
  assert.equal(shouldPersistTranscriptText('Nesti Notetaker is listening'), false);
  assert.equal(shouldPersistTranscriptText('Nesti Minutes joined'), false);
  assert.equal(shouldPersistTranscriptText('Minutes later we can review the offer.'), true);
  assert.equal(shouldPersistTranscriptText('Yeah.'), true);
  assert.equal(shouldPersistTranscriptText('Okay.'), true);
  assert.equal(shouldPersistTranscriptText('Send the documents tomorrow.'), true);
});

test('refineTranscriptSegmentText returns cleaned keepers only', () => {
  assert.equal(refineTranscriptSegmentText('  Send documents.  '), 'Send documents.');
  assert.equal(refineTranscriptSegmentText('uh'), '');
});

test('stripMinutesMarkup removes decorative markdown', () => {
  assert.equal(stripMinutesMarkup('**Bold** topic'), 'Bold topic');
  assert.equal(stripMinutesMarkup('- Next step'), 'Next step');
});
