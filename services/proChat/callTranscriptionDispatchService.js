import { randomUUID } from 'node:crypto';
import { AgentDispatchClient } from 'livekit-server-sdk';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import logger from '../../utils/logger.js';
import { TRANSCRIPTION_AGENT_NAME } from './callTranscriptionConstants.js';
import { consentingParticipantIds } from './callTranscriptionSessionService.js';
import {
  ensureTranscriptionWorkerRunning,
  featureEnabled,
} from './transcriptionWorkerLifecycle.js';

export { TRANSCRIPTION_AGENT_NAME, ensureTranscriptionWorkerRunning };

function text(value) {
  return String(value || '').trim();
}

function httpLiveKitUrl(value) {
  return text(value).replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}

function dispatchClient() {
  const host = httpLiveKitUrl(process.env.LIVEKIT_URL);
  const apiKey = text(process.env.LIVEKIT_API_KEY);
  const apiSecret = text(process.env.LIVEKIT_API_SECRET);
  if (!host || !apiKey || !apiSecret) return null;
  return new AgentDispatchClient(host, apiKey, apiSecret);
}

async function markFailed(callId, code, error) {
  const message = text(error?.message || error).slice(0, 1000);
  await ProfessionalCall.updateOne(
    { _id: callId, transcription_status: { $in: ['pending', 'dispatching'] } },
    {
      $set: {
        transcription_status: 'failed',
        transcription_failed_at: new Date(),
        transcription_error_code: code,
        transcription_error_message: message,
      },
    },
  );
  return { ok: false, status: 'failed', code, message };
}

async function markDispatchRetry(callId, code, error, { attempt = 1, maxAttempts = 4 } = {}) {
  const message = text(error?.message || error).slice(0, 1000);
  if (attempt >= maxAttempts) {
    return markFailed(callId, code, error);
  }
  await ProfessionalCall.updateOne(
    { _id: callId, transcription_status: { $in: ['pending', 'dispatching'] } },
    {
      $set: {
        transcription_status: 'pending',
        transcription_dispatch_id: '',
        transcription_dispatch_generation: '',
        transcription_dispatched_at: null,
        transcription_error_code: 'transcription_dispatch_retrying',
        transcription_error_message: `${message} (retry ${attempt}/${maxAttempts})`,
      },
    },
  );
  const delayMs = Math.min(60_000, 3_000 * 2 ** Math.max(0, attempt - 1));
  setTimeout(() => {
    void dispatchTranscriptionWorkerForCall(callId).catch(() => {});
  }, delayMs).unref?.();
  return {
    ok: false,
    status: 'pending',
    code: 'transcription_dispatch_retrying',
    message,
    retrying: true,
    attempt,
  };
}

async function submitTranscriptionDispatch(client, call, { replaceStale = false } = {}) {
  const normalizedCallId = text(call._id);
  const dispatchGeneration = randomUUID();
  const participantIds = [...new Set(
    (call.participant_ids || []).map((participantId) => text(participantId)).filter(Boolean),
  )];
  const consentingIds = consentingParticipantIds(call);
  if (!participantIds.length) {
    throw new Error('The call participant snapshot is empty.');
  }

  const workerReady = await ensureTranscriptionWorkerRunning();
  if (!workerReady) {
    throw new Error(
      'Transcription worker is not connected to LiveKit. Restart `npm run dev` and try again.',
    );
  }

  const generationClaim = await ProfessionalCall.updateOne(
    {
      _id: normalizedCallId,
      transcription_status: { $in: ['pending', 'dispatching'] },
    },
    {
      $set: {
        transcription_dispatch_generation: dispatchGeneration,
        transcription_dispatched_at: new Date(),
      },
    },
  );
  if (!Number(generationClaim.matchedCount ?? generationClaim.modifiedCount)) {
    throw new Error('The transcription dispatch lease is no longer available.');
  }

  const metadata = JSON.stringify({
    call_id: normalizedCallId,
    room_name: call.room_name,
    thread_id: call.thread_id,
    participant_ids: participantIds,
    consenting_participant_ids: consentingIds,
    transcription_policy_version: call.transcription_policy_version || '1',
    dispatch_generation: dispatchGeneration,
  });
  const existingDispatches = await client.listDispatch(call.room_name);
  let dispatch = existingDispatches.find(
    (item) => text(item.agentName) === TRANSCRIPTION_AGENT_NAME,
  );
  if (dispatch && (replaceStale || !call.transcription_started_at)) {
    try {
      await client.deleteDispatch(text(dispatch.id), call.room_name);
      dispatch = null;
    } catch (error) {
      logger.warn('Could not replace stale transcription dispatch', {
        call_id: normalizedCallId,
        dispatch_id: text(dispatch?.id),
        message: error?.message,
      });
    }
  }
  if (!dispatch) {
    dispatch = await client.createDispatch(call.room_name, TRANSCRIPTION_AGENT_NAME, {
      metadata,
    });
  }

  const now = new Date();
  await ProfessionalCall.updateOne(
    { _id: normalizedCallId, transcription_status: { $in: ['pending', 'dispatching'] } },
    {
      $set: {
        transcription_status: 'dispatching',
        transcription_dispatch_id: text(dispatch?.id),
        transcription_dispatch_generation: dispatchGeneration,
        transcription_dispatched_at: now,
        transcription_error_code: '',
        transcription_error_message: '',
      },
    },
  );

  return {
    ok: true,
    status: 'dispatching',
    dispatch_id: text(dispatch?.id),
  };
}

