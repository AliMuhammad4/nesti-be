import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AgentDispatchClient } from 'livekit-server-sdk';
import ProfessionalCall from '../models/ProfessionalCall.js';
import logger from '../utils/logger.js';
import {
  TRANSCRIPTION_AGENT_NAME,
  dispatchTranscriptionWorkerForCall,
  scheduleTranscriptionWorkerDispatch,
} from '../services/proChat/callTranscriptionDispatchService.js';

const callId = '64b000000000000000000004';
let claimed = true;
let consenting = true;
let claimReject = false;
let createDispatchGate = null;
const updates = [];
const warnings = [];

test.before(() => {
  process.env.LIVEKIT_URL = 'wss://example.livekit.cloud';
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret';
  process.env.CALL_TRANSCRIPTION_SKIP_WORKER_HEALTH = 'true';
  mock.method(ProfessionalCall, 'findOneAndUpdate', (filter) => ({
    lean: async () => {
      if (claimReject) throw new Error('claim database unavailable');
      assert.equal(
        filter.participant_states.$elemMatch.transcription_consent,
        true,
      );
      return claimed
        ? {
            _id: callId,
            room_name: 'prochat:thread:call',
            thread_id: '64b000000000000000000003',
            status: 'active',
            participant_ids: ['user-1', 'user-2'],
            participant_states: [
              { user_id: 'user-1', transcription_consent: consenting },
              { user_id: 'user-2', transcription_consent: false },
            ],
            transcription_policy_version: '2026-07',
          }
        : null;
    },
  }));
  mock.method(ProfessionalCall, 'updateOne', async (filter, update) => {
    updates.push({ filter, update });
    return { modifiedCount: 1 };
  });
  mock.method(ProfessionalCall, 'findById', () => ({
    select() {
      return this;
    },
    lean: async () => ({
      status: 'active',
      participant_states: [
        { user_id: 'user-1', transcription_consent: consenting },
        { user_id: 'user-2', transcription_consent: false },
      ],
      transcription_status: consenting ? 'dispatching' : 'pending',
      transcription_dispatch_id: 'dispatch-1',
    }),
  }));
  mock.method(AgentDispatchClient.prototype, 'listDispatch', async () => []);
  mock.method(AgentDispatchClient.prototype, 'deleteDispatch', async () => {});
  mock.method(AgentDispatchClient.prototype, 'createDispatch', async (_room, agentName, options) => {
    if (createDispatchGate) await createDispatchGate;
    assert.equal(agentName, TRANSCRIPTION_AGENT_NAME);
    const metadata = JSON.parse(options.metadata);
    assert.deepEqual(metadata.participant_ids, ['user-1', 'user-2']);
    assert.deepEqual(metadata.consenting_participant_ids, ['user-1']);
    assert.equal(typeof metadata.dispatch_generation, 'string');
    assert.ok(metadata.dispatch_generation.length > 10);
    return { id: 'dispatch-1', agentName };
  });
  mock.method(logger, 'warn', (message, metadata) => {
    warnings.push({ message, metadata });
  });
});

test.beforeEach(() => {
  process.env.CALL_TRANSCRIPTION_ENABLED = 'true';
  process.env.CALL_TRANSCRIPTION_WORKER_EMBEDDED = 'false';
  claimed = true;
  consenting = true;
  claimReject = false;
  createDispatchGate = null;
  updates.splice(0);
  warnings.splice(0);
});

test('first active call explicitly dispatches the named worker once', async () => {
  const result = await dispatchTranscriptionWorkerForCall(callId);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'dispatching');
  assert.equal(result.dispatch_id, 'dispatch-1');
  assert.ok(
    updates.some(
      ({ update }) => update.$set?.transcription_dispatch_id === 'dispatch-1',
    ),
  );
});

test('concurrent activation observes the durable dispatch state', async () => {
  claimed = false;
  const result = await dispatchTranscriptionWorkerForCall(callId);
  assert.equal(result.ok, true);
  assert.equal(result.already_dispatched, true);
  assert.equal(result.dispatch_id, 'dispatch-1');
});

test('no-consent activation waits and a later consenting join dispatches', async () => {
  claimed = false;
  consenting = false;
  const waiting = await dispatchTranscriptionWorkerForCall(callId);
  assert.equal(waiting.ok, true);
  assert.equal(waiting.status, 'pending');
  assert.equal(waiting.code, 'waiting_for_transcription_consent');
  assert.equal(updates.length, 0);

  consenting = true;
  claimed = true;
  const dispatched = await dispatchTranscriptionWorkerForCall(callId);
  assert.equal(dispatched.ok, true);
  assert.equal(dispatched.status, 'dispatching');
});

test('disabled transcription records a truthful feature-disabled state', async () => {
  process.env.CALL_TRANSCRIPTION_ENABLED = 'false';
  const result = await dispatchTranscriptionWorkerForCall(callId);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'disabled');
  assert.equal(result.code, 'transcription_disabled');
  assert.ok(
    updates.some(({ update }) => update.$set?.transcription_status === 'disabled'),
  );
});

test('scheduled dispatch returns immediately while LiveKit remains pending', async () => {
  let releaseDispatch;
  createDispatchGate = new Promise((resolve) => {
    releaseDispatch = resolve;
  });
  const scheduled = scheduleTranscriptionWorkerDispatch(callId);
  assert.equal(scheduled, undefined);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    updates.some(({ update }) => update.$set?.transcription_dispatch_id),
    false,
  );

  releaseDispatch();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(
    updates.some(
      ({ update }) => update.$set?.transcription_dispatch_id === 'dispatch-1',
    ),
  );
});

test('scheduled dispatch catches rejection and persists failed status', async () => {
  claimReject = true;
  assert.equal(scheduleTranscriptionWorkerDispatch(callId), undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(
    updates.some(({ update }) => update.$set?.transcription_status === 'failed'),
  );
  assert.ok(
    warnings.some(({ message }) =>
      message.includes('Asynchronous call transcription dispatch rejected'),
    ),
  );
});

test('call activation signaling does not await or pre-report dispatch state', async () => {
  const source = await readFile(
    new URL('../services/realtime/workspaceSocket.js', import.meta.url),
    'utf8',
  );
  const handler = source.slice(
    source.indexOf("socket.on('prochat:call_active'"),
    source.indexOf("socket.on('prochat:call_decline'"),
  );
  assert.match(handler, /scheduleTranscriptionWorkerDispatch\(registryResult\.call\.call_id\)/);
  assert.doesNotMatch(handler, /await\s+dispatchTranscriptionWorkerForCall/);
  assert.doesNotMatch(handler, /registryResult\.call\.transcription_status\s*=/);
});
