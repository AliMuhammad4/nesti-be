import test from 'node:test';
import assert from 'node:assert/strict';
import { withOccasionalEmoji } from '../services/professionalAssistant/assistantEmoji.js';
import { voiceTurnReminder } from '../services/professionalAssistant/assistantPrompt.js';
import { stripAnsweredIntakeAsks } from '../services/professionalAssistant/qualificationProgress.js';
import { sanitizeAssistant } from '../services/professionalAssistant/assistantSettings.js';
import { PERSONALITIES, PERSONALITY_VOICE_CONDUCT } from '../services/professionalAssistant/catalog.js';
import {
  applyAgentOpeningFunnel,
  agentOpeningFunnelQuestion,
  replyHasQuestionMark,
} from '../services/professionalAssistant/replyStyle.js';

test('personality catalog keeps the five tone ids with premium blurbs', () => {
  assert.deepEqual(PERSONALITIES.map(([id]) => id), ['luxury', 'friendly', 'polished', 'persuasive', 'consultative']);
  assert.match(PERSONALITIES.find(([id]) => id === 'luxury')[2], /White-glove/);
  assert.match(PERSONALITIES.find(([id]) => id === 'polished')[2], /Calm professional authority/);
  assert.match(PERSONALITIES.find(([id]) => id === 'consultative')[2], /Investment-grade/);
  assert.match(PERSONALITY_VOICE_CONDUCT.luxury, /Luxury Concierge/);
  assert.match(PERSONALITY_VOICE_CONDUCT.persuasive, /Results-Oriented/);
});

test('withOccasionalEmoji strips model emojis when use_emojis is false', () => {
  const out = withOccasionalEmoji('Thanks for sharing your budget. 🏡', {
    use_emojis: false,
  }, { userMessage: 'my budget is 500k' });
  assert.equal(/\p{Extended_Pictographic}/u.test(out), false);
  assert.match(out, /budget/i);
});

test('withOccasionalEmoji keeps model emoji when use_emojis is true', () => {
  const out = withOccasionalEmoji('Glad you are here. 👋', { use_emojis: true });
  assert.equal(out, 'Glad you are here. 👋');
});

test('withOccasionalEmoji strips booking and document surfaces even when emojis are on', () => {
  const booking = withOccasionalEmoji(
    'Pick a slot. 📅 [Book a consultation](https://calendly.com/agent/intro)',
    { use_emojis: true },
  );
  assert.equal(/\p{Extended_Pictographic}/u.test(booking), false);
  assert.match(booking, /calendly/i);

  const doc = withOccasionalEmoji('Got the file. 📄', { use_emojis: true }, { documentReceived: true });
  assert.equal(/\p{Extended_Pictographic}/u.test(doc), false);
  assert.match(doc, /Got the file/);
});

test('custom_guidance reaches voiceTurnReminder for mid-chat turns', () => {
  const setting = sanitizeAssistant({
    applied: true,
    personalities: ['friendly'],
    communication_style: 'conversational',
    formality: 'casual',
    use_emojis: false,
    custom_guidance: 'Always mention cash-flow first for investors.',
  }, 'agent');
  const reminder = voiceTurnReminder(setting, 'what areas do you cover?', {
    conversationText: 'investor looking at duplexes',
    openingTurn: false,
  });
  assert.match(reminder, /Always mention cash-flow first for investors/i);
  assert.match(reminder, /Professional instructions/i);
  assert.match(reminder, /No emojis/i);
});

test('voiceTurnReminder asks the model for emoji on greetings and occasionally mid-chat', () => {
  const setting = sanitizeAssistant({
    applied: true,
    personalities: ['luxury'],
    use_emojis: true,
  }, 'agent');
  const greetingReminder = voiceTurnReminder(setting, 'hello', { openingTurn: true });
  assert.match(greetingReminder, /Required for this greeting reply: end with exactly one fitting emoji/);
  assert.doesNotMatch(greetingReminder, /end a greeting with a wave/i);
  assert.doesNotMatch(greetingReminder, /Skip emoji on plain intake questions/i);
  assert.match(greetingReminder, /Luxury Concierge/);

  const midChat = voiceTurnReminder(setting, 'my budget is 500k', { openingTurn: false });
  assert.match(midChat, /end most conversational replies \(about every other turn[^)]*\) with exactly one fitting emoji/);
  assert.doesNotMatch(midChat, /Skip emoji on plain intake questions/i);
});

test('assistantSettingForPreview keeps use_emojis from the onboarding draft', async () => {
  const { assistantSettingForPreview } = await import('../services/professionalAssistant/assistantSettings.js');
  const preview = assistantSettingForPreview({
    personalities: ['friendly'],
    use_emojis: true,
    communication_style: 'conversational',
  }, 'agent');
  assert.equal(preview.use_emojis, true);
  assert.equal(preview.applied, true);
  const reminder = voiceTurnReminder(preview, 'hi');
  assert.match(reminder, /Required for this greeting reply: end with exactly one fitting emoji/);
});

test('stripAnsweredIntakeAsks drops re-asks for mortgage broker filled fields', () => {
  const reply = 'Thanks. What is your household income? What is the property value?';
  const stripped = stripAnsweredIntakeAsks(
    reply,
    'mortgage_broker',
    { household_income: '120k', property_value: '650000' },
    [],
  );
  assert.doesNotMatch(stripped, /household income|annual income/i);
  assert.doesNotMatch(stripped, /property value|approximate value/i);
  assert.match(stripped, /Thanks/i);
});


test('replyHasQuestionMark detects Arabic question mark', () => {
  assert.equal(replyHasQuestionMark('Hello?'), true);
  assert.equal(
    replyHasQuestionMark('\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645. \u0647\u0644 \u062a\u0628\u062d\u062b \u0639\u0646 \u0634\u0631\u0627\u0621 \u0645\u0646\u0632\u0644 \u0623\u0645 \u0639\u0646 \u0628\u064a\u0639 \u0639\u0642\u0627\u0631\u061f'),
    true,
  );
  assert.equal(replyHasQuestionMark('Hello there.'), false);
});

test('opening funnel does not append English when Arabic reply already asks', () => {
  const arabic = '\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645. \u0647\u0644 \u062a\u0628\u062d\u062b \u0639\u0646 \u0634\u0631\u0627\u0621 \u0645\u0646\u0632\u0644 \u0623\u0645 \u0639\u0646 \u0628\u064a\u0639 \u0639\u0642\u0627\u0631\u061f \u{1F44B}';
  const out = applyAgentOpeningFunnel(arabic, {
    isOpeningFormTurn: true,
    flowRole: 'agent',
    userMessage: 'salam',
    setting: { languages: ['english'], auto_detect_language: true },
    intent: 'buy',
  });
  assert.equal(out, arabic);
  assert.doesNotMatch(out, /Great start/);
  assert.doesNotMatch(out, /neighborhood shortlist/);
  assert.equal(/\p{Extended_Pictographic}/u.test(out), true);
});

test('agentOpeningFunnelQuestion stays Arabic for salam; no English fallback when copy missing', () => {
  const ar = agentOpeningFunnelQuestion(
    { languages: ['english'], auto_detect_language: true },
    { userMessage: 'salam', intent: 'buy' },
  );
  assert.match(ar, /\p{Script=Arabic}/u);
  assert.doesNotMatch(ar, /Great start/);

  const missing = agentOpeningFunnelQuestion(
    { languages: ['tamil'], auto_detect_language: false },
    { userMessage: 'vanakkam', intent: 'buy' },
  );
  assert.equal(missing, '');
});
