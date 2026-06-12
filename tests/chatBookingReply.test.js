import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendCalendlyBookingLink,
  userSignalsBookingIntent,
} from '../services/chat/utils/chatBookingReply.js';

test('userSignalsBookingIntent detects availability messages', () => {
  assert.equal(userSignalsBookingIntent('i will be avaialable in morning'), true);
  assert.equal(userSignalsBookingIntent('yes share available times please'), true);
  assert.equal(userSignalsBookingIntent('show me available options'), false);
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
