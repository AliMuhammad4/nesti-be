import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentOpeningFunnel, polishOpeningReply, formatBudgetBands, investorStrategyGoalConflict } from '../services/professionalAssistant/replyStyle.js';
import { appendAssistantOverlay } from '../services/professionalAssistant/assistantPrompt.js';
import { assistantSettingForPreview } from '../services/professionalAssistant/assistantSettings.js';

const setting = assistantSettingForPreview({ personalities: ['consultative'], languages: ['english'], use_emojis: true }, 'agent');
const modelReply = "It's a pleasure to connect, Eagan. You're considering a townhouse in Lahore for a fix-and-flip investment with a budget of 400k\u2013700k. In Lahore, which should we lock first: neighborhood shortlist or property features? \u{1F3E1}";
const base = { isOpeningFormTurn: true, flowRole: 'agent', isInvestorVisitor: true, locationHint: 'lahore', setting, userMessage: 'intake', investmentGoalKnown: true };

test('generic opener is replaced with a direct welcome and budget is formatted', () => {
  const out = polishOpeningReply(modelReply);
  assert.doesNotMatch(out, /pleasure to connect/i);
  assert.match(out, /^Welcome, Eagan\./);
  assert.match(out, /\$400K\u2013\$700K/);
  assert.equal(formatBudgetBands('400k 700k'), '$400K\u2013$700K');
});

test('investor opening drops the buyer neighborhood/features funnel and asks a real next question', () => {
  const out = applyAgentOpeningFunnel(modelReply, { ...base, nextQuestion: 'Ready to tour investment properties?' });
  assert.doesNotMatch(out, /neighbou?rhood shortlist or property features/i);
  assert.match(out, /Ready to tour investment properties\?$/);
  assert.doesNotMatch(out, /Great start|pleasure to connect/i);
});

test('flip strategy with rental income goal asks which matters most', () => {
  assert.equal(investorStrategyGoalConflict('fix_and_flip', 'rental income'), true);
  assert.equal(investorStrategyGoalConflict('fix_and_flip', 'both'), false);
  assert.equal(investorStrategyGoalConflict('long_term_rental', 'rental income'), false);
  const out = applyAgentOpeningFunnel(modelReply, { ...base, strategyGoalConflict: true });
  assert.match(out, /resale profit from the flip, or hold the property for rental income\?$/);
});

test('opening prompt bans filler openers and asks for conflict-aware goal handling', () => {
  const overlay = appendAssistantOverlay('BASE', setting, { openingTurn: true });
  assert.match(overlay, /No filler openers/);
  assert.match(overlay, /acknowledge both neutrally/);
});
