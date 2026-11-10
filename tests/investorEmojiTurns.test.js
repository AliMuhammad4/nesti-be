import test from 'node:test';
import assert from 'node:assert/strict';
import { withOccasionalEmoji, keepModelEmoji } from '../services/professionalAssistant/assistantEmoji.js';
import { keepOpenQuestion } from '../services/professionalAssistant/qualificationProgress.js';
import { voiceTurnReminder } from '../services/professionalAssistant/assistantPrompt.js';
import { assistantSettingForPreview } from '../services/professionalAssistant/assistantSettings.js';

const setting = (use_emojis) => assistantSettingForPreview({
  personalities: ['consultative'], use_emojis, languages: ['english'], communication_style: 'consultative', formality: 'professional',
}, 'agent');

const turns = [
  ['i want to invest in toronto', 'Toronto is a strong market. What type of investment are you considering? And what budget? \u{1F3E2}'],
  ['long term rental', 'Long-term rentals suit steady cash flow. What is your approximate budget in USD? \u{1F4C8}'],
  ['but i dont want to go with those options', 'Understood, we can refine the search. Which criterion should we change first? \u{1F914}'],
];

test('mid-chat investor turns keep the model emoji through finish rewrites', () => {
  const s = setting(true);
  for (const [user, draft] of turns) {
    let out = keepOpenQuestion(draft, s, {}, [], user);
    out = keepModelEmoji(out, draft, s);
    out = withOccasionalEmoji(out, s);
    assert.match(out, /\p{Extended_Pictographic}\s*$/u, `lost emoji on: ${user} -> ${out}`);
    assert.equal((out.match(/\p{Extended_Pictographic}/gu) || []).length, 1);
  }
});

test('emojis off strips model emoji on every turn and nothing is injected', () => {
  const s = setting(false);
  for (const [, draft] of turns) {
    const out = withOccasionalEmoji(keepModelEmoji(draft, draft, s), s);
    assert.doesNotMatch(out, /\p{Extended_Pictographic}/u);
  }
  assert.equal(keepModelEmoji('What is your budget?', 'What is your budget?', setting(true)), 'What is your budget?');
});

test('non-greeting turn reminder asks for a model-chosen emoji when on', () => {
  const r = voiceTurnReminder(setting(true), 'long term rental', { openingTurn: false });
  assert.match(r, /exactly one fitting emoji/i);
});
