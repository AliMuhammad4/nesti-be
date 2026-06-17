import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFESSIONAL_TYPE } from '../constants/roles.js';
import { buildOutOfScopeReply, detectOutOfScopeMessage } from '../services/chat/utils/chatScopeGuard.js';

test('detectOutOfScopeMessage blocks explicit off-topic question', () => {
  const blocked = detectOutOfScopeMessage('Can you tell me a cricket joke?', PROFESSIONAL_TYPE.AGENT);
  assert.equal(blocked, true);
});

test('detectOutOfScopeMessage allows real-estate question', () => {
  const blocked = detectOutOfScopeMessage(
    'I want to buy a home in downtown and my budget is 700k',
    PROFESSIONAL_TYPE.AGENT,
  );
  assert.equal(blocked, false);
});

test('detectOutOfScopeMessage allows mortgage-preapproval question for broker flow', () => {
  const blocked = detectOutOfScopeMessage(
    'Can you help with pre-approval and down payment options?',
    PROFESSIONAL_TYPE.MORTGAGE_BROKER,
  );
  assert.equal(blocked, false);
});

test('buildOutOfScopeReply includes role-aligned redirect', () => {
  const reply = buildOutOfScopeReply(PROFESSIONAL_TYPE.LAWYER, 'Alex Lawyer');
  assert.match(reply, /real-estate legal/i);
  assert.match(reply, /Alex Lawyer/);
});
