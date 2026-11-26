import test from 'node:test';
import assert from 'node:assert/strict';
import { withOccasionalEmoji, finishAgentReply } from '../services/professionalAssistant/assistantEmoji.js';
import { applyAgentOpeningFunnel, replyLanguage } from '../services/professionalAssistant/replyStyle.js';
import { voiceTurnReminder, appendAssistantOverlay } from '../services/professionalAssistant/assistantPrompt.js';
import { assistantSettingForPreview } from '../services/professionalAssistant/assistantSettings.js';
import { withTurnReminder } from '../services/chat/handleChat/chatOpenAiTurn.js';

function previewSetting(useEmojis = true) {
  return assistantSettingForPreview({
    personalities: ['luxury'],
    use_emojis: useEmojis,
    communication_style: 'consultative',
    formality: 'professional',
    languages: ['english'],
    auto_detect_language: true,
  }, 'agent');
}

/** Mirrors the preview finish stages that can drop emoji after the model returns. */
function finishPreviewAgentReply(modelRaw, {
  useEmojis = true,
  userMessage = 'hello',
  isOpeningFormTurn = true,
} = {}) {
  const setting = previewSetting(useEmojis);
  const afterAgentFinish = finishAgentReply(modelRaw, {
    setting,
    userMessage,
    documentReceived: false,
  });
  const afterFunnel = applyAgentOpeningFunnel(afterAgentFinish, {
    isOpeningFormTurn,
    flowRole: 'agent',
    userMessage,
    setting,
    intent: 'buy',
  });
  return withOccasionalEmoji(afterFunnel, setting, { documentReceived: false });
}

test('preview draft sanitize keeps use_emojis true from onboarding payload', () => {
  const setting = previewSetting(true);
  assert.equal(setting.use_emojis, true);
  assert.equal(setting.applied, true);
});

test('preview OpenAI messages include greeting emoji instruction when use_emojis true', () => {
  const setting = previewSetting(true);
  const reminder = voiceTurnReminder(setting, 'hello', { preview: true, openingTurn: true });
  assert.match(reminder, /Required for this greeting reply: end with exactly one fitting emoji/i);
  const overlay = appendAssistantOverlay('BASE', setting, { preview: true, openingTurn: true });
  assert.match(overlay, /exactly one tasteful emoji/i);
  assert.doesNotMatch(overlay, /^No emojis\.|Do not use emojis\./m);

  const messages = withTurnReminder(
    [
      { role: 'system', content: overlay },
      { role: 'user', content: 'hello' },
    ],
    reminder,
  );
  const joined = messages.map((m) => m.content).join('\n');
  assert.match(joined, /exactly one fitting emoji|exactly one tasteful emoji/i);
  assert.equal(messages.some((m) => m.role === 'system' && /Required for this greeting reply/i.test(m.content)), true);
});

test('finish preview keeps model greeting emoji when use_emojis true (no inject)', () => {
  const modelRaw = 'Hello, it is good to hear from you. Are you looking to buy or sell a property? \u{1F44B}';
  const out = finishPreviewAgentReply(modelRaw, { useEmojis: true, userMessage: 'hello' });
  assert.equal(/\p{Extended_Pictographic}/u.test(out), true);
  assert.match(out, /buy or sell/i);
  assert.doesNotMatch(out, /Great start/);
});

test('finish preview strips model greeting emoji when use_emojis false', () => {
  const modelRaw = 'Hello, it is good to hear from you. Are you looking to buy or sell a property? \u{1F44B}';
  const out = finishPreviewAgentReply(modelRaw, { useEmojis: false, userMessage: 'hello' });
  assert.equal(/\p{Extended_Pictographic}/u.test(out), false);
  assert.match(out, /buy or sell/i);
});

test('finish does not inject emoji when model returns none (by design)', () => {
  const modelRaw = 'Hello, it is good to hear from you. Are you looking to buy or sell a property?';
  const out = finishPreviewAgentReply(modelRaw, { useEmojis: true, userMessage: 'hello' });
  assert.equal(/\p{Extended_Pictographic}/u.test(out), false);
  assert.equal(out.includes('\u{1F44B}'), false);
});

test('Arabic greeting with emoji survives opening funnel + finish when use_emojis true', () => {
  const modelRaw = '\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645. \u0647\u0644 \u062a\u0628\u062d\u062b \u0639\u0646 \u0634\u0631\u0627\u0621 \u0645\u0646\u0632\u0644 \u0623\u0645 \u0639\u0646 \u0628\u064a\u0639 \u0639\u0642\u0627\u0631\u061f \u{1F44B}';
  const setting = previewSetting(true);
  assert.equal(replyLanguage(setting, 'salam'), 'arabic');
  const out = finishPreviewAgentReply(modelRaw, { useEmojis: true, userMessage: 'salam' });
  assert.equal(out, modelRaw);
  assert.equal(/\p{Extended_Pictographic}/u.test(out), true);
  assert.doesNotMatch(out, /Great start|neighborhood shortlist/);
});

test('FE visibleReply equivalent does not strip emoji', () => {
  const payload = { reply: 'Hello there. Buy or sell? \u{1F44B}###META###{"intent":"buy"}' };
  const visible = String(payload.reply ?? '').split('###META###')[0].trim();
  assert.equal(/\p{Extended_Pictographic}/u.test(visible), true);
});
