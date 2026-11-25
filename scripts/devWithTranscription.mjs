import 'dotenv/config';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendTranscriptionWorkerLog,
  probeTranscriptionWorkerHealth,
  raviWorkerLogPath,
  readTranscriptionWorkerLogTail,
  resolveRaviWorkerPort,
  resolveTranscriptionWorkerPort,
  spawnRaviWorkerProcess,
  spawnTranscriptionWorkerProcess,
  transcriptionWorkerLogPath,
  waitForTranscriptionWorkerHealth,
} from '../services/proChat/transcriptionWorkerRuntime.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerPort = resolveTranscriptionWorkerPort();
const logPath = transcriptionWorkerLogPath();
const WORKER_HEALTH_POLL_MS = 15_000;
const WORKER_HEALTH_FAILURE_THRESHOLD = Math.max(
  1,
  Number(process.env.CALL_TRANSCRIPTION_HEALTH_FAILURE_THRESHOLD) || 3,
);

let worker = null;
let raviWorker = null;
let server = null;
let shuttingDown = false;
let healthTimer = null;
let serverRestartTimer = null;
const SERVER_RESTART_DELAY_MS = 800;
let consecutiveWorkerHealthFailures = 0;
let consecutiveRaviHealthFailures = 0;
let raviRestartTimer = null;
let raviRestarting = false;
let raviRestartCount = 0;
// One npm run dev at a time: two launchers fight over the worker ports and
// LiveKit can send a test call to a worker that is already gone.
const lockPath = path.join(os.tmpdir(), 'nesti-dev-launcher.pid');
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}
function takeLauncherLock() {
  try {
    const other = Number(fs.readFileSync(lockPath, 'utf8').trim());
    if (other && other !== process.pid && isAlive(other)) {
      console.error(`[dev] npm run dev is already running (pid ${other}). Stop that one first (Ctrl+C in its window, or: taskkill /PID ${other} /T /F), then start again.`);
      process.exit(1);
    }
  } catch {
    // no lock yet
  }
  fs.writeFileSync(lockPath, String(process.pid));
  process.on('exit', () => {
    try {
      if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  });
}
const RAVI_DEBUG = /^(1|true|yes)$/i.test(String(process.env.RAVI_DEBUG || ''));
function quietDebugLines(stream) {
  let rest = '';
  return (chunk) => {
    if (RAVI_DEBUG) {
      stream.write(chunk);
      return;
    }
    const lines = (rest + chunk.toString('utf8')).split('\n');
    rest = lines.pop() || '';
    for (const line of lines) {
      if (!/^\s*\{"level":(10|20),/.test(line)) stream.write(`${line}\n`);
    }
  };
}

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
    console.error('[dev] Transcription worker failed to become ready. The API will keep running and the worker will be retried.');
    console.error(readTranscriptionWorkerLogTail());
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    return null;
  }

  console.log(`[dev] Transcription worker ready (pid ${child.pid})`);
  return child;
}

async function startRaviWorker({ reuseHealthy = true } = {}) {
  const raviPort = resolveRaviWorkerPort();
  if (reuseHealthy && (await probeTranscriptionWorkerHealth(raviPort))) {
    console.log(`[dev] Reusing Ravi worker on :${raviPort}`);
    return null;
  }
  const raviLog = raviWorkerLogPath();
  console.log(`[dev] Starting Ravi worker on :${raviPort}`);
  console.log(`[dev] Ravi worker log: ${raviLog}`);
  // stdin stays open so the worker can be asked to stop cleanly (Windows
  // can't deliver SIGTERM to it) and stops by itself if this launcher dies.
  const child = spawnRaviWorkerProcess({
    port: raviPort,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, RAVI_STDIN_CONTROL: '1' },
  });
  child.stdin?.on('error', () => {});
  const toStdout = quietDebugLines(process.stdout);
  const toStderr = quietDebugLines(process.stderr);
  child.stdout?.on('data', (chunk) => {
    toStdout(chunk);
    appendTranscriptionWorkerLog(chunk, raviLog);
  });
  child.stderr?.on('data', (chunk) => {
    toStderr(chunk);
    appendTranscriptionWorkerLog(chunk, raviLog);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.warn(`[dev] Ravi worker exited (code=${code}, signal=${signal})`);
    if (raviWorker === child) scheduleRaviRestart('exited');
  });
  const ready = await waitForTranscriptionWorkerHealth(raviPort);
  if (!ready) {
    console.error('[dev] Ravi worker did not become ready. Test calls cannot connect until it does.');
  } else {
    console.log(`[dev] Ravi worker ready (pid ${child.pid})`);
  }
  return child;
}

function scheduleRaviRestart(reason) {
  if (shuttingDown || raviRestartTimer || raviRestarting) return;
  const delayMs = Math.min(60_000, 2_000 * 2 ** raviRestartCount);
  raviRestartCount += 1;
  console.warn(`[dev] Ravi worker ${reason}. Restarting in ${Math.round(delayMs / 1000)} s…`);
  raviRestartTimer = setTimeout(async () => {
    raviRestartTimer = null;
    if (shuttingDown) return;
    raviRestarting = true;
    const previous = raviWorker;
    raviWorker = null;
    await stopRaviWorker(previous);
    try {
      if (await probeTranscriptionWorkerHealth(resolveRaviWorkerPort())) {
        // Something else still holds the port: usually a second npm run dev.
        console.error(`[dev] Port ${resolveRaviWorkerPort()} is still used by another Ravi worker, probably from another npm run dev window. Close the other one; this one won't start a second worker.`);
        return;
      }
      raviWorker = await startRaviWorker({ reuseHealthy: false });
    } catch (error) {
      console.error('[dev] Failed to restart Ravi worker:', error?.message || error);
    } finally {
      raviRestarting = false;
    }
  }, delayMs);
  raviRestartTimer.unref?.();
}

