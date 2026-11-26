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
  readWorkerHealthProblem,
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
let apiRestarting = false;
let apiCodeTimer = null;
const apiCodeHashes = new Map();
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
const PINO_LEVEL = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
function pad2(value) {
  return String(value).padStart(2, '0');
}

function readableTime(time) {
  const date = new Date(typeof time === 'number' ? time : Date.now());
  if (Number.isNaN(date.getTime())) return readableTime(Date.now());
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function memoryFreePhrase(freeMb, totalMb) {
  const free = Number(freeMb);
  const total = Number(totalMb);
  if (!Number.isFinite(free) || !Number.isFinite(total)) return '';
  if (total >= 1024) return `${(free / 1024).toFixed(1)} GB of ${Math.round(total / 1024)} GB`;
  return `${Math.round(free)} MB of ${Math.round(total)} MB`;
}

function memoryUsedPhrase(usedMb) {
  const used = Number(usedMb);
  if (!Number.isFinite(used)) return '';
  if (used >= 1024) return `${(used / 1024).toFixed(1)} GB`;
  return `${Math.round(used)} MB`;
}

function plainConnectReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  if (lower.includes('closed unexpectedly') || lower.includes('connection closed')) return 'The connection closed unexpectedly.';
  if (/enotfound|getaddrinfo|eai_again|enodata/i.test(text)) return 'The LiveKit server could not be found.';
  if (/econnreset/i.test(text)) return 'The connection was reset.';
  if (/econnrefused/i.test(text)) return 'The connection was refused.';
  if (/etimedout|timed out|timeout/i.test(text)) return 'The connection timed out.';
  const cleaned = text.replace(/wss?:\/\/\S+/gi, '').replace(/https?:\/\/\S+/gi, '').replace(/getaddrinfo\s+/i, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || /livekit\.cloud/i.test(cleaned)) return '';
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function startedMessage(freeMb, totalMb) {
  return `Ravi worker started. ${memoryFreePhrase(freeMb, totalMb)} memory free.`;
}

function liveKitLostMessage(seconds, attempt, limit, reason) {
  const wait = Number(seconds) === 1 ? '1 second' : `${seconds} seconds`;
  const tries = /^\d+$/.test(String(limit || '')) ? ` (try ${attempt} of ${limit})` : ` (try ${attempt})`;
  const why = plainConnectReason(reason);
  return `The LiveKit connection was lost. Retrying in ${wait}${tries}.${why ? ` ${why}` : ''}`;
}

function readableStartingLine(line) {
  const trimmed = line.trim();
  const raw = trimmed.match(/^Ravi worker starting agent=\S+ memory_total_mb=(\d+) memory_free_mb=(\d+) idle_processes=\d+\s*$/);
  if (raw) return `${readableTime(Date.now())} info: ${startedMessage(raw[2], raw[1])}`;
  const mid = trimmed.match(/^(?:(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) info: )?Ravi worker starting \(agent \S+, memory (\d+) MB free of (\d+) MB(?:, idle processes \d+)?\)\s*$/);
  if (mid) return `${mid[1] || readableTime(Date.now())} info: ${startedMessage(mid[2], mid[3])}`;
  return null;
}

function readableStartupLine(line) {
  const trimmed = line.trim();
  const stamped = trimmed.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (info|warn|error): (.*)$/);
  const time = stamped ? stamped[1] : null;
  const level = stamped ? stamped[2] : null;
  const message = stamped ? stamped[3] : trimmed;
  const replacements = [
    [/^OpenAI key loaded\.?$/, 'info', 'The OpenAI key is loaded.'],
    [/^OpenAI key missing\.?$/, 'warn', 'The OpenAI key is missing.'],
    [/^ElevenLabs connected\.?$/, 'info', 'ElevenLabs is connected.'],
    [/^ElevenLabs key loaded\.?$/, 'info', 'The ElevenLabs key is loaded.'],
    [/^ElevenLabs key missing\.?$/, 'warn', 'The ElevenLabs key is missing.'],
    [/^LiveKit connected\.?$/, 'info', 'LiveKit is connected.'],
  ];
  for (const [pattern, nextLevel, nextMessage] of replacements) {
    if (pattern.test(message)) return `${time || readableTime(Date.now())} ${level || nextLevel}: ${nextMessage}`;
  }
  const eleven = message.match(/^ElevenLabs not connected \((.+)\)\.?$/);
  if (eleven) {
    const problem = eleven[1].trim().replace(/\.+$/, '') || 'unknown error';
    return `${time || readableTime(Date.now())} ${level || 'error'}: ElevenLabs is not connected (${problem}).`;
  }
  const failed = message.match(/^LiveKit connection failed \((.+)\)\.?$/);
  if (failed) {
    const why = plainConnectReason(failed[1]) || 'unknown error.';
    const reason = why.endsWith('.') ? why.slice(0, -1).replace(/^The /, 'the ') : why;
    return `${time || readableTime(Date.now())} ${level || 'error'}: LiveKit could not connect (${reason}).`;
  }
  const lost = message.match(/^LiveKit connection lost, retrying in (\d+) s \((?:attempt (\d+)|(\d+)\/(\S+))\)(?:: (.*))?$/);
  if (lost) {
    const attempt = lost[2] || lost[3];
    const limit = lost[4];
    return `${time || readableTime(Date.now())} ${level || 'warn'}: ${liveKitLostMessage(lost[1], attempt, limit, lost[5] || '')}`;
  }
  return null;
}

