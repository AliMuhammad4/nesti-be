import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AgentServer, ServerOptions, initializeLogger } from '@livekit/agents';
import {
  DEFAULT_RAVI_WORKER_PORT,
  RAVI_AGENT_DISPLAY_NAME,
  RAVI_AGENT_IDENTITY,
  RAVI_AGENT_NAME,
} from '../services/proChat/raviAgentConstants.js';

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  override: true,
  quiet: true,
});

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
  const emitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, type, code, ...rest) => {
    if (warning?.code === 'DEP0190' || type === 'DEP0190' || code === 'DEP0190') return;
    if (type && typeof type === 'object' && type.code === 'DEP0190') return;
    return emitWarning(warning, type, code, ...rest);
  };
  initializeLogger({ pretty: false, level: process.env.LOG_LEVEL || 'warn' });
  const server = new AgentServer(new ServerOptions({
    agent: path.join(path.dirname(fileURLToPath(import.meta.url)), 'raviSalesAgent.js'),
    agentName: RAVI_AGENT_NAME,
    port: workerPort,
    production: process.env.NODE_ENV === 'production',
    numIdleProcesses: 1,
    initializeProcessTimeout: 120_000,
    wsURL: livekitUrl,
    apiKey: livekitApiKey,
    apiSecret: livekitApiSecret,
    requestFunc: async (job) => {
      await job.accept(RAVI_AGENT_DISPLAY_NAME, RAVI_AGENT_IDENTITY);
    },
  }));
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
    console.error('Ravi worker failed to start:', error);
    process.exit(1);
  }
}
