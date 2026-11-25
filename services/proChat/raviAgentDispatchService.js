import { AgentDispatchClient } from 'livekit-server-sdk';
import logger from '../../utils/logger.js';
import { RAVI_AGENT_NAME } from './raviAgentConstants.js';
import { ensureRaviWorkerRunning, raviWorkerProblem } from './transcriptionWorkerLifecycle.js';
import { raviWorkerProblemMessage } from './transcriptionWorkerRuntime.js';

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

// Second try when Ravi hasn't joined a call in time: drop the earlier
// dispatch, then send a fresh one. The worker also leaves a room that already
// has a Ravi, so the call never gets two.
export async function redispatchRaviAgent(options) {
  const client = raviDispatchClient();
  if (!client) return { ok: false, message: 'LiveKit is not configured for the sales agent.' };
  try {
    const earlier = await client.listDispatch(text(options?.roomName));
    await Promise.all((earlier || []).map((item) => client.deleteDispatch(item.id, text(options?.roomName)).catch(() => {})));
  } catch (error) {
    logger.warn('Ravi earlier dispatch cleanup failed', { call_id: text(options?.callId), message: error?.message });
  }
  return dispatchRaviAgent(options);
}

export async function dispatchRaviAgent({ roomName, callId, role, greeting, test = null }) {
  const client = raviDispatchClient();
  if (!client) {
    return { ok: false, message: 'LiveKit is not configured for the sales agent.' };
  }
  const workerReady = await ensureRaviWorkerRunning();
  if (!workerReady) {
    return { ok: false, message: raviWorkerProblemMessage(raviWorkerProblem()) };
  }
  const metadata = JSON.stringify({
    call_id: text(callId),
    room_name: text(roomName),
    role: text(role) || 'client',
    greeting: text(greeting),
    ...(test ? { test } : {}),
  });
  const send = async () => {
    let timer;
    try {
      return await Promise.race([
        client.createDispatch(text(roomName), RAVI_AGENT_NAME, { metadata }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Ravi did not join the call in time.')), 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let dispatch;
    try {
      dispatch = await send();
    } catch (error) {
      if (!networkProblem(error)) throw error;
      // The worker leaves a room that already has a Ravi, so a late first
      // dispatch cannot give the call two agents.
      logger.warn('Ravi agent dispatch timed out, trying once more', { call_id: text(callId), message: error?.message });
      dispatch = await send();
    }
    return { ok: true, dispatchId: text(dispatch?.id) };
  } catch (error) {
    logger.warn('Ravi agent dispatch failed', { call_id: text(callId), message: error?.message });
    const message = networkProblem(error)
      ? 'LiveKit did not answer in time. Check the internet connection and try again.'
      : text(error?.message) || 'Ravi could not join the call.';
    return { ok: false, message };
  }
}

function networkProblem(error) {
  const detail = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`;
  return /timeout|timed out|in time|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|network/i.test(detail);
}
