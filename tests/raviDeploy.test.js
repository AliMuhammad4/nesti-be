import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { idleProcessCount, startupWarnings } from '../workers/raviSalesWorker.js';
import { SHUTDOWN_WAIT_MS, waitForChildExit } from '../services/proChat/transcriptionWorkerLifecycle.js';

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

test('Ravi keeps one idle process unless RAVI_IDLE_PROCESSES says otherwise', () => {
  assert.equal(idleProcessCount({ NODE_ENV: 'production' }), 1);
  assert.equal(idleProcessCount({}), 1);
  assert.equal(idleProcessCount({ RAVI_IDLE_PROCESSES: '2' }), 2);
  assert.equal(idleProcessCount({ RAVI_IDLE_PROCESSES: '0' }), 0);
});

test('a Render worker without NODE_ENV=production warns about the dev agent name', () => {
  const [warning] = startupWarnings({ RENDER: 'true' }, 'nesti-ravi-sales-dev', 4096);
  assert.match(warning, /nesti-ravi-sales-dev/);
  assert.match(warning, /NODE_ENV=production/);
  assert.deepEqual(startupWarnings({ RENDER: 'true', NODE_ENV: 'production' }, 'nesti-ravi-sales', 4096), []);
  assert.deepEqual(startupWarnings({}, 'nesti-ravi-sales-dev', 16000), []);
});

test('a box under 2 GB gets a memory warning', () => {
  const warnings = startupWarnings({ NODE_ENV: 'production' }, 'nesti-ravi-sales', 512);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /512 MB/);
});

test('shutdown waits for a live worker to exit, and gives up after the limit', async () => {
  assert.ok(SHUTDOWN_WAIT_MS < 30_000);
  const busy = fakeChild();
  const waiting = waitForChildExit(busy, 1000);
  setTimeout(() => busy.emit('exit', 0), 20);
  assert.equal(await waiting, true);
  assert.equal(await waitForChildExit(fakeChild(), 30), false);
  assert.equal(await waitForChildExit(null, 30), true);
});
