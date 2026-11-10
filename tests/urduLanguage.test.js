/**
 * Urdu support: detection (vs Arabic, same script), reply copy rows, document names and the warm greeting.
 * Urdu can be chosen in the language settings (catalog.js LANGUAGES) and is still auto-detected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { looksUrdu, replyLanguage, turnFallbackReply, withWarmGreeting } from '../services/professionalAssistant/replyStyle.js';
import {
  BOOKING_COPY,
  DECLINE_WORDS_RE,
  DETECTED_LANGUAGE_NAMES,
  DOCUMENT_WORDS_RE,
  INVESTOR_OPENING_QUESTION,
  MEETING_WORDS_RE,
  PAUSE_COPY,
  SHORT_DECLINE_RE,
  TURN_FALLBACK,
  localizedCopy,
} from '../services/professionalAssistant/localizedReplyCopy.js';
import { DOCUMENT_NAMES, localizedDocumentName } from '../services/chat/documents/documentCoverage.js';
import { isGreetingOnly } from '../services/professionalAssistant/visitorMessage.js';
import { LANGUAGES } from '../services/professionalAssistant/catalog.js';

const AUTO = { auto_detect_language: true, languages: ['english'] };

test('Urdu vs Arabic: same script, told apart by Urdu-only and Arabic-only letters', () => {
  const urdu = [
    'مجھے کراچی میں گھر خریدنا ہے',
    'السلام علیکم، میں مکان لینا چاہتا ہوں',
    'نہیں شکریہ',
    'ہاں',
    'جی',
    'ٹھیک ہے',
    'Hi, mujhe Lahore mein ghar chahiye، شکریہ', // mixed Roman + Urdu script
  ];
  const arabic = [
    'السلام عليكم، أريد شراء منزل',
    'مرحبا، كم سعر هذا البيت؟',
    'نعم',
    'شكرا جزيلا',
    'هل يمكنني حجز موعد؟',
  ];
  for (const text of urdu) {
    assert.equal(looksUrdu(text), true, `urdu: ${text}`);
    assert.equal(replyLanguage(AUTO, text), 'urdu', `reply language for: ${text}`);
  }
  for (const text of arabic) {
    assert.equal(looksUrdu(text), false, `arabic: ${text}`);
    assert.equal(replyLanguage(AUTO, text), 'arabic', `reply language for: ${text}`);
  }
  assert.equal(looksUrdu('I want to buy a house in Karachi'), false);
  assert.equal(replyLanguage(AUTO, 'Hello'), 'english');
});

test('Urdu is auto-detected even when not selected, and a short follow-up keeps it', () => {
  assert.equal(replyLanguage({ auto_detect_language: true, languages: ['english', 'french'] }, 'مجھے گھر چاہیے'), 'urdu');
  assert.equal(replyLanguage(AUTO, 'ok', 'مجھے کراچی میں گھر خریدنا ہے'), 'urdu');
  assert.equal(replyLanguage({ auto_detect_language: false, languages: ['english'] }, 'مجھے گھر چاہیے'), 'english');
});

test('Urdu reply copy rows exist and are Urdu script', () => {
  for (const table of [BOOKING_COPY, PAUSE_COPY, TURN_FALLBACK, INVESTOR_OPENING_QUESTION]) {
    const row = localizedCopy(table, 'urdu');
    assert.ok(row, 'urdu row');
    assert.ok(looksUrdu(JSON.stringify(row)), 'row is Urdu');
  }
  for (const key of Object.keys(TURN_FALLBACK.english)) {
    assert.ok(turnFallbackReply(key, 'urdu'), `urdu fallback ${key}`);
  }
  assert.equal(DETECTED_LANGUAGE_NAMES.urdu, 'Urdu');
});

test('Urdu visitor words: decline, short decline, documents, meeting', () => {
  assert.match('ابھی نہیں', DECLINE_WORDS_RE);
  // Same shape as English: a bare "no" is not a short decline, "not now" / "no thanks" phrasing is.
  assert.match('ابھی نہیں', SHORT_DECLINE_RE);
  assert.match('نہیں، شکریہ', SHORT_DECLINE_RE);
  assert.match('بعد میں', SHORT_DECLINE_RE);
  assert.match('میں دستاویزات بھیج دوں گا', DOCUMENT_WORDS_RE);
  assert.match('کیا ہم ملاقات رکھ سکتے ہیں؟', MEETING_WORDS_RE);
});

test('Urdu document names cover every document id', () => {
  for (const id of Object.keys(DOCUMENT_NAMES.english)) {
    const name = localizedDocumentName(id, 'urdu');
    assert.ok(name && name !== DOCUMENT_NAMES.english[id], `urdu name for ${id}`);
  }
});

test('Urdu greeting-only message gets the Urdu warm hello', () => {
  const out = withWarmGreeting('میں آپ کی کیسے مدد کر سکتا ہوں؟', AUTO, 'السلام علیکم');
  assert.match(out, /السلام علیکم، خوش آمدید/);
  assert.equal(isGreetingOnly('السلام علیکم'), true);
  assert.equal(isGreetingOnly('آداب!'), true);
  // A reply that already opens with the Urdu salaam is not greeted twice.
  assert.equal(withWarmGreeting('السلام علیکم! میں مدد کر سکتا ہوں۔', AUTO, 'السلام علیکم'), 'السلام علیکم! میں مدد کر سکتا ہوں۔');
});

test('Urdu is a selectable catalog language (auto-detect still works)', () => {
  assert.equal(LANGUAGES.some(([id]) => id === 'urdu'), true);
});
