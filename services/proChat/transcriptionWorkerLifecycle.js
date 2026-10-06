import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../../utils/logger.js';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import {
  probeTranscriptionWorkerHealth,
  resolveRaviWorkerPort,
  resolveTranscriptionWorkerPort,
  spawnRaviWorkerProcess,
  spawnTranscriptionWorkerProcess,
  transcriptionWorkerHealthUrl,
  transcriptionWorkerLogPath,
  waitForTranscriptionWorkerHealth,
} from './transcriptionWorkerRuntime.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let transcriptionWorkerProcess = null;
let workerState = 'stopped';
let workerReadyPromise = null;
let workerReadyResolve = null;
let usingExternalTranscriptionWorker = false;
let shutdownHooksRegistered = false;

function text(value) {
  return String(value || '').trim();
}

export function featureEnabled() {
  const value = text(process.env.CALL_TRANSCRIPTION_ENABLED).toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'disabled';
}

export function isTestLifecycle() {
  return (
    text(process.env.npm_lifecycle_event).toLowerCase() === 'test' ||
    text(process.env.CALL_TRANSCRIPTION_SKIP_WORKER_HEALTH).toLowerCase() === 'true' ||
    process.execArgv.some((arg) => arg === '--test' || arg.startsWith('--test=')) ||
    process.argv.includes('--test')
  );
}

function shouldStartEmbeddedWorker() {
  const embedded = text(process.env.CALL_TRANSCRIPTION_WORKER_EMBEDDED).toLowerCase();
  if (embedded === 'false') return false;
  if (isTestLifecycle()) {
    return false;
  }
  // Multiple web processes must not each embed a worker (port / agent clashes).
  const concurrency = Number(
    process.env.WEB_CONCURRENCY ||
      process.env.RENDER_INSTANCE_COUNT ||
      process.env.CALL_TRANSCRIPTION_API_REPLICAS ||
      1,
  );
  if (Number.isFinite(concurrency) && concurrency > 1 && embedded !== 'true') {
    logger.warn(
      'Skipping embedded transcription worker because API replicas > 1. Run a dedicated worker or set CALL_TRANSCRIPTION_WORKER_EMBEDDED=true on exactly one instance.',
      { concurrency },
    );
    return false;
  }
  if (embedded === 'true') return true;
  return true;
}

function transcriptionWorkerRunning() {
  return transcriptionWorkerProcess && transcriptionWorkerProcess.exitCode === null;
}

function markWorkerReady() {
  if (workerState === 'ready') return;
  workerState = 'ready';
  workerReadyResolve?.(true);
  workerReadyResolve = null;
}

function killTrackedTranscriptionWorker() {
  if (!transcriptionWorkerProcess || transcriptionWorkerProcess.exitCode !== null) return;
  try {
    transcriptionWorkerProcess.kill('SIGTERM');
  } catch {
    // Already gone.
  }
  transcriptionWorkerProcess = null;
}

function registerTranscriptionWorkerShutdownHooks() {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const stopChildren = () => {
    killTrackedTranscriptionWorker();
    killTrackedRaviWorker();
  };
  process.once('SIGINT', stopChildren);
  process.once('SIGTERM', stopChildren);
  process.once('exit', stopChildren);
}

async function adoptExternalTranscriptionWorker(reason) {
  usingExternalTranscriptionWorker = true;
  workerState = 'ready';
  markWorkerReady();
  const port = resolveTranscriptionWorkerPort();
  logger.info('Reusing existing transcription worker', {
    reason,
    port,
    health_url: transcriptionWorkerHealthUrl(port),
  });
  return true;
}

/**
 * Ensure a LiveKit transcription worker is available.
 * - Embedded mode (default for `npm start`): spawn if needed.
 * - External mode (`CALL_TRANSCRIPTION_WORKER_EMBEDDED=false`, used by `npm run dev`):
 *   only health-check the parent-owned worker.
 */
