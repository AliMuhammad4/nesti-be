import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TRANSCRIPTION_WORKER_PORT } from './callTranscriptionConstants.js';
import { DEFAULT_RAVI_WORKER_PORT } from './raviAgentConstants.js';

export { DEFAULT_TRANSCRIPTION_WORKER_PORT };
export const TRANSCRIPTION_WORKER_READY_TIMEOUT_MS = 45_000;
export const TRANSCRIPTION_WORKER_HEALTH_POLL_MS = 400;
export const TRANSCRIPTION_WORKER_HEALTH_TIMEOUT_MS = 4_000;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workerEntryPath = path.join(backendRoot, 'workers', 'callTranscriberWorker.js');
const raviWorkerEntryPath = path.join(backendRoot, 'workers', 'raviSalesWorker.js');

function workerChildEnv(env, extra = {}) {
  const next = { ...env, ...extra, NODE_OPTIONS: '' };
  delete next.NODE_CHANNEL_FD;
  delete next.NODE_CHANNEL_SERIALIZATION_MODE;
  delete next.NODE_UNIQUE_ID;
  return next;
}

export function resolveTranscriptionWorkerPort(env = process.env) {
  const parsed = Number(env.CALL_TRANSCRIPTION_WORKER_PORT);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_TRANSCRIPTION_WORKER_PORT;
}

export function transcriptionWorkerLogPath() {
  return path.join(os.tmpdir(), 'nesti-transcription-worker.log');
}

export function transcriptionWorkerHealthUrl(port = resolveTranscriptionWorkerPort()) {
  const host = String(process.env.CALL_TRANSCRIPTION_WORKER_HOST || '127.0.0.1').trim() || '127.0.0.1';
  return `http://${host}:${port}/`;
}

export async function probeTranscriptionWorkerHealth(
  port = resolveTranscriptionWorkerPort(),
  timeoutMs = TRANSCRIPTION_WORKER_HEALTH_TIMEOUT_MS,
) {
  try {
    const response = await fetch(transcriptionWorkerHealthUrl(port), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForTranscriptionWorkerHealth(
  port = resolveTranscriptionWorkerPort(),
  timeoutMs = TRANSCRIPTION_WORKER_READY_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await probeTranscriptionWorkerHealth(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, TRANSCRIPTION_WORKER_HEALTH_POLL_MS));
  }
  return false;
}

export function resolveRaviWorkerPort(env = process.env) {
  const parsed = Number(env.RAVI_WORKER_PORT);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RAVI_WORKER_PORT;
}

export function spawnRaviWorkerProcess({
  port = resolveRaviWorkerPort(),
  env = process.env,
  stdio = 'inherit',
} = {}) {
  return spawn(process.execPath, [raviWorkerEntryPath], {
    cwd: backendRoot,
    env: workerChildEnv(env, {
      RAVI_WORKER_PORT: String(port),
      DOTENV_CONFIG_QUIET: 'true',
    }),
    detached: false,
    windowsHide: true,
    shell: false,
    stdio,
  });
}

/**
 * Spawn the LiveKit transcription worker without a detached console on Windows.
 * Caller owns lifecycle (kill on shutdown).
 */
export function spawnTranscriptionWorkerProcess({
  port = resolveTranscriptionWorkerPort(),
  logPath = transcriptionWorkerLogPath(),
  env = process.env,
  stdioMode = 'pipe-log',
} = {}) {
  let stdio = 'inherit';
  let logFd = null;

  if (stdioMode === 'pipe-log') {
    try {
      // Append instead of truncating so intermittent worker failures remain inspectable.
      logFd = fs.openSync(logPath, 'a');
      stdio = ['ignore', logFd, logFd];
    } catch {
      stdio = 'ignore';
      logFd = null;
    }
  } else if (stdioMode === 'ignore') {
    stdio = 'ignore';
  } else {
    stdio = 'inherit';
  }

  const child = spawn(process.execPath, [workerEntryPath], {
    cwd: backendRoot,
    env: workerChildEnv(env, { CALL_TRANSCRIPTION_WORKER_PORT: String(port) }),
    detached: false,
    windowsHide: true,
    shell: false,
    stdio,
  });

  if (typeof logFd === 'number') {
    try {
      fs.closeSync(logFd);
    } catch {
      // Child keeps duplicated fds.
    }
  }

  return child;
}

export function appendTranscriptionWorkerLog(chunk, logPath = transcriptionWorkerLogPath()) {
  try {
    fs.appendFileSync(logPath, chunk);
  } catch {
    // Best effort.
  }
}

export function readTranscriptionWorkerLogTail(maxChars = 2000) {
  try {
    const contents = fs.readFileSync(transcriptionWorkerLogPath(), 'utf8');
    return contents.slice(-maxChars);
  } catch {
    return '';
  }
}
