import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldMarkPropertyOptionsShown } from '../services/chat/handleChat/chatPropertyMatchesPayload.js';

test('only completed property match lookups count as options shown', () => {
  assert.equal(shouldMarkPropertyOptionsShown('ready'), true);
  assert.equal(shouldMarkPropertyOptionsShown('pending'), false);
  assert.equal(shouldMarkPropertyOptionsShown('unavailable'), false);
});