export async function ensureTranscriptionWorkerRunning() {
  if (!featureEnabled()) return true;

  const workerPort = resolveTranscriptionWorkerPort();

  if (!shouldStartEmbeddedWorker()) {
    if (isTestLifecycle()) return true;
    if (await probeTranscriptionWorkerHealth(workerPort)) {
      return adoptExternalTranscriptionWorker('external_worker_health_ok');
    }
    const recovered = await waitForTranscriptionWorkerHealth(workerPort, 20_000);
    if (recovered) {
      return adoptExternalTranscriptionWorker('external_worker_recovered');
    }
    logger.warn('External transcription worker is not healthy', {
      port: workerPort,
      health_url: transcriptionWorkerHealthUrl(workerPort),
      log_path: transcriptionWorkerLogPath(),
    });
    return false;
  }

  if (workerState === 'ready' && (transcriptionWorkerRunning() || usingExternalTranscriptionWorker)) {
    return true;
  }
  if (workerState === 'starting' && workerReadyPromise) return workerReadyPromise;
  if (transcriptionWorkerRunning()) {
    workerState = 'ready';
    return true;
  }
  if (await probeTranscriptionWorkerHealth(workerPort)) {
    return adoptExternalTranscriptionWorker('health_probe_before_spawn');
  }

  workerState = 'starting';
  workerReadyPromise = new Promise((resolve) => {
    workerReadyResolve = resolve;
  });
  registerTranscriptionWorkerShutdownHooks();

  transcriptionWorkerProcess = spawnTranscriptionWorkerProcess({
    port: workerPort,
    logPath: transcriptionWorkerLogPath(),
    stdioMode: 'pipe-log',
  });

  transcriptionWorkerProcess.on('error', async (error) => {
    logger.warn('Transcription worker failed to start', { message: error.message, port: workerPort });
    transcriptionWorkerProcess = null;
    if (await probeTranscriptionWorkerHealth(workerPort)) {
      await adoptExternalTranscriptionWorker('spawn_error_external_worker_present');
      return;
    }
    workerState = 'stopped';
    workerReadyResolve?.(false);
    workerReadyResolve = null;
    workerReadyPromise = null;
  });

  transcriptionWorkerProcess.on('exit', async (code, signal) => {
    const wasStarting = workerState === 'starting';
    transcriptionWorkerProcess = null;

    if (!wasStarting) {
      if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
        logger.warn('Transcription worker exited unexpectedly', { code, signal, port: workerPort });
      }
      if (!usingExternalTranscriptionWorker) workerState = 'stopped';
      if (
        !usingExternalTranscriptionWorker &&
        shouldStartEmbeddedWorker() &&
        signal !== 'SIGTERM' &&
        signal !== 'SIGINT'
      ) {
        const interruptedCalls = await ProfessionalCall.find({
          status: { $in: ['connecting', 'active'] },
          transcription_status: { $in: ['dispatching', 'active'] },
        })
          .select('_id')
          .lean()
          .catch(() => []);
        if (interruptedCalls.length) {
          await ProfessionalCall.updateMany(
            {
              _id: { $in: interruptedCalls.map((call) => call._id) },
              status: { $in: ['connecting', 'active'] },
              transcription_status: { $in: ['dispatching', 'active'] },
            },
            {
              $set: {
                transcription_status: 'pending',
                transcription_started_at: null,
                transcription_dispatch_id: '',
                transcription_dispatch_generation: '',
                transcription_error_code: 'worker_restarting',
                transcription_error_message: '',
              },
            },
          ).catch(() => {});
        }
        setTimeout(() => {
          void ensureTranscriptionWorkerRunning()
            .then(async (ready) => {
              if (!ready || !interruptedCalls.length) return;
              const { scheduleTranscriptionWorkerDispatch } = await import(
                './callTranscriptionDispatchService.js'
              );
              for (const call of interruptedCalls) {
                scheduleTranscriptionWorkerDispatch(call._id);
              }
            })
            .catch((error) => {
              logger.error('Could not restart transcription worker', { message: error?.message });
            });
        }, 2_000).unref?.();
      }
      return;
    }

    if (await probeTranscriptionWorkerHealth(workerPort)) {
      await adoptExternalTranscriptionWorker('startup_exit_external_worker_present');
      return;
    }

    workerState = 'stopped';
    workerReadyResolve?.(false);
    workerReadyResolve = null;
    workerReadyPromise = null;
    logger.warn('Transcription worker process exited while starting', {
      code,
      signal,
      port: workerPort,
    });
  });

  logger.info('Starting transcription worker', {
    port: workerPort,
    pid: transcriptionWorkerProcess.pid,
    cwd: backendRoot,
  });

  const ready = await waitForTranscriptionWorkerHealth(workerPort);
  if (ready) {
    usingExternalTranscriptionWorker = false;
    markWorkerReady();
    logger.info('Transcription worker registered', {
      port: workerPort,
      pid: transcriptionWorkerProcess?.pid,
      health_url: transcriptionWorkerHealthUrl(workerPort),
    });
    return true;
  }

  if (await probeTranscriptionWorkerHealth(workerPort)) {
    return adoptExternalTranscriptionWorker('registration_timeout_external_worker_present');
  }

  logger.warn('Transcription worker registration timed out', { port: workerPort });
  killTrackedTranscriptionWorker();
  workerState = 'stopped';
  workerReadyResolve?.(false);
  workerReadyResolve = null;
  workerReadyPromise = null;
  return false;
}

let raviWorkerProcess = null;
let raviWorkerState = 'stopped';
let raviReadyPromise = null;
let raviReadyResolve = null;
let usingExternalRaviWorker = false;