function readableMemoryLine(record) {
  if (!Number.isFinite(record.memoryUsageMB)) return '';
  const mentionsMemory = /memory/i.test(record.msg || '');
  if (!mentionsMemory) return '';
  return `The call process is using ${memoryUsedPhrase(record.memoryUsageMB)} of memory.`;
}

function readableMessage(record) {
  const reason = typeof record.error?.message === 'string' ? record.error.message : '';
  const lost = record.msg.match(/^failed to connect to LiveKit server \([^)]*\), retrying in (\d+) seconds: \((\d+)\/([^)]+)\)$/);
  if (lost) return liveKitLostMessage(lost[1], lost[2], lost[3], reason);
  if (/failed to connect to LiveKit|worker connection closed unexpectedly/i.test(record.msg)) {
    const why = plainConnectReason(reason || record.msg);
    return why ? `The LiveKit connection was lost. ${why}` : 'The LiveKit connection was lost.';
  }
  if (reason && !record.msg.includes(reason)) {
    const why = plainConnectReason(reason);
    return why ? `${record.msg} ${why}`.trim() : record.msg;
  }
  return record.msg;
}

function readableWorkerLine(line) {
  const started = readableStartingLine(line);
  if (started) return started;
  const startup = readableStartupLine(line);
  if (startup) return startup;
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return line;
  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return line;
  }
  if (record == null || typeof record !== 'object' || record.level == null || typeof record.msg !== 'string') return line;
  const level = PINO_LEVEL[record.level] || String(record.level);
  const memory = readableMemoryLine(record);
  const message = memory || readableMessage(record);
  return `${readableTime(record.time)} ${level}: ${message}`;
}

