import dotenv from 'dotenv';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dns from 'node:dns/promises';
import { AgentServer, InferenceRunner, ServerOptions, initializeLogger } from '@livekit/agents';
import {
  DEFAULT_RAVI_WORKER_PORT,
  RAVI_AGENT_DISPLAY_NAME,
  RAVI_AGENT_IDENTITY,
  RAVI_AGENT_NAME,
} from '../services/proChat/raviAgentConstants.js';
import { installDnsLookupFallback, isDnsFailure, usePublicDns } from './ravi/mongo.js';

function startupLog(level, message) {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const time = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const line = `${time} ${level}: ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function memoryFreePhrase(freeMb, totalMb) {
  const free = Number(freeMb);
  const total = Number(totalMb);
  if (!Number.isFinite(free) || !Number.isFinite(total)) return '';
  if (total >= 1024) return `${(free / 1024).toFixed(1)} GB of ${Math.round(total / 1024)} GB`;
  return `${Math.round(free)} MB of ${Math.round(total)} MB`;
}

function plainConnectReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return 'unknown error';
  const lower = text.toLowerCase();
  if (lower.includes('closed unexpectedly') || lower.includes('connection closed')) return 'the connection closed unexpectedly';
  if (/enotfound|getaddrinfo|eai_again|enodata/i.test(text)) return 'the LiveKit server could not be found';
  if (/econnreset/i.test(text)) return 'the connection was reset';
  if (/econnrefused/i.test(text)) return 'the connection was refused';
  if (/etimedout|timed out|timeout/i.test(text)) return 'the connection timed out';
  const cleaned = text.replace(/wss?:\/\/\S+/gi, '').replace(/https?:\/\/\S+/gi, '').replace(/getaddrinfo\s+/i, '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  if (!cleaned || /livekit\.cloud/i.test(cleaned)) return 'unknown error';
  return cleaned;
}

async function logStartupKeys() {
  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  startupLog(openaiKey ? 'info' : 'warn', openaiKey ? 'The OpenAI key is loaded.' : 'The OpenAI key is missing.');
  const { checkElevenLabs, elevenLabsKey } = await import('./raviVoiceTts.js');
  if (!elevenLabsKey()) {
    startupLog('warn', 'The ElevenLabs key is missing.');
    return;
  }
  const checked = await checkElevenLabs();
  if (checked?.ok && !checked.unchecked) {
    startupLog('info', 'ElevenLabs is connected.');
    return;
  }
  if (checked?.ok || checked?.unchecked) {
    startupLog('info', 'The ElevenLabs key is loaded.');
    return;
  }
  const problem = String(checked?.problem || 'unknown error').trim().replace(/\.+$/, '') || 'unknown error';
  startupLog('error', `ElevenLabs is not connected (${problem}).`);
}

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  override: true,
  quiet: true,
});

// Ravi ends a turn on the transcript (turnDetection 'stt') and never uses
// LiveKit's local audio end-of-turn model, but the server starts a separate
// process for it (about 750 MB on Nov 23) whenever its native module is
// installed. Marking it as already handled (not enumerable, so no inference
// process is created) keeps that memory free.
export function skipLocalTurnModel(runner = InferenceRunner) {
  const runners = runner?.registeredRunners;
  if (!runners || runners.lk_eot_audio) return false;
  Object.defineProperty(runners, 'lk_eot_audio', { value: 'not used by this worker', enumerable: false, configurable: true });
  return true;
}

// The API waits SHUTDOWN_WAIT_MS (25 s) for this worker; drain a little less.
const DRAIN_MS = 23_000;
const LOW_MEMORY_MB = 2048;

export function livekitHost(url) {
  try {
    return new URL(String(url || '').replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:')).hostname;
  } catch {
    return '';
  }
}

export async function resolveLiveKitHost(url) {
  const host = livekitHost(url);
  if (!host) return;
  try {
    await dns.lookup(host);
  } catch (error) {
    if (!isDnsFailure(error)) return;
    usePublicDns();
    try {
      await dns.lookup(host);
    } catch (retryError) {
      console.warn(`Ravi could not find the LiveKit server (${plainConnectReason(retryError?.message)}).`);
    }
  }
}

// One spare process: Ravi shares the one Render box with the API and the
// transcription worker, and each call process can use up to 2000 MB.
export function idleProcessCount(env = process.env) {
  const parsed = Number(env.RAVI_IDLE_PROCESSES);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return 1;
}

export function startupWarnings(env = process.env, agentName = RAVI_AGENT_NAME, totalMb = Math.round(os.totalmem() / 1048576)) {
  const warnings = [];
  if (env.RENDER && String(env.NODE_ENV || '').trim().toLowerCase() !== 'production') {
    warnings.push(`Ravi worker on Render without NODE_ENV=production registers as "${agentName}", the same name as a laptop running npm run dev, so LiveKit can send live calls to the laptop. Set NODE_ENV=production on Render.`);
  }
  if (totalMb < LOW_MEMORY_MB) {
    warnings.push(`Ravi worker has ${totalMb} MB of memory; under ${LOW_MEMORY_MB} MB a call can be cut off when the API, the transcription worker and Ravi run together.`);
  }
  return warnings;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const parsedPort = Number(process.env.RAVI_WORKER_PORT);
  const workerPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_RAVI_WORKER_PORT;
  const livekitUrl = String(process.env.LIVEKIT_URL || '').trim();
  const livekitApiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
  const livekitApiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are required for the Ravi worker.');
  }
  installDnsLookupFallback();
  await resolveLiveKitHost(livekitUrl);
  const emitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, type, code, ...rest) => {
    if (warning?.code === 'DEP0190' || type === 'DEP0190' || code === 'DEP0190') return;
    if (type && typeof type === 'object' && type.code === 'DEP0190') return;
    return emitWarning(warning, type, code, ...rest);
  };
  initializeLogger({ pretty: false, level: process.env.LOG_LEVEL || 'warn' });
  try {
    os.setPriority(0, os.constants.priority.PRIORITY_ABOVE_NORMAL);
  } catch (error) {
    console.warn(`Ravi worker could not raise its priority (${error?.message || 'unknown error'})`);
  }
  skipLocalTurnModel();
  const totalMb = Math.round(os.totalmem() / 1048576);
  const freeMb = Math.round(os.freemem() / 1048576);
  startupLog('info', `Ravi worker started. ${memoryFreePhrase(freeMb, totalMb)} memory free.`);
  for (const warning of startupWarnings(process.env, RAVI_AGENT_NAME, totalMb)) startupLog('warn', warning);
  await logStartupKeys();
  const server = new AgentServer(new ServerOptions({
    agent: path.join(path.dirname(fileURLToPath(import.meta.url)), 'raviSalesAgent.js'),
    agentName: RAVI_AGENT_NAME,
    port: workerPort,
    production: process.env.NODE_ENV === 'production',
    numIdleProcesses: idleProcessCount(),
    initializeProcessTimeout: 60_000,
    jobMemoryWarnMB: 0,
    jobMemoryLimitMB: 0,
    maxRetry: Infinity,
    wsURL: livekitUrl,
    apiKey: livekitApiKey,
    apiSecret: livekitApiSecret,
    requestFunc: async (job) => {
      await job.accept(RAVI_AGENT_DISPLAY_NAME, RAVI_AGENT_IDENTITY);
    },
  }));
  let stopping = false;
  const shutdown = async (code = 0, { drain = false } = {}) => {
    if (stopping) return;
    stopping = true;
    // Don't hang on a stuck job process; exiting also drops the LiveKit link.
    setTimeout(() => process.exit(code), (drain ? DRAIN_MS : 0) + 5000).unref();
    if (drain) {
      const live = server.activeJobs?.length || 0;
      console.log(`Ravi worker stopping: no new calls, waiting up to ${DRAIN_MS / 1000} s for ${live} live call(s)`);
      try {
        await server.drain(DRAIN_MS);
      } catch {
        console.warn('Ravi worker: a call was still live when the drain time ran out');
      }
    }
    try {
      await server.close();
    } catch {
      // Best effort.
    }
    process.exit(code);
  };
  process.once('SIGINT', () => void shutdown(130));
  // Render sends SIGTERM on a deploy: let live calls finish first.
  process.once('SIGTERM', () => void shutdown(143, { drain: true }));
  // npm run dev stops the worker through stdin (Windows can't deliver SIGTERM),
  // and a closed stdin means the launcher is gone, so leave LiveKit then too.
  if (process.env.RAVI_STDIN_CONTROL === '1' && process.stdin) {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (data) => {
      if (String(data).includes('shutdown')) void shutdown(0);
    });
    process.stdin.on('end', () => void shutdown(0));
    process.stdin.on('error', () => void shutdown(0));
  }
  server.event.on('worker_registered', () => {
    startupLog('info', 'LiveKit is connected.');
  });
  try {
    await server.run();
  } catch (error) {
    startupLog('error', `LiveKit could not connect (${plainConnectReason(error?.message)}).`);
    process.exit(1);
  }
}