export async function dispatchTranscriptionWorkerForCall(callId) {
  const normalizedCallId = text(callId);
  if (!normalizedCallId) {
    return { ok: false, status: 'failed', code: 'missing_call_id' };
  }
  if (!featureEnabled()) {
    await ProfessionalCall.updateOne(
      { _id: normalizedCallId, transcription_status: 'pending' },
      {
        $set: {
          transcription_status: 'disabled',
          transcription_error_code: 'transcription_disabled',
          transcription_error_message: 'Call transcription is disabled by configuration.',
        },
      },
    );
    return { ok: false, status: 'disabled', code: 'transcription_disabled' };
  }

  const claimed = await ProfessionalCall.findOneAndUpdate(
    {
      _id: normalizedCallId,
      // Join while the call is live so audio is not lost waiting for consent.
      status: { $in: ['connecting', 'active'] },
      transcription_status: 'pending',
    },
    {
      $set: {
        transcription_status: 'dispatching',
        transcription_error_code: '',
        transcription_error_message: '',
      },
    },
    { returnDocument: 'after' },
  ).lean();

  if (claimed) {
    const client = dispatchClient();
    if (!client) {
      return markFailed(
        normalizedCallId,
        'livekit_dispatch_not_configured',
        new Error('LiveKit dispatch credentials are not configured.'),
      );
    }
    try {
      return await submitTranscriptionDispatch(client, claimed);
    } catch (error) {
      logger.warn('Call transcription worker dispatch failed', {
        call_id: normalizedCallId,
        room_name: claimed.room_name,
        message: error?.message,
      });
      return markDispatchRetry(normalizedCallId, 'transcription_dispatch_failed', error, {
        attempt: 1,
      });
    }
  }

  const existing = await ProfessionalCall.findById(normalizedCallId)
    .select(
      'status participant_states transcription_status transcription_dispatch_id transcription_dispatch_generation transcription_dispatched_at transcription_started_at room_name thread_id participant_ids transcription_policy_version',
    )
    .lean();

  if (!existing) {
    return { ok: false, status: 'failed', code: 'call_not_found' };
  }

  const liveForDispatch = ['connecting', 'active'].includes(text(existing.status));
  const dispatchAgeMs = existing.transcription_dispatched_at
    ? Date.now() - new Date(existing.transcription_dispatched_at).getTime()
    : null;
  const staleDispatch =
    existing.transcription_status === 'dispatching' &&
    !existing.transcription_started_at &&
    text(existing.transcription_dispatch_id) &&
    dispatchAgeMs != null &&
    dispatchAgeMs > 45_000;
  const shouldDispatch =
    liveForDispatch &&
    (existing.transcription_status === 'pending' || staleDispatch);

  if (!shouldDispatch) {
    return {
      ok: ['dispatching', 'active', 'completed'].includes(existing.transcription_status),
      status: existing.transcription_status || 'failed',
      dispatch_id: existing.transcription_dispatch_id || '',
      already_dispatched: true,
    };
  }

  const client = dispatchClient();
  if (!client) {
    return markFailed(
      normalizedCallId,
      'livekit_dispatch_not_configured',
      new Error('LiveKit dispatch credentials are not configured.'),
    );
  }

  try {
    return await submitTranscriptionDispatch(client, existing, {
      replaceStale: staleDispatch && Boolean(text(existing.transcription_dispatch_id)),
    });
  } catch (error) {
    logger.warn('Call transcription worker dispatch failed', {
      call_id: normalizedCallId,
      room_name: existing.room_name,
      message: error?.message,
    });
    const prior = text(existing.transcription_error_message);
    const priorAttempt = Number((prior.match(/retry\s+(\d+)\//i) || [])[1] || 0);
    return markDispatchRetry(normalizedCallId, 'transcription_dispatch_failed', error, {
      attempt: Math.max(1, priorAttempt + 1),
    });
  }
}

export async function ensureTranscriptionForActiveCall(call) {
  if (!featureEnabled()) return { ok: false, status: 'disabled', code: 'transcription_disabled' };
  const normalizedCallId = text(call?._id || call?.call_id);
  const status = text(call?.status);
  if (!normalizedCallId || !['connecting', 'active'].includes(status)) {
    return { ok: false, status: 'skipped', code: 'call_not_active' };
  }
  return dispatchTranscriptionWorkerForCall(normalizedCallId);
}

export function scheduleTranscriptionWorkerDispatch(callId) {
  const normalizedCallId = text(callId);
  void dispatchTranscriptionWorkerForCall(normalizedCallId)
    .then((result) => {
      if (result.ok) {
        logger.info('Call transcription dispatch scheduled', {
          call_id: normalizedCallId,
          status: result.status,
          dispatch_id: result.dispatch_id || '',
        });
        return;
      }
      logger.warn('Asynchronous call transcription dispatch did not start', {
        call_id: normalizedCallId,
        status: result.status,
        code: result.code || '',
        message: result.message || '',
      });
    })
    .catch(async (error) => {
      logger.warn('Asynchronous call transcription dispatch rejected', {
        call_id: normalizedCallId,
        message: error?.message,
      });
      try {
        await markDispatchRetry(normalizedCallId, 'transcription_dispatch_failed', error, {
          attempt: 1,
        });
      } catch (statusError) {
        logger.error('Failed to persist asynchronous transcription dispatch failure', {
          call_id: normalizedCallId,
          message: statusError?.message,
        });
      }
    });
}