function quietDebugLines(stream, logPath) {
  let rest = '';
  return (chunk) => {
    const text = chunk.toString('utf8');
    if (RAVI_DEBUG) {
      stream.write(text);
      if (logPath) appendTranscriptionWorkerLog(text, logPath);
      return;
    }
    const lines = (rest + text).split(/\r?\n/);
    rest = lines.pop() || '';
    for (const line of lines) {
      if (/^\s*\{"level":(10|20),/.test(line)) continue;
      const formatted = `${readableWorkerLine(line)}\n`;
      stream.write(formatted);
      if (logPath) appendTranscriptionWorkerLog(formatted, logPath);
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
  const toStdout = quietDebugLines(process.stdout, raviLog);
  const toStderr = quietDebugLines(process.stderr, raviLog);
  child.stdout?.on('data', (chunk) => {
    toStdout(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    toStderr(chunk);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown || raviStopRequested) return;
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

let raviNetworkWarned = false;

async function checkRaviWorker() {
  if (shuttingDown || raviRestartTimer || raviRestarting) return;
  const port = resolveRaviWorkerPort();
  // The process is still up. A dropped LiveKit lookup must not kill it and start another.
  if (raviWorker && raviWorker.exitCode === null) {
    const healthy = await probeTranscriptionWorkerHealth(port);
    if (healthy) {
      consecutiveRaviHealthFailures = 0;
      raviRestartCount = 0;
      raviNetworkWarned = false;
      return;
    }
    if (!raviNetworkWarned) {
      raviNetworkWarned = true;
      console.warn('[dev] Ravi is still running. A dropped connection will not restart him.');
    }
    return;
  }
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
  return spawn(process.execPath, ['server.js'], {
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

function scheduleServerRestart(reason = 'exited') {
  if (shuttingDown || serverRestartTimer || apiRestarting) return;
  console.warn(`[dev] API server ${reason}. Restarting in ${Math.round(SERVER_RESTART_DELAY_MS / 1000)} s…`);
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    if (shuttingDown) return;
    apiRestarting = true;
    const previous = server;
    server = null;
    previous?.removeAllListeners('exit');
    stopWorkerProcess(previous);
    server = startServer();
    wireServerLifecycle(server);
    apiRestarting = false;
  }, SERVER_RESTART_DELAY_MS);
  serverRestartTimer.unref?.();
}

function wireServerLifecycle(child) {
  child.on('exit', (code, signal) => {
    if (shuttingDown || apiRestarting) return;
    console.warn(`[dev] API server exited (code=${code}, signal=${signal})`);
    scheduleServerRestart('exited');
  });
}

// Ask the Ravi worker to leave LiveKit cleanly, so LiveKit doesn't keep
// sending calls to a worker that is gone; force it after 6 s.
let raviStopRequested = false;

function stopRaviWorker(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  raviStopRequested = true;
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
      raviStopRequested = false;
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
      if ((await readWorkerHealthProblem(workerPort)) === 'livekit') {
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
const API_WATCH_DIRS = ['config', 'constants', 'controllers', 'jobs', 'middleware', 'models', 'routes', 'schemas', 'services', 'utils'];
const API_WATCH_FILES = ['server.js', 'app.js'];
const API_WATCH_EXT = new Set(['.js', '.mjs', '.cjs']);
const API_WATCH_IGNORE = /(?:^|[\\/])(?:node_modules|logs|coverage|tests|uploads|tmp|temp|\.git)(?:[\\/]|$)/i;

function shouldWatchApiFile(rel) {
  const normalized = String(rel || '').replace(/\\/g, '/');
  if (!normalized || API_WATCH_IGNORE.test(normalized) || /\.log$/i.test(normalized)) return false;
  return API_WATCH_EXT.has(path.extname(normalized));
}

function watchApiCode() {
  const mark = (rel) => {
    const key = rel.replace(/\\/g, '/');
    const hash = fileHash(path.join(backendRoot, rel));
    if (hash) apiCodeHashes.set(key, hash);
  };
  for (const name of API_WATCH_FILES) mark(name);
  for (const dir of API_WATCH_DIRS) {
    const root = path.join(backendRoot, dir);
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      let entries = [];
      const current = stack.pop();
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const rel = path.relative(backendRoot, path.join(current, entry.name));
        const norm = rel.replace(/\\/g, '/');
        if (API_WATCH_IGNORE.test(norm)) continue;
        if (entry.isDirectory()) {
          stack.push(path.join(current, entry.name));
          continue;
        }
        if (shouldWatchApiFile(rel)) mark(rel);
      }
    }
  }
  const queue = (rel) => {
    if (shuttingDown || !shouldWatchApiFile(rel)) return;
    clearTimeout(apiCodeTimer);
    apiCodeTimer = setTimeout(() => {
      const changed = [];
      for (const [key, before] of apiCodeHashes) {
        const next = fileHash(path.join(backendRoot, key));
        if (!next || next === before) continue;
        apiCodeHashes.set(key, next);
        changed.push(key);
      }
      const relKey = String(rel).replace(/\\/g, '/');
      if (shouldWatchApiFile(relKey) && !apiCodeHashes.has(relKey)) {
        const next = fileHash(path.join(backendRoot, relKey));
        if (next) {
          apiCodeHashes.set(relKey, next);
          if (!changed.includes(relKey)) changed.push(relKey);
        }
      }
      if (!changed.length) return;
      scheduleServerRestart(`code changed (${changed.join(', ')})`);
    }, 1500);
    apiCodeTimer.unref?.();
  };
  for (const name of API_WATCH_FILES) {
    try {
      fs.watch(path.join(backendRoot, name), () => queue(name)).unref?.();
    } catch {
    }
  }
  for (const dir of API_WATCH_DIRS) {
    const full = path.join(backendRoot, dir);
    if (!fs.existsSync(full)) continue;
    try {
      fs.watch(full, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        queue(path.join(dir, String(filename)));
      }).unref?.();
    } catch {
    }
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
watchApiCode();
server = startServer();
wireServerLifecycle(server);
startHealthWatch();

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
