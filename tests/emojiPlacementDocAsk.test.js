import test from 'node:test';
import assert from 'node:assert/strict';
import { keepModelEmoji, settleEmojiAtEnd, withOccasionalEmoji } from '../services/professionalAssistant/assistantEmoji.js';
import { documentReviewReply } from '../services/chat/documents/documentReviewReply.js';
import { assistantSettingForPreview } from '../services/professionalAssistant/assistantSettings.js';

const on = assistantSettingForPreview({ personalities: ['consultative'], languages: ['english'], use_emojis: true }, 'agent');
const EMO = /\p{Extended_Pictographic}/gu;

test('model emoji stranded before an appended line moves to the very end, once', () => {
  const out = settleEmojiAtEnd('We can explore your preferences to refine the search. \u{1F3E1} Which area should we focus on first?');
  assert.equal(out, 'We can explore your preferences to refine the search. Which area should we focus on first? \u{1F3E1}');
  assert.equal((out.match(EMO) || []).length, 1);
  assert.equal(keepModelEmoji('A. \u{1F3E1} B \u{1F3D9}\uFE0F end.', '', on), 'A. B end. \u{1F3E1}');
});

test('document ask reply ends without a mid-paragraph emoji', () => {
  const reply = 'We can refine your search. \u{1F3E1} Please upload the proof of funds here when you are ready.';
  const out = withOccasionalEmoji(keepModelEmoji(reply, reply, on), on, { documentReceived: true });
  assert.equal(out, 'We can refine your search. Please upload the proof of funds here when you are ready.');
});

test('final message integrity: text kept, no injection when the model wrote none', () => {
  const reply = 'Which neighbourhood in Lahore should we focus on first?';
  assert.equal(withOccasionalEmoji(keepModelEmoji(reply, reply, on), on), reply);
});

test('a question about an unrelated upload is answered and keeps the requested document', () => {
  const setting = { applied: true, role: 'agent', languages: ['english'], document_requests: ['proof_of_funds', 'photo_id'] };
  const doc = { _id: 'd1', original_filename: 'random.pdf', extracted_text: 'Lorem ipsum unrelated content', status: 'ready' };
  const out = documentReviewReply([doc], setting, { userMessage: 'what is this?', clientType: 'investor', intent: 'buy', text: 'investor buy' });
  assert.doesNotMatch(out, /photo ID/i);
  assert.match(out, /reviewed the file.*not the .*proof of funds/i);
});

import { readFileSync } from 'node:fs';
test('document ask is gated off for direct questions and after declined options with open questions', () => {
  const src = readFileSync(new URL('../services/chat/handleChat/chatTurnFinish.js', import.meta.url), 'utf8');
  assert.match(src, /&& !REPLY_QUESTION_RE\.test\(trimmedMessage\)\s*&& !declinedOptionsThisTurn\s*&& !\(optionsAlreadyDeclined && questionsOpen\)/);
});
