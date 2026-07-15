import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCallTokenForThread } from '../services/proChat/callService.js';

test('call token service requires an explicit boolean choice before membership work', async () => {
  const result = await createCallTokenForThread({
    currentUserId: 'not-loaded',
    threadId: 'not-loaded',
    callType: 'voice',
    action: 'start',
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'transcription_consent_choice_required');
  assert.equal(result.body.transcription_policy_version, '1');
  assert.equal('token' in result.body, false);
});

test('recipient token authorization notifies the caller before media activation', async () => {
  const [serviceSource, socketSource] = await Promise.all([
    readFile(new URL('../services/proChat/callService.js', import.meta.url), 'utf8'),
    readFile(new URL('../services/realtime/workspaceSocket.js', import.meta.url), 'utf8'),
  ]);

  assert.match(serviceSource, /normalizedAction === 'join'/);
  assert.match(serviceSource, /finalState\.call\?\.status === 'connecting'/);
  assert.match(serviceSource, /callerId !== userId/);
  assert.match(serviceSource, /emitCallAccepted\(callerId/);
  assert.match(socketSource, /emit\('prochat:call_accepted'/);
  assert.match(serviceSource, /participant_status:\s*'accepted'/);
});
