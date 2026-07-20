import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferLanguageFromText,
  isAllowedCallTranscriptScript,
  looksLikeLatinSttGibberish,
  refineTranscriptSegmentText,
  resolveSegmentLanguage,
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

test('shouldPersistTranscriptText drops only empty STT noise tokens', () => {
  assert.equal(shouldPersistTranscriptText('um'), false);
  assert.equal(shouldPersistTranscriptText('...'), false);
  assert.equal(shouldPersistTranscriptText('[inaudible]'), false);
  assert.equal(shouldPersistTranscriptText('Send the documents tomorrow.'), true);
  assert.equal(shouldPersistTranscriptText('Yeah.'), true);
  assert.equal(shouldPersistTranscriptText('Hello, how can I assist you?'), true);
  assert.equal(shouldPersistTranscriptText('projection'), true);
});

test('isAllowedCallTranscriptScript keeps English/Urdu and drops CJK/Bengali junk', () => {
  assert.equal(isAllowedCallTranscriptScript('hello'), true);
  assert.equal(isAllowedCallTranscriptScript('اسلام علیکم'), true);
  assert.equal(
    isAllowedCallTranscriptScript('کیا مسٹر، I can make arrangement for you.'),
    true,
  );
  assert.equal(isAllowedCallTranscriptScript('はい。'), false);
  assert.equal(isAllowedCallTranscriptScript('বাজার করতে গিয়ে'), false);
});

test('looksLikeLatinSttGibberish drops short high-confidence nonsense', () => {
  assert.equal(looksLikeLatinSttGibberish('Pega.'), true);
  assert.equal(looksLikeLatinSttGibberish('Ndozoa aki.'), true);
  assert.equal(looksLikeLatinSttGibberish('Yes.'), false);
  assert.equal(looksLikeLatinSttGibberish('Hello'), false);
  assert.equal(looksLikeLatinSttGibberish('My name is Muhammad Ali.'), false);
  assert.equal(looksLikeLatinSttGibberish('اسلام علیکم'), false);
  assert.equal(shouldPersistTranscriptText('Pega.'), false);
  assert.equal(shouldPersistTranscriptText('Ndozoa aki.'), false);
});

test('refineTranscriptSegmentText returns cleaned keepers only', () => {
  assert.equal(refineTranscriptSegmentText('  Send documents.  '), 'Send documents.');
  assert.equal(refineTranscriptSegmentText('uh'), '');
});

test('stripMinutesMarkup removes decorative markdown', () => {
  assert.equal(stripMinutesMarkup('**Bold** topic'), 'Bold topic');
  assert.equal(stripMinutesMarkup('- Next step'), 'Next step');
});

test('inferLanguageFromText detects Urdu, English, and mixed speech', () => {
  assert.equal(inferLanguageFromText('Hello, how are you?'), 'en');
  assert.equal(inferLanguageFromText('اسلام علیکم'), 'ur');
  assert.equal(
    inferLanguageFromText('کیا مسٹر محمد علی، I can make arrangement for you.'),
    'mixed',
  );
});

test('resolveSegmentLanguage prefers script inference over wrong STT tags', () => {
  assert.equal(
    resolveSegmentLanguage({ text: 'اسلام علیکم', language: 'en' }),
    'ur',
  );
  assert.equal(
    resolveSegmentLanguage({ text: 'My name is Ali.', language: 'en' }),
    'en',
  );
});
