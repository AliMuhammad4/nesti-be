import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendCalendlyBookingLink,
  holdFurtherQuestions,
  offerConsultationAfterSkippedUpload,
  stripBookingLinks,
  visitorSkipsDocumentRequest,
  userSignalsBookingIntent,
} from '../services/chat/utils/chatBookingReply.js';

const CALENDLY_URL = 'https://calendly.com/demo/consult';

test('userSignalsBookingIntent detects availability messages', () => {
  assert.equal(userSignalsBookingIntent('i will be avaialable in morning'), true);
  assert.equal(userSignalsBookingIntent('yes share available times please'), true);
  assert.equal(userSignalsBookingIntent('can you have a meting with me'), true);
  assert.equal(userSignalsBookingIntent('show me available options'), false);
  assert.equal(userSignalsBookingIntent('If approved tomorrow, I would maybe start house hunting. My email is a@b.com and my phone is 555.'), false);
});

test('only clear deferrals or meeting requests skip a document request', () => {
  assert.equal(visitorSkipsDocumentRequest('Can I send the proof of funds next week?'), false);
  assert.equal(visitorSkipsDocumentRequest('I have a question about the documents'), false);
  assert.equal(visitorSkipsDocumentRequest('I will upload the documents later'), true);
  assert.equal(visitorSkipsDocumentRequest("I don't have the proof of funds"), true);
  assert.equal(visitorSkipsDocumentRequest("I don't have the pay stubs right now", 'Recent pay stubs'), true);
  assert.equal(visitorSkipsDocumentRequest('Can we meet tomorrow?'), true);
});

test('a meeting request drops the next question and can carry the booking link', () => {
  const held = holdFurtherQuestions(
    'I can arrange a consultation. What financing amount are you considering? Please upload the recent pay stubs here.',
    'can you have a meting with me',
  );
  assert.equal(held, 'I can arrange a consultation.');
  assert.doesNotMatch(held, /upload|financing amount/i);
  const linked = appendCalendlyBookingLink(held, CALENDLY_URL, { userMessage: 'can you have a meting with me' });
  assert.match(linked, /\[Book an appointment\]\(https:\/\/calendly\.com\/demo\/consult\)/);
  const later = holdFurtherQuestions(
    'That works. Have you already obtained a mortgage pre-approval? Please upload the recent pay stubs here.',
    'i will upload documents later',
  );
  assert.equal(later, 'That works.');
});

test('a skipped upload ends with the consultation link', () => {
  const linked = offerConsultationAfterSkippedUpload('I can keep going with what you shared.', CALENDLY_URL, {
    label: 'Book a consultation',
  });
  assert.match(linked, /documents whenever they are ready/i);
  assert.match(linked, /\[Book a consultation\]\(https:\/\/calendly\.com\/demo\/consult\)/);
  const blocked = offerConsultationAfterSkippedUpload('I can keep going.', CALENDLY_URL, { allowSchedule: false });
  assert.equal(blocked.includes(CALENDLY_URL), false);
  assert.doesNotMatch(blocked, /pick a time|meeting|appointment/i);
  assert.match(blocked, /send the documents whenever they are ready/i);
});

test('stripBookingLinks removes generated Calendly links in markdown and plain text', () => {
  assert.equal(
    stripBookingLinks('Book here: [Schedule](https://calendly.com/demo/consult)'),
    'Book here:',
  );
  assert.equal(
    stripBookingLinks('Book here: https://calendly.com/demo/consult.'),
    'Book here:',
  );
  assert.equal(
    stripBookingLinks('Read more: [Property guide](https://example.com/guide)'),
    'Read more: [Property guide](https://example.com/guide)',
  );
  assert.equal(
    stripBookingLinks('Schedule here: https://booking.example/agent', 'https://booking.example/agent'),
    'Schedule here:',
  );
});

test('appendCalendlyBookingLink does not attach a link when scheduling is off', () => {
  const out = appendCalendlyBookingLink('Sure, I can help with that.', CALENDLY_URL, {
    userMessage: 'Can you share available times?',
    allowSchedule: false,
  });
  assert.equal(out.includes(CALENDLY_URL), false);
  assert.doesNotMatch(out, /Book an appointment/);
});

test('appendCalendlyBookingLink appends when user asks for available times', () => {
  const out = appendCalendlyBookingLink('Sure, I can help with that.', CALENDLY_URL, {
    userMessage: 'Can you share available times?',
  });
  assert.match(out, /\[Book an appointment\]\(https:\/\/calendly\.com\/demo\/consult\)/);
});

test('appendCalendlyBookingLink does not append from assistant booking-ready text alone', () => {
  const out = appendCalendlyBookingLink('Great - please choose a time that works best for you.', CALENDLY_URL, {
    userMessage: 'yes',
  });
  assert.match(out, /\[Book an appointment\]\(https:\/\/calendly\.com\/demo\/consult\)/);
});

test('appendCalendlyBookingLink does not duplicate existing markdown link', () => {
  const input = 'Great - please choose a time.\n\n[Book an appointment](https://calendly.com/demo/consult)';
  const out = appendCalendlyBookingLink(input, CALENDLY_URL, { userMessage: 'yes' });
  const matches = out.match(/\[Book an appointment\]\(https:\/\/calendly\.com\/demo\/consult\)/g) || [];
  assert.equal(matches.length, 1);
});

test('appendCalendlyBookingLink does not append while collecting contact preferences', () => {
  const out = appendCalendlyBookingLink(
    'Also, how would you like the broker to contact you, and what is the best time to reach you?',
    CALENDLY_URL,
    { userMessage: 'yes share available times' },
  );
  assert.doesNotMatch(out, /\[Book an appointment\]\(https:\/\/calendly\.com\/demo\/consult\)/);
});

test('appendCalendlyBookingLink uses the professional call-to-action label when provided', () => {
  const out = appendCalendlyBookingLink('Sure, I can help with that.', CALENDLY_URL, {
    userMessage: 'Can you share available times?',
    label: 'Book an Investment Consultation',
  });
  assert.match(out, /\[Book an Investment Consultation\]\(https:\/\/calendly\.com\/demo\/consult\)/);
  assert.doesNotMatch(out, /\[Book an appointment\]/);
  const again = appendCalendlyBookingLink(out, CALENDLY_URL, { userMessage: 'yes', label: 'Book an Investment Consultation' });
  assert.equal((again.match(/calendly\.com\/demo\/consult/g) || []).length, 1);
});

test('appendCalendlyBookingLink adds markdown link when scheduling is discussed', () => {
  const url = 'https://calendly.com/agent/viewing';
  const out = appendCalendlyBookingLink(
    'Perfect! I will arrange your viewing appointment in the morning.',
    url,
    { userMessage: 'i will be available in morning' },
  );
  assert.match(out, /\[Book an appointment\]\(https:\/\/calendly\.com\/agent\/viewing\)/);
});
