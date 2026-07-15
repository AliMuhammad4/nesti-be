import { RoomServiceClient } from 'livekit-server-sdk';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import logger from '../../utils/logger.js';
import {
  noConsentArtifactSet,
} from './callArtifactFields.js';

let cachedClient = null;
let cachedConfigKey = '';

function httpLiveKitUrl(value) {
  return String(value || '')
    .trim()
    .replace(/^wss:/i, 'https:')
    .replace(/^ws:/i, 'http:');
}

function getRoomServiceClient() {
  const url = httpLiveKitUrl(process.env.LIVEKIT_URL);
  const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
  if (!url || !apiKey || !apiSecret) return null;
  const configKey = `${url}|${apiKey}|${apiSecret}`;
  if (!cachedClient || cachedConfigKey !== configKey) {
    cachedClient = new RoomServiceClient(url, apiKey, apiSecret);
    cachedConfigKey = configKey;
  }
  return cachedClient;
}

export async function verifyLiveKitCallPresence(roomName, expectedParticipantIds = []) {
  if (
    process.execArgv.some((arg) => arg === '--test' || arg.startsWith('--test=')) ||
    process.argv.includes('--test')
  ) {
    return true;
  }
  const client = getRoomServiceClient();
  if (!client) return true;
  const expected = new Set((expectedParticipantIds || []).map(String));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const participants = await client.listParticipants(String(roomName || '').trim());
      const present = new Set(
        participants
          .filter((participant) => String(participant.kind || '').toLowerCase() !== 'agent')
          .map((participant) => String(participant.identity || '').trim())
          .filter(Boolean),
      );
      if ([...expected].filter((identity) => present.has(identity)).length >= 2) return true;
    } catch (error) {
      logger.warn('LiveKit participant verification failed', {
        room_name: roomName,
        attempt: attempt + 1,
        message: error?.message,
      });
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return false;
}

export async function deleteLiveKitRoom(roomName) {
  const normalizedRoomName = String(roomName || '').trim();
  if (!normalizedRoomName) return false;
  const client = getRoomServiceClient();
  if (!client) {
    logger.warn('LiveKit room deletion skipped because LiveKit is not configured');
    return false;
  }
  try {
    await client.deleteRoom(normalizedRoomName);
    return true;
  } catch (error) {
    const message = String(error?.message || '');
    const status = Number(error?.status || error?.statusCode || error?.response?.status);
    if (status === 404 || /not found|does not exist|404/i.test(message)) return true;
    logger.warn('LiveKit room deletion failed', {
      room_name: normalizedRoomName,
      message,
    });
    return false;
  }
}

const cleanupTimers = new Map();
const CLEANUP_LEASE_MS = 30 * 1000;
const MAX_RETRY_MS = 60 * 1000;
const TERMINAL_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const TOKEN_REJOIN_GUARD_MS = 70 * 1000;
const ACTIVE_TTL_MS = 4 * 60 * 60 * 1000;
let reconciliationTimer = null;

function queueCleanup(roomName, delayMs = 0) {
  const room = String(roomName || '').trim();
  if (!room || cleanupTimers.has(room)) return;
  const timer = setTimeout(async () => {
    cleanupTimers.delete(room);
    try {
      await cleanupCallRoom(room);
    } catch (error) {
      logger.warn('Call room cleanup attempt failed', {
        room_name: room,
        message: error?.message,
      });
      queueCleanup(room, 5000);
    }
  }, Math.max(0, delayMs));
  timer.unref?.();
  cleanupTimers.set(room, timer);
}