function liveKitConfigured() {
  return Boolean(text(process.env.LIVEKIT_URL) && text(process.env.LIVEKIT_API_KEY) && text(process.env.LIVEKIT_API_SECRET));
}

function raviWorkerRunning() {
  return raviWorkerProcess && raviWorkerProcess.exitCode === null;
}

function killTrackedRaviWorker() {
  if (!raviWorkerProcess || raviWorkerProcess.exitCode !== null) return;
  try {
    raviWorkerProcess.kill('SIGTERM');
  } catch {
    // Already gone.
  }
  raviWorkerProcess = null;
}

function shouldStartEmbeddedRaviWorker() {
  const embedded = text(process.env.RAVI_WORKER_EMBEDDED).toLowerCase();
  if (embedded === 'false' || isTestLifecycle()) return false;
  const concurrency = Number(
    process.env.WEB_CONCURRENCY || process.env.RENDER_INSTANCE_COUNT || process.env.RAVI_WORKER_API_REPLICAS || 1,
  );
  if (Number.isFinite(concurrency) && concurrency > 1 && embedded !== 'true') return false;
  return true;
}

/** Start Ravi as a child of this API process (npm start and npm run dev). */
export async function ensureRaviWorkerRunning() {
  if (isTestLifecycle()) return true;
  if (!liveKitConfigured()) {
    logger.warn('Ravi worker not started because LiveKit credentials are missing');
    return false;
  }

  const workerPort = resolveRaviWorkerPort();
  const healthUrl = transcriptionWorkerHealthUrl(workerPort);

  if (!shouldStartEmbeddedRaviWorker()) {
    if (await probeTranscriptionWorkerHealth(workerPort) || await waitForTranscriptionWorkerHealth(workerPort, 20_000)) {
      usingExternalRaviWorker = true;
      raviWorkerState = 'ready';
      return true;
    }
    logger.warn('External Ravi worker is not healthy', { port: workerPort, health_url: healthUrl });
    return false;
  }

  if (raviWorkerState === 'ready' && (raviWorkerRunning() || usingExternalRaviWorker)) return true;
  if (raviWorkerState === 'starting' && raviReadyPromise) return raviReadyPromise;
  if (raviWorkerRunning()) {
    raviWorkerState = 'ready';
    return true;
  }
  if (await probeTranscriptionWorkerHealth(workerPort)) {
    usingExternalRaviWorker = true;
    raviWorkerState = 'ready';
    logger.info('Reusing existing Ravi worker', { port: workerPort, health_url: healthUrl });
    return true;
  }

  raviWorkerState = 'starting';
  raviReadyPromise = new Promise((resolve) => {
    raviReadyResolve = resolve;
  });
  registerTranscriptionWorkerShutdownHooks();

  raviWorkerProcess = spawnRaviWorkerProcess({ port: workerPort });
  raviWorkerProcess.on('error', (error) => {
    logger.warn('Ravi worker failed to start', { message: error.message, port: workerPort });
    raviWorkerProcess = null;
    raviWorkerState = 'stopped';
    raviReadyResolve?.(false);
    raviReadyResolve = null;
    raviReadyPromise = null;
  });
  raviWorkerProcess.on('exit', (code, signal) => {
    const wasStarting = raviWorkerState === 'starting';
    raviWorkerProcess = null;
    if (wasStarting) {
      raviWorkerState = 'stopped';
      raviReadyResolve?.(false);
      raviReadyResolve = null;
      raviReadyPromise = null;
      logger.warn('Ravi worker process exited while starting', { code, signal, port: workerPort });
      return;
    }
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      logger.warn('Ravi worker exited unexpectedly', { code, signal, port: workerPort });
    }
    if (!usingExternalRaviWorker) raviWorkerState = 'stopped';
    if (!usingExternalRaviWorker && shouldStartEmbeddedRaviWorker() && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      setTimeout(() => {
        void ensureRaviWorkerRunning().catch((error) => {
          logger.error('Could not restart Ravi worker', { message: error?.message });
        });
      }, 2_000).unref?.();
    }
  });

  logger.info('Starting Ravi worker', { port: workerPort, pid: raviWorkerProcess.pid, cwd: backendRoot });
  const ready = await waitForTranscriptionWorkerHealth(workerPort);
  if (ready) {
    usingExternalRaviWorker = false;
    raviWorkerState = 'ready';
    raviReadyResolve?.(true);
    raviReadyResolve = null;
    logger.info('Ravi worker registered', { port: workerPort, pid: raviWorkerProcess?.pid, health_url: healthUrl });
    return true;
  }

  logger.warn('Ravi worker registration timed out', { port: workerPort });
  killTrackedRaviWorker();
  raviWorkerState = 'stopped';
  raviReadyResolve?.(false);
  raviReadyResolve = null;
  raviReadyPromise = null;
  return false;
}
