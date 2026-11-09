import test from 'node:test';
import assert from 'node:assert/strict';
import { isAvailableOptionsDeclineMessage, classifyAvailableOptionsFeedback, shouldRefetchPropertyMatchesForMessage, isAvailableOptionsConsentMessage } from '../services/chat/utils/propertyMatchesRequestIntent.js';
import { declineRefinementReply } from '../services/professionalAssistant/replyStyle.js';
import { keepModelEmoji, withOccasionalEmoji } from '../services/professionalAssistant/assistantEmoji.js';

const declines = [
  'for those options they are not looking suitable for mw',
  'but i dont want to go with those options',
  "these don't really fit what i need",
  'none of them work for me',
  'the properties are not right for us',
];
const prior = 'Here are investment options that fit what you shared.';

test('natural option declines are detected and never refetch cards', () => {
  for (const text of declines) {
    assert.equal(isAvailableOptionsDeclineMessage(text), true, text);
    assert.equal(classifyAvailableOptionsFeedback(text), 'declined', text);
    assert.equal(isAvailableOptionsConsentMessage(text, { afterOptionsOffer: true }), false, text);
    assert.equal(Boolean(shouldRefetchPropertyMatchesForMessage(text, { previousAssistantReply: prior })), false, text);
  }
});

test('ordinary negatives and the yes path are not treated as declines', () => {
  for (const text of ['no, i am not in a hurry', 'yes show me the options', 'they look good', 'i dont have a realtor']) {
    assert.equal(isAvailableOptionsDeclineMessage(text), false, text);
  }
});

test('decline reply drops the proof-of-funds ask and asks one refinement question', () => {
  const model = 'I understand that the options may not align with your criteria. Please upload the proof of funds here when you are ready.';
  const s = { use_emojis: true };
  for (const nextQuestion of ['', 'Ready to tour investment properties?']) {
    let out = declineRefinementReply(model, { nextQuestion, isInvestor: true });
    out = withOccasionalEmoji(keepModelEmoji(out, model, s), s);
    assert.doesNotMatch(out, /proof of funds|upload/i);
    assert.equal((out.match(/\?/g) || []).length, 1);
    assert.match(out, nextQuestion ? /Ready to tour/ : /adjust first: the area, budget, property type, or investment strategy\?$/);
    assert.match(out, /^I understand that the options may not align with your criteria\./);
  }
});

test('model refinement question is kept when present', () => {
  const out = declineRefinementReply('Understood. Would a different neighbourhood in Lahore suit you better? Please upload the proof of funds.', { isInvestor: true });
  assert.equal(out, 'Understood. Would a different neighbourhood in Lahore suit you better?');
});