export async function cleanupCallRoom(roomName) {
  const room = String(roomName || '').trim();
  if (!room) return false;
  const now = new Date();
  const claim = await ProfessionalCall.findOneAndUpdate(
    {
      room_name: room,
      cleanup_status: { $in: ['pending', 'in_progress'] },
      $and: [
        {
          $or: [
            { cleanup_next_attempt_at: null },
            { cleanup_next_attempt_at: { $lte: now } },
          ],
        },
        {
          $or: [
            { cleanup_status: 'pending' },
            { cleanup_lease_until: null },
            { cleanup_lease_until: { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        cleanup_status: 'in_progress',
        cleanup_lease_until: new Date(now.getTime() + CLEANUP_LEASE_MS),
      },
      $inc: { cleanup_attempts: 1 },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!claim) return true;

  const deleted = await deleteLiveKitRoom(room);
  if (deleted) {
    const finalAfter = claim.cleanup_final_after
      ? new Date(claim.cleanup_final_after)
      : null;
    if (finalAfter && finalAfter.getTime() > Date.now()) {
      await ProfessionalCall.updateOne(
        { _id: claim._id, cleanup_status: 'in_progress' },
        {
          $set: {
            cleanup_status: 'pending',
            cleanup_last_error: '',
            cleanup_next_attempt_at: finalAfter,
            cleanup_lease_until: null,
          },
        },
      );
      queueCleanup(room, finalAfter.getTime() - Date.now());
      return true;
    }
    await ProfessionalCall.updateOne(
      { _id: claim._id, cleanup_status: 'in_progress' },
      {
        $set: {
          cleanup_status: 'completed',
          cleanup_last_error: '',
          cleanup_next_attempt_at: null,
          cleanup_lease_until: null,
        },
      },
    );
    return true;
  }

  const delay = Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(claim.cleanup_attempts || 1, 6));
  await ProfessionalCall.updateOne(
    { _id: claim._id, cleanup_status: 'in_progress' },
    {
      $set: {
        cleanup_status: 'pending',
        cleanup_last_error: 'LiveKit room deletion failed',
        cleanup_next_attempt_at: new Date(Date.now() + delay),
        cleanup_lease_until: null,
      },
    },
  );
  queueCleanup(room, delay);
  return false;
}

export function scheduleCallRoomCleanup(roomName) {
  queueCleanup(roomName);
}

export async function reconcileCallRoomCleanup() {
  const now = new Date();
  const activeCalls = await ProfessionalCall.find({
    status: 'active',
    expires_at: { $lte: new Date(now.getTime() + 2 * 60 * 1000) },
  })
    .select('_id room_name participant_ids')
    .limit(100)
    .lean();
  for (const call of activeCalls) {
    if (await verifyLiveKitCallPresence(call.room_name, call.participant_ids)) {
      await ProfessionalCall.updateOne(
        { _id: call._id, status: 'active' },
        {
          $set: {
            expires_at: new Date(Date.now() + ACTIVE_TTL_MS),
            delete_at: new Date(Date.now() + ACTIVE_TTL_MS + TERMINAL_RETENTION_MS),
          },
        },
      );
    }
  }
  const expiringCalls = await ProfessionalCall.find({
    status: { $in: ['preparing', 'ringing', 'connecting', 'active'] },
    expires_at: { $lte: now },
  })
    .select('_id room_name thread_id participant_ids started_at')
    .limit(100)
    .lean();
  await ProfessionalCall.updateMany(
    {
      status: { $in: ['preparing', 'ringing', 'connecting', 'active'] },
      expires_at: { $lte: now },
    },
    {
      $set: {
        status: 'expired',
        ended_at: now,
        cleanup_status: 'pending',
        cleanup_next_attempt_at: now,
        cleanup_final_after: new Date(now.getTime() + TOKEN_REJOIN_GUARD_MS),
        delete_at: new Date(now.getTime() + TERMINAL_RETENTION_MS),
      },
      $unset: { active_thread_key: 1 },
    },
  );
  await ProfessionalCall.updateMany(
    {
      status: 'expired',
      started_at: { $ne: null },
      transcription_status: { $in: ['pending', 'dispatching', 'active'] },
      participant_states: { $not: { $elemMatch: { transcription_consent: true } } },
    },
    { $set: noConsentArtifactSet() },
  );
  await ProfessionalCall.updateMany(
    {
      status: 'expired',
      started_at: { $ne: null },
      transcription_status: { $in: ['pending', 'dispatching', 'active'] },
      participant_states: { $elemMatch: { transcription_consent: true } },
    },
    {
      $set: {
        transcription_status: 'active',
        transcription_drain_deadline: new Date(now.getTime() + 30_000),
        minutes_status: 'pending',
      },
    },
  );
  if (expiringCalls.length) {
    const { emitCallTerminal } = await import('../realtime/workspaceSocket.js');
    for (const call of expiringCalls) {
      emitCallTerminal(call.participant_ids, {
        call_id: String(call._id),
        room_name: call.room_name,
        thread_id: call.thread_id,
        status: 'expired',
      });
    }
  }
  const calls = await ProfessionalCall.find({
    cleanup_status: { $in: ['pending', 'in_progress'] },
    $or: [
      { cleanup_next_attempt_at: null },
      { cleanup_next_attempt_at: { $lte: new Date() } },
      { cleanup_lease_until: { $lte: new Date() } },
    ],
  })
    .select('room_name')
    .limit(100)
    .lean();
  for (const call of calls) queueCleanup(call.room_name);
  return calls.length;
}

export function startCallRoomCleanupReconciliation() {
  if (reconciliationTimer) return;
  void reconcileCallRoomCleanup().catch((error) => {
    logger.warn('Initial call room cleanup reconciliation failed', { message: error?.message });
  });
  reconciliationTimer = setInterval(() => {
    void reconcileCallRoomCleanup().catch((error) => {
      logger.warn('Call room cleanup reconciliation failed', { message: error?.message });
    });
  }, 30 * 1000);
  reconciliationTimer.unref?.();
}
