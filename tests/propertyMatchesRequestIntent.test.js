import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantAnnouncingOptionCards,
  assistantOfferedAvailableOptions,
  isAvailableOptionsConsentMessage,
  isAvailableOptionsRequestMessage,
  isPropertyMatchesRequestMessage,
  shouldRefetchPropertyMatchesForMessage,
} from '../services/chat/utils/propertyMatchesRequestIntent.js';

test('detects available options phrasing separately from property matches', () => {
  assert.equal(isAvailableOptionsRequestMessage('show me the avaialable options avaialable'), true);
  assert.equal(isAvailableOptionsRequestMessage('show me the available options'), true);
  assert.equal(isPropertyMatchesRequestMessage('show me the available options'), false);
  assert.equal(isPropertyMatchesRequestMessage('show me matching properties'), true);
  assert.equal(shouldRefetchPropertyMatchesForMessage('show me the available options'), true);
});

test('does not treat unrelated follow-up questions as property match requests', () => {
  assert.equal(isPropertyMatchesRequestMessage('what is supposed to discuss in meeting?'), false);
  assert.equal(isAvailableOptionsRequestMessage('what is supposed to discuss in meeting?'), false);
  assert.equal(isPropertyMatchesRequestMessage('yes looks good'), false);
});

test('yes after an options offer loads the lead matches', () => {
  const offer = 'Would you like to see available options?';
  assert.equal(assistantOfferedAvailableOptions(offer), true);
  assert.equal(shouldRefetchPropertyMatchesForMessage('yes', { previousAssistantReply: offer }), true);
  assert.equal(shouldRefetchPropertyMatchesForMessage('yes'), false);
  assert.equal(shouldRefetchPropertyMatchesForMessage('what is my budget?'), false);
});

test('a short options sentence plus a question still announces cards', () => {
  const reply = 'Here are options that fit what you shared. What is your preferred timeline?';
  assert.equal(assistantAnnouncingOptionCards(reply), true);
  assert.equal(assistantAnnouncingOptionCards('What is your preferred timeline?'), false);
  assert.equal(assistantAnnouncingOptionCards('I can help you find homes that fit your budget'), false);
});

test('details confirmation alone does not count as options consent without a prior offer', () => {
  assert.equal(isAvailableOptionsConsentMessage('yes', { afterOptionsOffer: false }), false);
  assert.equal(isAvailableOptionsConsentMessage('yes', { afterOptionsOffer: true }), true);
  assert.equal(isAvailableOptionsConsentMessage('yes sure', { afterOptionsOffer: true }), true);
  assert.equal(isAvailableOptionsConsentMessage('yes sure', { afterOptionsOffer: false }), false);
});
