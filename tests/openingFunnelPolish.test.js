import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentOpeningFunnel, displayLocation } from '../services/professionalAssistant/replyStyle.js';
import { assistantSettingForPreview } from '../services/professionalAssistant/assistantSettings.js';

const setting = assistantSettingForPreview({ personalities: ['consultative'], languages: ['english'] }, 'agent');
const tailored = "Welcome, Yeo Day. It's great to see your interest in the Lahore market for investment properties.";
const base = { isOpeningFormTurn: true, flowRole: 'agent', isInvestorVisitor: true, locationHint: 'lahore', setting, userMessage: 'intake' };

test('opening asks the next unanswered saved question, without canned "Great start."', () => {
  const out = applyAgentOpeningFunnel(tailored, { ...base, nextQuestion: 'Ready to tour investment properties?', investmentGoalKnown: true });
  assert.doesNotMatch(out, /Great start/);
  assert.doesNotMatch(out, /rental yield or long-term appreciation/);
  assert.match(out, /Ready to tour investment properties\?$/);
});

test('known investment goal is never re-asked by the investor funnel', () => {
  const out = applyAgentOpeningFunnel(tailored, { ...base, investmentGoalKnown: true });
  assert.doesNotMatch(out, /rental yield|appreciation/);
  assert.doesNotMatch(out, /Great start/);
  assert.match(out, /purchase price, renovation scope, or exit timeline\?$/);
  assert.doesNotMatch(out, /great to see your interest/i);
});

test('location is capitalized and model questions are kept as-is', () => {
  assert.equal(displayLocation('lahore'), 'Lahore');
  assert.equal(displayLocation('new york'), 'New York');
  const asked = `${tailored} What budget works for you?`;
  assert.equal(applyAgentOpeningFunnel(asked, { ...base, nextQuestion: 'X?' }), 'Welcome, Yeo Day. What budget works for you?');
});
