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

test('shouldHydrateLeadRecap allows first turn only', () => {
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
    false,
  );
  assert.equal(
    shouldHydrateLeadRecap({
      userMessage: 'yes everything is ok',
      aiReply: "Just to recap:\n\n- **Name:**\n\nIs everything correct?",
      interactionCount: 4,
    }),
    false,
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
