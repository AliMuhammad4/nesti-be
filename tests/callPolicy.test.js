import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callScopeForThread,
  supportsCall,
  supportsDirectCall,
} from '../services/proChat/callPolicy.js';

test('two-party lead inquiry threads support direct calls', () => {
  assert.equal(
    supportsDirectCall(
      { thread_type: 'group', participants_key: 'lead:lead-id:unique-id' },
      ['professional-id', 'client-id'],
    ),
    true,
  );
});

test('ordinary group threads do not support direct calls', () => {
  assert.equal(
    supportsDirectCall(
      { thread_type: 'group', participants_key: 'group:unique-id' },
      ['user-1', 'user-2'],
    ),
    false,
  );
});

test('ordinary group threads support multiparty calls', () => {
  const thread = { thread_type: 'group', participants_key: 'group:unique-id' };
  const participants = ['user-1', 'user-2', 'user-3'];
  assert.equal(supportsCall(thread, participants), true);
  assert.equal(callScopeForThread(thread, participants), 'multiparty');
});

test('DMs and two-party lead threads retain direct call scope', () => {
  assert.equal(callScopeForThread({ thread_type: 'dm' }, ['user-1', 'user-2']), 'direct');
  assert.equal(
    callScopeForThread(
      { thread_type: 'group', participants_key: 'lead:lead-id:unique-id' },
      ['user-1', 'user-2'],
    ),
    'direct',
  );
});

test('lead inquiry threads with more than two participants remain group calls', () => {
  assert.equal(
    supportsDirectCall(
      { thread_type: 'group', participants_key: 'lead:lead-id:unique-id' },
      ['user-1', 'user-2', 'user-3'],
    ),
    false,
  );
});
