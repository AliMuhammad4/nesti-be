import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendTranscriptionWorkerLog,
  probeTranscriptionWorkerHealth,
  readTranscriptionWorkerLogTail,
  resolveTranscriptionWorkerPort,
  spawnTranscriptionWorkerProcess,
  transcriptionWorkerLogPath,
  waitForTranscriptionWorkerHealth,
} from '../services/proChat/transcriptionWorkerRuntime.js';

/**
 * `npm run dev` launcher:
 *   parent owns transcription worker (hidden, not detached)
 *   child runs API under `node --watch` with EMBEDDED=false
 *   restarts the worker if LiveKit health drops
 */

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerPort = resolveTranscriptionWorkerPort();
const logPath = transcriptionWorkerLogPath();
const WORKER_HEALTH_POLL_MS = 15_000;

let worker = null;
let server = null;
let shuttingDown = false;
let healthTimer = null;

async function startWorker({ reuseHealthy = true } = {}) {
  if (reuseHealthy && (await probeTranscriptionWorkerHealth(workerPort))) {
    console.log(`[dev] Reusing transcription worker on :${workerPort}`);
    return null;
  }

  console.log(`[dev] Starting transcription worker on :${workerPort}`);
  console.log(`[dev] Worker log: ${logPath}`);

  const child = spawnTranscriptionWorkerProcess({
    port: workerPort,
    logPath,
    stdioMode: 'pipe-log',
  });

  child.stdout?.on('data', (chunk) => appendTranscriptionWorkerLog(chunk, logPath));
  child.stderr?.on('data', (chunk) => appendTranscriptionWorkerLog(chunk, logPath));
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.warn(`[dev] Transcription worker exited (code=${code}, signal=${signal})`);
    }
  });

  const ready = await waitForTranscriptionWorkerHealth(workerPort);
  if (!ready) {
    console.error('[dev] Transcription worker failed to become ready.');
    console.error(readTranscriptionWorkerLogTail());
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    process.exit(1);
  }

  console.log(`[dev] Transcription worker ready (pid ${child.pid})`);
  return child;
}

function startServer() {
  return spawn(process.execPath, ['--watch', 'server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      CALL_TRANSCRIPTION_WORKER_EMBEDDED: 'false',
      CALL_TRANSCRIPTION_WORKER_PORT: String(workerPort),
    },
    stdio: 'inherit',
    windowsHide: true,
  });
}

function stopWorkerProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
}

function startHealthWatch() {
  if (healthTimer) clearInterval(healthTimer);
  let restartPromise = null;
  healthTimer = setInterval(() => {
    if (restartPromise) return;
    restartPromise = (async () => {
      if (shuttingDown) return;
      if (await probeTranscriptionWorkerHealth(workerPort)) return;
      console.warn('[dev] Transcription worker unhealthy — restarting…');
      stopWorkerProcess(worker);
      worker = null;
      try {
        worker = await startWorker({ reuseHealthy: false });
      } catch (error) {
        console.error('[dev] Failed to restart transcription worker:', error?.message || error);
      }
    })().finally(() => {
      restartPromise = null;
    });
  }, WORKER_HEALTH_POLL_MS);
  healthTimer.unref?.();
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (healthTimer) clearInterval(healthTimer);
  for (const child of [server, worker]) {
    if (!child || child.exitCode !== null) continue;
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(code), 250).unref?.();
}

worker = await startWorker();
server = startServer();
startHealthWatch();

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
server.on('exit', (code) => shutdown(code ?? 0));
