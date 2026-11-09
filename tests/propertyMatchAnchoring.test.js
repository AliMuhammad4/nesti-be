import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildChatResponseMeta } from '../services/chat/handleChat/chatResponseMeta.js';

const base = {
  flow: { flowRole: 'agent' },
  conversation: { _id: 'c1' },
  hasContact: true,
  propertyMatchesEnabled: true,
  finalScore: 50,
  finalGrade: 'B',
  aiIntent: 'buy',
  finalClass: 'warm',
  leadMeta: { qualified: false, signals: {}, lead_reasons: {}, sub_scores: {} },
  contactInfo: { email: 'a@b.co' },
  emotionalState: 'neutral',
};

test('property matches stay unavailable while qualification is still open', async () => {
  const open = await buildChatResponseMeta({ ...base, qualificationOpen: true });
  assert.equal(open.property_matches_available, false);
  assert.equal(open.refetch_property_matches, false);
  const done = await buildChatResponseMeta({ ...base, qualificationOpen: false });
  assert.equal(done.property_matches_available, true);
});

test('explicit listings ask still opens matches during qualification', async () => {
  const asked = await buildChatResponseMeta({ ...base, qualificationOpen: true, refetchPropertyMatches: true });
  assert.equal(asked.property_matches_available, true);
  assert.equal(asked.refetch_property_matches, true);
});

test('widget keeps an already shown match set anchored to its original message', () => {
  const src = readFileSync(new URL('../../frontend/src/components/chatbot/ChatWidget.js', import.meta.url), 'utf8');
  assert.match(src, /sameMatchSetAlreadyShown = true/);
  assert.match(src, /!matchesPending && !sameMatchSetAlreadyShown/);
  assert.match(src, /Boolean\(meta\.property_matches_available\) &&\s*\(shouldFetchMatchesOnNextAssistantReplyRef/);
  assert.doesNotMatch(src, /if \(wantsMatchesOnReply\) \{\s*lastPropertyMatchesSignatureRef\.current = "";/);
});
