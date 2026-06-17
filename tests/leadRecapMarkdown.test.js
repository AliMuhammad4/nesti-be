import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeadRecapMarkdownLines,
  injectLeadRecapIntoReply,
  shouldHydrateLeadRecap,
} from '../services/chat/utils/leadRecapMarkdown.js';

const sampleRecap = buildLeadRecapMarkdownLines({
  form: { name: 'Jane', email: 'jane@example.com', budget: 'under_400k' },
  contact: {},
  extracted: {},
  intent: 'buy',
});

test('shouldHydrateLeadRecap always allows recap hydration pass', () => {
  assert.equal(
    shouldHydrateLeadRecap({
      userMessage: 'Hi, I want to buy',
      aiReply: 'Thanks!',
      interactionCount: 1,
    }),
    true,
  );
  assert.equal(
    shouldHydrateLeadRecap({
      userMessage: 'what is supposed to discuss in meeting?',
      aiReply: 'You can expect to discuss financing.',
      interactionCount: 2,
    }),
    true,
  );
  assert.equal(
    shouldHydrateLeadRecap({
      userMessage: 'yes everything is ok',
      aiReply: "Just to recap:\n\n- **Name:**\n\nIs everything correct?",
      interactionCount: 4,
    }),
    true,
  );
});

test('injectLeadRecapIntoReply does not replace generic meeting bullets', () => {
  const reply =
    "That's a great question! In the meeting you can expect to discuss:\n\n- Your financing situation\n- Timeline and next steps";
  const out = injectLeadRecapIntoReply(reply, sampleRecap);
  assert.equal(out, reply);
  assert.doesNotMatch(out, /\*\*Name:\*\*/);
});

test('injectLeadRecapIntoReply hydrates hollow recap bullets', () => {
  const reply =
    "Here's what you've shared so far:\n\n- **Name:**\n- **Email:**\n\nIs everything correct?";
  const out = injectLeadRecapIntoReply(reply, sampleRecap);
  assert.match(out, /\*\*Name:\*\* Jane/);
  assert.match(out, /\*\*Email:\*\* jane@example.com/);
  assert.doesNotMatch(out, /\*\*Name:\*\*\s*$/m);
});

test('injectLeadRecapIntoReply replaces prose recap with structured bullets', () => {
  const reply = `Hi! Great to meet you. You're looking for pre-approval in 1-2 months with a budget of $400k-$700k.

Could you please confirm if this is correct?

Also, what is the best time to contact you?`;
  const out = injectLeadRecapIntoReply(reply, sampleRecap);
  assert.match(out, /^Here's what you've shared so far:/);
  assert.match(out, /\*\*Name:\*\* Jane/);
  assert.match(out, /Could you please confirm if this is correct\?/);
  assert.doesNotMatch(out, /Great to meet you\. You're looking for pre-approval/);
});

test('injectLeadRecapIntoReply formats smart-quote quick recap prose', () => {
  const reply = `Thank you for sharing. Here’s a quick recap: You’re looking for mortgage pre-approval in 1-2 months with a budget under $400k.

Please confirm if everything looks correct.`;
  const out = injectLeadRecapIntoReply(reply, sampleRecap);
  assert.match(out, /^Here's what you've shared so far:/);
  assert.match(out, /\*\*Name:\*\* Jane/);
  assert.match(out, /Please confirm if everything looks correct\./);
  assert.doesNotMatch(out, /Here’s a quick recap:/);
});

test('injectLeadRecapIntoReply removes contact-preference ask from recap turn', () => {
  const reply = `Here’s what I have so far:

- **Name:**
- **Email:**

Please confirm if everything looks correct or if there’s anything you'd like to adjust.

Additionally, how would you prefer I contact you, and what is the best time to reach you?`;
  const out = injectLeadRecapIntoReply(reply, sampleRecap);
  assert.match(out, /\*\*Name:\*\* Jane/);
  assert.match(out, /everything looks correct|change any details/i);
  assert.doesNotMatch(out, /how would you prefer i contact you/i);
  assert.doesNotMatch(out, /best time to reach you/i);
});