async function checkRaviWorker() {
  if (shuttingDown || raviRestartTimer || raviRestarting) return;
  const port = resolveRaviWorkerPort();
  let healthy = await probeTranscriptionWorkerHealth(port);
  if (!healthy) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    healthy = await probeTranscriptionWorkerHealth(port, 8000);
  }
  if (healthy) {
    consecutiveRaviHealthFailures = 0;
    raviRestartCount = 0;
    return;
  }
  consecutiveRaviHealthFailures += 1;
  console.warn(`[dev] Ravi worker health check failed (${consecutiveRaviHealthFailures}/${WORKER_HEALTH_FAILURE_THRESHOLD})`);
  if (consecutiveRaviHealthFailures < WORKER_HEALTH_FAILURE_THRESHOLD) return;
  consecutiveRaviHealthFailures = 0;
  scheduleRaviRestart('is unhealthy');
}

function startServer() {
  return spawn(process.execPath, ['--watch', 'server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      CALL_TRANSCRIPTION_WORKER_EMBEDDED: 'false',
      CALL_TRANSCRIPTION_WORKER_PORT: String(workerPort),
      RAVI_WORKER_EMBEDDED: 'false',
    },
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
}

function scheduleServerRestart() {
  if (shuttingDown || serverRestartTimer) return;
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    if (shuttingDown) return;
    console.log('[dev] Restarting API server process…');
    server = startServer();
    wireServerLifecycle(server);
  }, SERVER_RESTART_DELAY_MS);
  serverRestartTimer.unref?.();
}

function wireServerLifecycle(child) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.warn(`[dev] API server exited (code=${code}, signal=${signal})`);
    scheduleServerRestart();
  });
}

// Ask the Ravi worker to leave LiveKit cleanly, so LiveKit doesn't keep
// sending calls to a worker that is gone; force it after 6 s.
function stopRaviWorker(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 6000);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    try {
      child.stdin?.write('shutdown\n');
    } catch {
      child.kill('SIGTERM');
    }
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
      await checkRaviWorker();
      const healthy = await probeTranscriptionWorkerHealth(workerPort);
      if (healthy) {
        consecutiveWorkerHealthFailures = 0;
        return;
      }
      consecutiveWorkerHealthFailures += 1;
      console.warn(
        `[dev] Transcription worker health check failed (${consecutiveWorkerHealthFailures}/${WORKER_HEALTH_FAILURE_THRESHOLD})`,
      );
      if (consecutiveWorkerHealthFailures < WORKER_HEALTH_FAILURE_THRESHOLD) return;
      console.warn('[dev] Transcription worker unhealthy — restarting…');
      consecutiveWorkerHealthFailures = 0;
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
  if (serverRestartTimer) {
    clearTimeout(serverRestartTimer);
    serverRestartTimer = null;
  }
  if (healthTimer) clearInterval(healthTimer);
  if (raviRestartTimer) clearTimeout(raviRestartTimer);
  for (const child of [server, worker]) {
    if (!child || child.exitCode !== null) continue;
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  const exit = setTimeout(() => process.exit(code), 7000);
  stopRaviWorker(raviWorker).finally(() => {
    clearTimeout(exit);
    process.exit(code);
  });
}

const RAVI_WATCHED = {
  workers: ['raviSalesAgent.js', 'raviSalesWorker.js'],
  'workers/ravi': ['callBrief.js', 'callEnd.js', 'callLifecycle.js', 'callState.js', 'callTools.js', 'callerTurns.js', 'cloneVoice.js', 'lines.js', 'mongo.js', 'pipelineSave.js', 'prepareCall.js', 'quietCheckIn.js', 'raviAgent.js', 'replyLlm.js', 'session.js', 'startCall.js', 'text.js', 'transcript.js', 'turnLatency.js'],
  'services/proChat': ['voiceSalesBrief.js', 'voiceAgentTurnService.js', 'spokenScript.js', 'replyPace.js', 'salesPipeline.js', 'salesQuestionGuides.js', 'voiceCallSummaryEmail.js'],
  'services/client': ['plans.js', 'entitlements.js'],
  'services/billing': ['plans.js', 'entitlements.js'],
};
let raviCodeTimer = null;
const raviCodeHashes = new Map();
function fileHash(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}
function watchRaviCode() {
  for (const [dir, files] of Object.entries(RAVI_WATCHED)) {
    for (const name of files) raviCodeHashes.set(path.join(dir, name), fileHash(path.join(backendRoot, dir, name)));
    try {
      fs.watch(path.join(backendRoot, dir), (_event, filename) => {
        if (shuttingDown || !files.includes(String(filename || ''))) return;
        clearTimeout(raviCodeTimer);
        raviCodeTimer = setTimeout(() => {
          const changed = [];
          for (const [key, before] of raviCodeHashes) {
            const next = fileHash(path.join(backendRoot, key));
            if (!next || next === before) continue;
            raviCodeHashes.set(key, next);
            changed.push(key.replace(/\\/g, '/'));
          }
          if (!changed.length) return;
          raviRestartCount = 0;
          scheduleRaviRestart(`code changed (${changed.join(', ')})`);
        }, 2500);
        raviCodeTimer.unref?.();
      }).unref?.();
    } catch {
    }
  }
}

takeLauncherLock();
worker = await startWorker();
raviWorker = await startRaviWorker();
watchRaviCode();
server = startServer();
wireServerLifecycle(server);
startHealthWatch();

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
