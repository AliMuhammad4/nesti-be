import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantAnnouncingOptionCards,
  assistantOfferedAvailableOptions,
  isAvailableOptionsConsentMessage,
  isAvailableOptionsDeclineMessage,
  isAvailableOptionsRequestMessage,
  isPropertyMatchesRequestMessage,
  shouldRefetchPropertyMatchesForMessage,
} from '../services/chat/utils/propertyMatchesRequestIntent.js';

test('a typed request for options still loads listings', () => {
  assert.equal(isAvailableOptionsRequestMessage('i want to see avaialable ptions you ar ehaving'), true);
  assert.equal(shouldRefetchPropertyMatchesForMessage('i want to see avaialable ptions you ar ehaving'), true);
  assert.equal(isAvailableOptionsRequestMessage('i can upload documents later'), false);
});

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

test('yes after a later non-offer reply does not reload matches', () => {
  const lastReply = 'Can you upload your ID when you are ready?';
  assert.equal(assistantOfferedAvailableOptions(lastReply), false);
  assert.equal(
    shouldRefetchPropertyMatchesForMessage('yes', { previousAssistantReply: lastReply }),
    false,
  );
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

test('soft other-options preference talk does not load listing cards', () => {
  const softOffer =
    'I respect your decision to hold off on the listings at this time. Would you like to discuss your investment preferences further or explore other options?';
  const user = 'yes am looking for other options with suitable location in lahore';
  assert.equal(assistantOfferedAvailableOptions(softOffer), false);
  assert.equal(isAvailableOptionsRequestMessage(user), false);
  assert.equal(isAvailableOptionsConsentMessage(user, { afterOptionsOffer: true }), false);
  assert.equal(shouldRefetchPropertyMatchesForMessage(user, { previousAssistantReply: softOffer }), false);
  assert.equal(
    shouldRefetchPropertyMatchesForMessage(user, {
      previousAssistantReply: 'Would you like to see available investment options that fit what you shared?',
    }),
    false,
  );
});

test('explicit show available options still loads cards', () => {
  assert.equal(isAvailableOptionsRequestMessage('show me available options in lahore'), true);
  assert.equal(
    isAvailableOptionsConsentMessage('yes please show the options', { afterOptionsOffer: true }),
    true,
  );
});

test('investor form opening does not auto-load listing cards', () => {
  const opening =
    "Hi! My name is Qui. I am looking to buy an investment property. I'm looking for investment properties in lahore.";
  assert.equal(isAvailableOptionsRequestMessage(opening), false);
  assert.equal(shouldRefetchPropertyMatchesForMessage(opening), false);
  assert.equal(isAvailableOptionsRequestMessage('show me investment properties in lahore'), true);
});

test('declining shown matches does not reload or consent to options', () => {
  for (const decline of [
    "i dont want to go with those porperties",
    "i dont want to go with those options",
  ]) {
    assert.equal(isAvailableOptionsDeclineMessage(decline), true);
    assert.equal(isAvailableOptionsConsentMessage(decline, { afterOptionsOffer: true }), false);
    assert.equal(
      shouldRefetchPropertyMatchesForMessage(decline, {
        previousAssistantReply: 'Would you like to see available investment options that fit what you shared?',
      }),
      false,
    );
  }
});

test('localized available-options offers are detected so the ask is not repeated', () => {
  assert.equal(
    assistantOfferedAvailableOptions('Souhaitez-vous voir les options disponibles qui correspondent à vos critères ?'),
    true,
  );
  assert.equal(
    assistantOfferedAvailableOptions('¿Le gustaría ver opciones disponibles que se ajusten a lo que busca?'),
    true,
  );
  assert.equal(
    assistantOfferedAvailableOptions('您想看看符合您需求的房源选项吗？'),
    true,
  );
});