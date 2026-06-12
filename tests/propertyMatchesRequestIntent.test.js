import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('details confirmation alone does not count as options consent without a prior offer', () => {
  assert.equal(isAvailableOptionsConsentMessage('yes', { afterOptionsOffer: false }), false);
  assert.equal(isAvailableOptionsConsentMessage('yes', { afterOptionsOffer: true }), true);
  assert.equal(isAvailableOptionsConsentMessage('yes sure', { afterOptionsOffer: true }), true);
  assert.equal(isAvailableOptionsConsentMessage('yes sure', { afterOptionsOffer: false }), false);
});
