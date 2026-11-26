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

function isRaviDispatch(item) {
  const name = text(item?.agentName || item?.agent_name);
  return !name || name === RAVI_AGENT_NAME;
}

function jobStatus(job) {
  return job?.state?.status ?? job?.status;
}

function jobIsAlive(job) {
  const status = jobStatus(job);
  return status === 0 || status === 1 || status === 'JS_PENDING' || status === 'JS_RUNNING';
}

export function raviDispatchIsAlive(item) {
  if (!item || !isRaviDispatch(item)) return false;
  if (Number(item?.state?.deletedAt || item?.state?.deleted_at || 0) > 0) return false;
  const jobs = item?.state?.jobs || [];
  if (!jobs.length) return true;
  return jobs.some(jobIsAlive);
}

export function existingRaviDispatch(list, { aliveOnly = false } = {}) {
  const ours = (list || []).filter(isRaviDispatch);
  if (aliveOnly) return ours.find(raviDispatchIsAlive) || null;
  return ours[0] || null;
}

async function listRoomDispatches(client, roomName) {
  return (await client.listDispatch(text(roomName))) || [];
}

export async function redispatchRaviAgent(options, client = raviDispatchClient()) {
  if (!client) return { ok: false, message: 'LiveKit is not configured for the sales agent.' };
  const roomName = text(options?.roomName);
  let earlier;
  try {
    earlier = await listRoomDispatches(client, roomName);
  } catch (error) {
    logger.warn('Ravi dispatch list failed, keeping any first job', { call_id: text(options?.callId), message: error?.message });
    return { ok: true, kept: true };
  }
  const live = existingRaviDispatch(earlier, { aliveOnly: true });
  if (live) {
    logger.info('Ravi is still joining, keeping the first dispatch', { call_id: text(options?.callId), dispatch_id: text(live.id) });
    return { ok: true, dispatchId: text(live.id), kept: true };
  }
  await Promise.all((earlier || []).filter(isRaviDispatch).map((item) => client.deleteDispatch(item.id, roomName).catch(() => {})));
  return dispatchRaviAgent(options, client);
}

export async function dispatchRaviAgent({ roomName, callId, role, greeting, test = null } = {}, client = raviDispatchClient()) {
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
          timer = setTimeout(() => reject(new Error('Ravi dispatch request timed out.')), 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const reuseExisting = async () => {
    try {
      const listed = await listRoomDispatches(client, roomName);
      const live = existingRaviDispatch(listed, { aliveOnly: true }) || existingRaviDispatch(listed);
      return live ? { ok: true, dispatchId: text(live.id), kept: true } : null;
    } catch (error) {
      logger.warn('Ravi dispatch list failed after a timeout', { call_id: text(callId), message: error?.message });
      return { ok: true, kept: true };
    }
  };
  try {
    let dispatch;
    try {
      dispatch = await send();
    } catch (error) {
      if (!networkProblem(error)) throw error;
      const existing = await reuseExisting();
      if (existing) {
        logger.warn('Ravi agent dispatch timed out, first dispatch is still there', { call_id: text(callId), message: error?.message });
        return existing;
      }
      logger.warn('Ravi agent dispatch timed out and no first job was found, trying once more', { call_id: text(callId), message: error?.message });
      dispatch = await send();
    }
    return { ok: true, dispatchId: text(dispatch?.id) };
  } catch (error) {
    logger.warn('Ravi agent dispatch failed', { call_id: text(callId), message: error?.message });
    const existing = await reuseExisting();
    if (existing?.dispatchId) return existing;
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
