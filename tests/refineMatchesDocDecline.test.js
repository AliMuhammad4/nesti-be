import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldRefetchPropertyMatchesForMessage, isRefinedOptionsAnswer } from '../services/chat/utils/propertyMatchesRequestIntent.js';
import { isDocumentDeclineMessage, offerConsultationAfterSkippedUpload } from '../services/chat/utils/chatBookingReply.js';
import { appendAssistantOverlay } from '../services/professionalAssistant/assistantPrompt.js';
import { assistantSettingForPreview } from '../services/professionalAssistant/assistantSettings.js';

const refinePrompt = 'I understand those options did not meet your expectations. Which should we adjust first: area, budget, property type, or investment strategy? \u{1F3E0}';

test('refined criteria after a decline schedule a new match fetch', () => {
  const msg = 'yes i want to see it in lahore johar town with the budget i have provided';
  assert.equal(isRefinedOptionsAnswer(msg, refinePrompt), true);
  assert.equal(shouldRefetchPropertyMatchesForMessage(msg, { previousAssistantReply: refinePrompt }), true);
  assert.equal(shouldRefetchPropertyMatchesForMessage('none of them work for me', { previousAssistantReply: refinePrompt }), false);
  assert.equal(isRefinedOptionsAnswer(msg, 'What is your timeline?'), false);
});

test('frontend uses the same refined-answer gate and folds a stranded emoji inline', () => {
  const widget = readFileSync(new URL('../../frontend/src/components/chatbot/ChatWidget.js', import.meta.url), 'utf8');
  assert.match(widget, /isRefinedOptionsAnswer\(text, lastAssistantText\)/);
  const utils = readFileSync(new URL('../../frontend/src/components/chatbot/widget/chatWidgetTextUtils.js', import.meta.url), 'utf8');
  assert.match(utils, /whitespace-nowrap/);
  assert.match(utils, /foldTrailingEmoji\(formatAssistantChatText\(content\)\)/);
  const fold = (s) => String(s).replace(/\s*\n+\s*(\p{Extended_Pictographic}[\uFE0E\uFE0F\u200D\p{Extended_Pictographic}]*)\s*$/u, ' $1');
  assert.equal(fold('Budget of $400K\u2013$700K.\n\n\u{1F3D9}\uFE0F'), 'Budget of $400K\u2013$700K. \u{1F3D9}\uFE0F');
});

test('prompt forbids invented durations and grounds timing in the current step', () => {
  const s = assistantSettingForPreview({ personalities: ['consultative'], languages: ['english'] }, 'agent');
  const overlay = appendAssistantOverlay('BASE', s, {});
  assert.match(overlay, /Never invent durations, timelines/);
  assert.match(overlay, /matching options can be shown here in the chat/);
});

test('document deferral is recognised and ends with the consultation link', () => {
  for (const t of ['not interested in sharing documents', 'i dont want to upload any docs', 'later', 'no thanks', "I'd rather not send my bank statements"]) {
    assert.equal(isDocumentDeclineMessage(t), true, t);
  }
  for (const t of ['no, i am not in a hurry', 'yes here it is', 'what budget works?']) {
    assert.equal(isDocumentDeclineMessage(t), false, t);
  }
  const out = offerConsultationAfterSkippedUpload('Understood. Please upload the proof of funds here when you are ready.', 'https://calendly.com/x/30min', { allowSchedule: true });
  assert.match(out, /calendly\.com\/x\/30min/);
  assert.doesNotMatch(out, /upload the proof of funds/i);
  const finish = readFileSync(new URL('../services/chat/handleChat/chatTurnFinish.js', import.meta.url), 'utf8');
  assert.match(finish, /\(!optionsGateOpen \|\| documentDeclined\)/);
  assert.match(finish, /&& !documentDeclined\s*\) \{/);
});
