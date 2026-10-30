import { AgentDispatchClient } from 'livekit-server-sdk';
import logger from '../../utils/logger.js';
import { RAVI_AGENT_NAME } from './raviAgentConstants.js';
import { ensureRaviWorkerRunning } from './transcriptionWorkerLifecycle.js';

function text(value) {
  return String(value || '').trim();
}

function httpLiveKitUrl(value) {
  return text(value).replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}

export function raviDispatchClient() {
  const host = httpLiveKitUrl(process.env.LIVEKIT_URL);
  const apiKey = text(process.env.LIVEKIT_API_KEY);
  const apiSecret = text(process.env.LIVEKIT_API_SECRET);
  if (!host || !apiKey || !apiSecret) return null;
  return new AgentDispatchClient(host, apiKey, apiSecret);
}

export async function dispatchRaviAgent({ roomName, callId, role, greeting }) {
  const client = raviDispatchClient();
  if (!client) {
    return { ok: false, message: 'LiveKit is not configured for the sales agent.' };
  }
  const workerReady = await ensureRaviWorkerRunning();
  if (!workerReady) {
    return { ok: false, message: 'Ravi worker is not running. Restart the backend and try again.' };
  }
  const metadata = JSON.stringify({
    call_id: text(callId),
    room_name: text(roomName),
    role: text(role) || 'client',
    greeting: text(greeting),
  });
  try {
    const dispatch = await Promise.race([
      client.createDispatch(text(roomName), RAVI_AGENT_NAME, { metadata }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Ravi did not join the call in time.')), 15000);
      }),
    ]);
    return { ok: true, dispatchId: text(dispatch?.id) };
  } catch (error) {
    logger.warn('Ravi agent dispatch failed', { call_id: text(callId), message: error?.message });
    return { ok: false, message: text(error?.message) || 'Ravi could not join the call.' };
  }
}
