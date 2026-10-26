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

test('a saved assistant recap keeps only the short lead facts', () => {
  const lines = buildLeadRecapMarkdownLines({
    form: {
      name: 'Jane',
      email: 'jane@example.com',
      phone: '555-0100',
      location: 'Toronto',
      budget: '400k',
      timeline: '1-3 months',
      property_type: 'condo',
      bedrooms: '2',
      mortgage_status: 'not_yet',
      realtor_status: 'no_agent',
      motivation_reason: 'relocation',
    },
    contact: {},
    extracted: {},
    intent: 'buy',
    compact: true,
  });
  const text = lines.join('\n');
  assert.match(text, /\*\*Name:\*\* Jane/);
  assert.match(text, /\*\*Location:\*\* Toronto/);
  assert.match(text, /\*\*Budget:\*\* 400k/);
  assert.match(text, /\*\*Timeline:\*\*/);
  assert.match(text, /\*\*Property type:\*\* condo/);
  assert.equal(lines.length, 5);
  assert.doesNotMatch(text, /Email|Phone|Mortgage|Realtor|Bedrooms|Reason for move/);
});

test('a lawyer recap keeps legal fields when the short agent recap is off', () => {
  const lines = buildLeadRecapMarkdownLines({
    form: {
      name: 'Ada',
      professionalType: 'lawyer',
      transaction_stage: 'offer_accepted',
      closing_timeline: 'within_30_days',
      legal_services_needed: 'purchase_closing',
    },
    contact: {},
    extracted: {},
    intent: 'buy',
  });
  const text = lines.join('\n');
  assert.match(text, /Transaction stage/);
  assert.match(text, /Closing timeline/);
  assert.match(text, /Legal services needed/);
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

test('injectLeadRecapIntoReply leaves a closing-document question alone', () => {
  const reply =
    'I can review the purchase agreement once we confirm the matter. What details can you provide about the agreement?';
  const out = injectLeadRecapIntoReply(reply, ['- **Name:** selling my']);
  assert.equal(out, reply);
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
