import ProfessionalCall from '../../models/ProfessionalCall.js';
import { noConsentArtifactSet } from './callArtifactFields.js';
import { normalize, participantStates } from './callPublicShape.js';

export const PREPARING_TTL_MS = 60 * 1000;
export const VIDEO_PREPARING_TTL_MS = 150 * 1000;
export const RINGING_TTL_MS = 90 * 1000;
export const ACTIVE_TTL_MS = 4 * 60 * 60 * 1000;
export const CONNECTING_TTL_MS = 2 * 60 * 1000;
export const TERMINAL_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const TOKEN_REJOIN_GUARD_MS = 70 * 1000;
export const LIVE_STATUSES = ['preparing', 'ringing', 'connecting', 'active'];

export function failure(code, message, status = 409) {
  return { ok: false, code, message, status };
}

export function isDuplicateKey(error) {
  return Number(error?.code) === 11000;
}

export async function loadCall(roomName) {
  return ProfessionalCall.findOne({ room_name: normalize(roomName) }).lean();
}

export async function finalizeArtifactState(call) {
  if (!call?.started_at && !call?.transcription_started_at) return call;
  const now = new Date();
  const hasConsent = participantStates(call).some(
    (participant) => participant.transcription_consent === true,
  );
  if (!hasConsent) {
    await ProfessionalCall.updateOne(
      {
        _id: call._id,
        transcription_status: { $in: ['pending', 'dispatching', 'active', 'failed'] },
      },
      { $set: noConsentArtifactSet() },
    );
    return loadCall(call.room_name);
  }

  await ProfessionalCall.updateOne(
    {
      _id: call._id,
      transcription_status: { $in: ['pending', 'dispatching', 'active', 'failed'] },
    },
    {
      $set: {
        transcription_status: 'active',
        transcription_drain_deadline: new Date(now.getTime() + 30_000),
        transcription_error_code: '',
        transcription_error_message: '',
        minutes_status: 'pending',
      },
    },
  );
  return loadCall(call.room_name);
}

export async function expireStaleCalls({ threadId, roomName } = {}) {
  const now = new Date();
  const filter = {
    status: { $in: LIVE_STATUSES },
    expires_at: { $lte: now },
  };
  if (threadId || roomName) {
    filter.$or = [];
    if (threadId) filter.$or.push({ active_thread_key: normalize(threadId) });
    if (roomName) filter.$or.push({ room_name: normalize(roomName) });
  }
  const expiring = await ProfessionalCall.find(filter)
    .select('_id room_name thread_id participant_ids started_at')
    .limit(100)
    .lean();
  if (!expiring.length) return;

  const ids = expiring.map((call) => call._id);
  await ProfessionalCall.updateMany(
    { _id: { $in: ids }, status: { $in: LIVE_STATUSES } },
    {
      $set: {
        status: 'expired',
        ended_at: now,
        cleanup_status: 'pending',
        cleanup_next_attempt_at: now,
        cleanup_final_after: new Date(now.getTime() + TOKEN_REJOIN_GUARD_MS),
        expires_at: now,
        delete_at: new Date(now.getTime() + TERMINAL_RETENTION_MS),
      },
      $unset: { active_thread_key: 1 },
    },
  );
  await ProfessionalCall.updateMany(
    {
      _id: { $in: ids },
      status: 'expired',
      started_at: { $ne: null },
      transcription_status: { $in: ['pending', 'dispatching', 'active'] },
      participant_states: { $not: { $elemMatch: { transcription_consent: true } } },
    },
    { $set: noConsentArtifactSet() },
  );
  await ProfessionalCall.updateMany(
    {
      _id: { $in: ids },
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
  try {
    const { emitCallTerminal } = await import('../realtime/workspaceSocket.js');
    const { scheduleCallRoomCleanup } = await import('./liveKitRoomService.js');
    for (const call of expiring) {
      emitCallTerminal(call.participant_ids, {
        call_id: String(call._id),
        room_name: call.room_name,
        thread_id: call.thread_id,
        status: 'expired',
      });
      scheduleCallRoomCleanup(call.room_name);
    }
  } catch {
  }
}
