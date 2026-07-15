import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import v8 from 'node:v8';
import {
  AgentServer,
  ServerOptions,
  initializeLogger,
  log,
} from '@livekit/agents';
import {
  DEFAULT_TRANSCRIPTION_WORKER_PORT,
  TRANSCRIPTION_AGENT_DISPLAY_NAME,
  TRANSCRIPTION_AGENT_IDENTITY,
  TRANSCRIPTION_AGENT_NAME,
} from '../services/proChat/callTranscriptionConstants.js';

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const parsedPort = Number(process.env.CALL_TRANSCRIPTION_WORKER_PORT);
  const workerPort =
    Number.isFinite(parsedPort) && parsedPort > 0
      ? parsedPort
      : DEFAULT_TRANSCRIPTION_WORKER_PORT;

  const livekitUrl = String(process.env.LIVEKIT_URL || '').trim();
  const livekitApiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
  const livekitApiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    throw new Error(
      'LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are required for the transcription worker.',
    );
  }

  // Job children import callTranscriberAgent.js — keep this file as a thin runner only.
  const agentPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'callTranscriberAgent.js',
  );

  initializeLogger({ pretty: false, level: process.env.LOG_LEVEL || 'info' });
  const logger = log();
  const server = new AgentServer(
    new ServerOptions({
      agent: agentPath,
      agentName: TRANSCRIPTION_AGENT_NAME,
      port: workerPort,
      production: process.env.NODE_ENV === 'production',
      // Keep one warm job process so notes start within the call, not after it ends.
      numIdleProcesses: 1,
      initializeProcessTimeout: 120_000,
      loadThreshold: Math.min(
        0.95,
        Math.max(0.1, Number(process.env.CALL_TRANSCRIPTION_LOAD_THRESHOLD) || 0.8),
      ),
      loadFunc: async () => {
        const memory = process.memoryUsage();
        
        const heapLimit = v8.getHeapStatistics().heap_size_limit;
        const memoryLoad = heapLimit > 0 ? memory.heapUsed / heapLimit : 0;
        return Math.min(1, Math.max(0.05, memoryLoad));
      },
      wsURL: livekitUrl,
      apiKey: livekitApiKey,
      apiSecret: livekitApiSecret,
      requestFunc: async (job) => {
        await job.accept(
          TRANSCRIPTION_AGENT_DISPLAY_NAME,
          TRANSCRIPTION_AGENT_IDENTITY,
        );
      },
    }),
  );

  const shutdown = async (code = 0) => {
    try {
      await server.close();
    } catch {
      // Best effort.
    }
    process.exit(code);
  };

  process.once('SIGINT', () => void shutdown(130));
  process.once('SIGTERM', () => void shutdown(143));

  try {
    await server.run();
  } catch (error) {
    logger.fatal(
      {
        err: error,
        message: error?.message,
        stack: error?.stack,
        port: workerPort,
      },
      'Transcription worker failed to start',
    );
    console.error('Transcription worker failed to start:', error);
    process.exit(1);
  }
}
