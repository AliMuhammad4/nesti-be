import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendCalendlyBookingLink,
  userSignalsBookingIntent,
} from '../services/chat/utils/chatBookingReply.js';

const CALENDLY_URL = 'https://calendly.com/demo/consult';

test('userSignalsBookingIntent detects availability messages', () => {
  assert.equal(userSignalsBookingIntent('i will be avaialable in morning'), true);
  assert.equal(userSignalsBookingIntent('yes share available times please'), true);
  assert.equal(userSignalsBookingIntent('show me available options'), false);
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

test('appendCalendlyBookingLink adds markdown link when scheduling is discussed', () => {
  const url = 'https://calendly.com/agent/viewing';
  const out = appendCalendlyBookingLink(
    'Perfect! I will arrange your viewing appointment in the morning.',
    url,
    { userMessage: 'i will be available in morning' },
  );
  assert.match(out, /\[Book an appointment\]\(https:\/\/calendly\.com\/agent\/viewing\)/);
});
