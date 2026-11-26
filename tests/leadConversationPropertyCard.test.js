import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../frontend/src/lib/propertyCardMarker.js', import.meta.url), 'utf8');
const { extractPropertyCards } = await import(`data:text/javascript,${encodeURIComponent(src)}`);

test('lead conversation parses the selected property marker into a card plus text', () => {
  const out = extractPropertyCards('[PROPERTY_CARD]\n{"title":"test1","location":"Lahore","price":550000,"propertyType":"Condo","bedrooms":"3","bathrooms":"3","imageUrl":"https://x/y.jpg"}\n[/PROPERTY_CARD]\n\nPlease guide me on viewing and next steps.');
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].price, '$550,000');
  assert.equal(out.cards[0].imageUrl, 'https://x/y.jpg');
  assert.equal(out.text, 'Please guide me on viewing and next steps.');
  assert.doesNotMatch(out.text, /PROPERTY_CARD|\{/);
});

test('bad JSON, multiple cards, orphan tags, and plain text never leak raw JSON', () => {
  assert.deepEqual(extractPropertyCards('[PROPERTY_CARD] {bad json [/PROPERTY_CARD]\nhello').text, 'hello');
  assert.equal(extractPropertyCards('[PROPERTY_CARD]{"title":"a"}[/PROPERTY_CARD]  [PROPERTY_CARD]{"title":"b"}[/PROPERTY_CARD] x').cards.length, 2);
  assert.equal(extractPropertyCards('hi [PROPERTY_CARD]{"title":"cut').text, 'hi');
  const plain = extractPropertyCards('plain message');
  assert.equal(plain.hadMarker, false);
  assert.equal(plain.text, 'plain message');
});

test('lead MessageBubble renders structured cards instead of raw content', () => {
  const bubble = readFileSync(new URL('../../frontend/src/components/leads/MessageBubble.js', import.meta.url), 'utf8');
  assert.match(bubble, /extractPropertyCards\(content\)/);
  assert.match(bubble, /renderStructuredPropertyCard/);
});

import { persistMatchesOnLatestAssistantMessage } from '../services/chat/handleChat/chatPropertyMatchesPayload.js';
import ChatMessage from '../models/ChatMessage.js';

test('shown matches persist on the latest assistant message once per set', async (t) => {
  const updates = [];
  let stored = null;
  t.mock.method(ChatMessage, 'findOne', (filter) => ({
    sort: () => ({ select: () => ({ lean: async () => (filter['meta.property_matches.0'] ? stored : { _id: 'm2', meta: {} }) }) }),
  }));
  t.mock.method(ChatMessage, 'updateOne', async (q, u) => { updates.push([q, u]); stored = { _id: q._id, meta: { property_matches: u.$set['meta.property_matches'] } }; });
  const rows = [{ id: 'p1', title: 'test1', images: ['https://x/a.jpg'] }];
  assert.equal(await persistMatchesOnLatestAssistantMessage('c1', rows, 'investor'), true);
  assert.equal(updates[0][1].$set['meta.property_matches_context'], 'investor');
  assert.equal(await persistMatchesOnLatestAssistantMessage('c1', rows, 'investor'), false);
});

test('lead conversation API returns selected property and match payloads; bubble uses widget cards read-only', () => {
  const api = readFileSync(new URL('../services/lead/leadProfileHelpers.js', import.meta.url), 'utf8');
  assert.match(api, /property_matches: m\.meta\.property_matches/);
  assert.match(api, /selected_property: m\.meta\.selected_property/);
  const bubble = readFileSync(new URL('../../frontend/src/components/leads/MessageBubble.js', import.meta.url), 'utf8');
  assert.match(bubble, /variant="selected"\s*readOnly/);
  assert.match(bubble, /matches=\{matchItems\}/);
  const cards = readFileSync(new URL('../../frontend/src/components/chatbot/widget/ChatPropertyMatchCards.js', import.meta.url), 'utf8');
  assert.match(cards, /disabled=\{readOnly\}/);
});
