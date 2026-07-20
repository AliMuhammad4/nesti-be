import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTranscriptionAgentName } from '../services/proChat/callTranscriptionConstants.js';

test('transcription agent name defaults to production name in production', () => {
  assert.equal(
    resolveTranscriptionAgentName({ NODE_ENV: 'production' }),
    'nesti-call-transcriber',
  );
});

test('transcription agent name uses a separate dev name outside production', () => {
  assert.equal(
    resolveTranscriptionAgentName({ NODE_ENV: 'development' }),
    'nesti-call-transcriber-dev',
  );
  assert.equal(
    resolveTranscriptionAgentName({}),
    'nesti-call-transcriber-dev',
  );
});

test('CALL_TRANSCRIPTION_AGENT_NAME overrides the default agent name', () => {
  assert.equal(
    resolveTranscriptionAgentName({
      NODE_ENV: 'production',
      CALL_TRANSCRIPTION_AGENT_NAME: 'nesti-call-transcriber-staging',
    }),
    'nesti-call-transcriber-staging',
  );
});
