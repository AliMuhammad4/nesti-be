import test from 'node:test';
import assert from 'node:assert/strict';
import { withOccasionalEmoji } from '../services/professionalAssistant/assistantEmoji.js';
import { buildLeadRecapMarkdownLines } from '../services/chat/utils/leadRecapMarkdown.js';

test('withOccasionalEmoji does not append calendar emoji when Calendly booking card markdown is present', () => {
  const reply = 'To proceed, I can arrange a viewing.\n\n[Book a Buyer Consultation](https://calendly.com/demo/buyer)';
  const out = withOccasionalEmoji(reply, { use_emojis: true }, {
    userMessage: 'I am interested in testing 4',
    previousReply: '',
  });
  assert.equal(/\p{Extended_Pictographic}/u.test(out), false);
  assert.match(out, /calendly\.com\/demo\/buyer/i);
});

test('lead recap humanizes under_400k budget slug', () => {
  const lines = buildLeadRecapMarkdownLines({
    form: {
      name: 'Esse Au',
      location: 'lahore',
      budget: 'under_400k',
      timeline: '1-3 months',
      property_type: 'Single Family',
    },
    contact: { name: 'Esse Au' },
    intent: 'buy',
    compact: true,
  });
  const joined = lines.join('\n');
  assert.match(joined, /Under \$400K/i);
  assert.doesNotMatch(joined, /under_400k/);
});
