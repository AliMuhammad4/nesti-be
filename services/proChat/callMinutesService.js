import { randomUUID } from 'node:crypto';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalCallMinutes from '../../models/ProfessionalCallMinutes.js';
import ProfessionalCallTranscriptSegment from '../../models/ProfessionalCallTranscriptSegment.js';
import logger from '../../utils/logger.js';
import { emitCallArtifactsReady } from '../realtime/workspaceSocket.js';
import { consentCompletedArtifactSet } from './callArtifactFields.js';
import {
  chunkTranscriptSegments,
  fallbackMinutesFromSegments,
  normalizeMinutes,
  positiveIntEnv,
} from './callMinutesFormatting.js';
import {
  generateMinutesFromSegments,
  setCallMinutesOpenAIClientForTests,
} from './callMinutesGeneration.js';

export {
  chunkTranscriptSegments,
  fallbackMinutesFromSegments,
  generateMinutesFromSegments,
  normalizeMinutes,
  setCallMinutesOpenAIClientForTests,
};

const PROMPT_VERSION = 'call-minutes-v3';
const TERMINAL_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
// Longer than the worker's 90s drain window so a healthy worker always wins.
const STUCK_TRANSCRIPTION_GRACE_MS = 2 * 60 * 1000;
const workerId = `${process.pid}:${randomUUID()}`;
let reconciliationTimer = null;

function text(value) {
  return String(value || '').trim();
}

async function ensureMinutesRecord(call) {
  await ProfessionalCallMinutes.updateOne(
    { call_id: call._id },
    {
      $setOnInsert: {
        call_id: call._id,
        status: 'pending',
        next_attempt_at: new Date(),
        delete_at:
          call.delete_at ||
          new Date(
            new Date(call.ended_at || Date.now()).getTime() + TERMINAL_RETENTION_MS,
          ),
      },
    },
    { upsert: true },
  );
  await ProfessionalCall.updateOne(
    { _id: call._id, minutes_status: 'not_ready' },
    { $set: { minutes_status: 'pending' } },
  );
}

export async function processMinutesForCall(call) {
  const segments = await ProfessionalCallTranscriptSegment.find({
    call_id: call._id,
    final: true,
  })
    .sort({ start_time_ms: 1, _id: 1 })
    .lean();
  if (!segments.length) {
    await Promise.all([
      ProfessionalCallMinutes.deleteOne({ call_id: call._id }),
      ProfessionalCall.updateOne(
        {
          _id: call._id,
          transcription_status: { $in: ['completed', 'disabled'] },
        },
        {
          $set: {
            transcription_status: 'completed',
            transcription_error_code: 'no_transcript_segments',
            transcription_error_message:
              'No consenting participant transcript was produced for this call.',
            minutes_status: 'not_ready',
          },
        },
      ),
    ]);
    return false;
  }
  await ensureMinutesRecord(call);
  const existingMinutes = await ProfessionalCallMinutes.findOne({ call_id: call._id }).lean();
  if (
    existingMinutes?.status === 'ready' &&
    Number(existingMinutes.transcript_segment_count || 0) === segments.length &&
    new Date(existingMinutes.transcript_version_at || 0).getTime() ===
      new Date(call.transcript_updated_at || 0).getTime()
  ) {
    // Recovery paths (e.g. a completed → failed flip that was rolled back to
    // 'completed' with minutes_status: 'pending') can leave the call marked
    // pending even though the ProfessionalCallMinutes doc is still ready.
    // Without this heal, the reconciler would keep re-selecting the call
    // every cycle, calling us, no-op'ing here, and the UI would stay stuck on
    // "Preparing minutes of meeting" forever. Sync back to 'ready' so the
    // visible state matches the stored artifact.
    if (call.minutes_status !== 'ready') {
      await ProfessionalCall.updateOne(
        { _id: call._id, minutes_status: { $ne: 'ready' } },
        { $set: { minutes_status: 'ready' } },
      );
    }
    return false;
  }
  if (existingMinutes?.status === 'ready') {
    await ProfessionalCallMinutes.updateOne(
      { _id: existingMinutes._id, status: 'ready' },
      {
        $set: {
          status: 'pending',
          next_attempt_at: new Date(),
          lease_owner: '',
          lease_until: null,
        },
      },
    );
  }
  const now = new Date();
  const leaseMs = positiveIntEnv(process.env.CALL_MINUTES_LEASE_MS, 120000);
  const maxAttempts = positiveIntEnv(process.env.CALL_MINUTES_MAX_ATTEMPTS, 5);
  const claim = await ProfessionalCallMinutes.findOneAndUpdate(
    {
      call_id: call._id,
      status: { $in: ['pending', 'failed'] },
      attempts: { $lt: maxAttempts },
      $and: [
        { $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }] },
        { $or: [{ lease_until: null }, { lease_until: { $lte: now } }] },
      ],
    },
    {
      $set: {
        status: 'processing',
        lease_owner: workerId,
        lease_until: new Date(now.getTime() + leaseMs),
        last_error: '',
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!claim) return false;

  await ProfessionalCall.updateOne(
    { _id: call._id },
    { $set: { minutes_status: 'processing' } },
  );
  const heartbeatMs = Math.max(5_000, Math.floor(leaseMs / 3));
  const leaseHeartbeat = setInterval(() => {
    void ProfessionalCallMinutes.updateOne(
      { _id: claim._id, status: 'processing', lease_owner: workerId },
      { $set: { lease_until: new Date(Date.now() + leaseMs) } },
    ).catch(() => {});
  }, heartbeatMs);
  leaseHeartbeat.unref?.();
  try {
    const generated = await generateMinutesFromSegments(segments);
    let minutes = normalizeMinutes(generated.minutes);
    const minutesEmpty =
      !minutes.summary &&
      !minutes.topics.length &&
      !minutes.decisions.length &&
      !minutes.action_items.length &&
      !minutes.follow_ups.length;
    if (minutesEmpty) {
      const fallback = fallbackMinutesFromSegments(segments);
      if (fallback?.summary) {
        minutes = fallback;
      } else {
        await ProfessionalCallMinutes.updateOne(
          { _id: claim._id, status: 'processing', lease_owner: workerId },
          {
            $set: {
              status: 'failed',
              lease_owner: '',
              lease_until: null,
              next_attempt_at: null,
              last_error: 'empty_minutes: No substantive minutes could be produced.',
            },
          },
        );
        await ProfessionalCall.updateOne(
          { _id: call._id },
          {
            $set: {
              minutes_status: 'failed',
              transcription_error_code: 'empty_minutes',
              transcription_error_message:
                'No substantive minutes could be produced from this transcript.',
            },
          },
        );
        return false;
      }
    }
    const characterCount = segments.reduce(
      (sum, segment) => sum + text(segment.text).length,
      0,
    );
    const readyAt = new Date();
    const published = await ProfessionalCallMinutes.updateOne(
      {
        _id: claim._id,
        status: 'processing',
        lease_owner: workerId,
      },
      {
        $set: {
          status: 'ready',
          ...minutes,
          model: generated.model,
          prompt_version: PROMPT_VERSION,
          transcript_segment_count: segments.length,
          transcript_version_at: call.transcript_updated_at || readyAt,
          transcript_character_count: characterCount,
          chunk_count: generated.chunkCount,
          lease_owner: '',
          lease_until: null,
          next_attempt_at: null,
          last_error: '',
          ready_at: readyAt,
        },
      },
    );
    if (!published.modifiedCount) {
      logger.warn('Discarded call minutes after lease ownership changed', {
        call_id: text(call._id),
      });
      return false;
    }
    await ProfessionalCall.updateOne(
      { _id: call._id },
      { $set: { minutes_status: 'ready' } },
    );
    emitCallArtifactsReady(call.participant_ids, {
      call_id: text(call._id),
      thread_id: text(call.thread_id),
      room_name: text(call.room_name),
      transcription_status: call.transcription_status || 'completed',
      minutes_status: 'ready',
    });
    return true;
  } catch (error) {
    const attempts = Number(claim.attempts || 1);
    const exhausted = attempts >= maxAttempts;
    const delayMs = Math.min(15 * 60 * 1000, 30000 * 2 ** Math.min(attempts - 1, 5));
    await ProfessionalCallMinutes.updateOne(
      { _id: claim._id, status: 'processing', lease_owner: workerId },
      {
        $set: {
          status: 'failed',
          lease_owner: '',
          lease_until: null,
          next_attempt_at: exhausted ? null : new Date(Date.now() + delayMs),
          last_error: `${text(error?.code || 'minutes_generation_failed')}: ${text(
            error?.message || error,
          )}`.slice(0, 2000),
        },
      },
    );
    await ProfessionalCall.updateOne(
      { _id: call._id },
      { $set: { minutes_status: exhausted ? 'failed' : 'pending' } },
    );
    logger.warn('Call minutes generation failed', {
      call_id: text(call._id),
      attempts,
      exhausted,
      message: error?.message,
    });
    return false;
  } finally {
    clearInterval(leaseHeartbeat);
  }
}

export async function reconcileCallMinutes() {
  const now = new Date();
  await ProfessionalCall.updateMany(
    {
      status: { $in: ['ended', 'expired'] },
      transcription_status: 'active',
      transcription_drain_deadline: { $lte: now },
    },
    { $set: consentCompletedArtifactSet(now) },
  );
  await ProfessionalCall.updateMany(
    {
      status: { $in: ['ended', 'expired'] },
      transcription_status: { $in: ['active', 'dispatching'] },
      transcription_drain_deadline: null,
      ended_at: { $lte: new Date(now.getTime() - STUCK_TRANSCRIPTION_GRACE_MS) },
      participant_states: { $elemMatch: { transcription_consent: true } },
    },
    { $set: consentCompletedArtifactSet(now) },
  );
  const calls = await ProfessionalCall.find({
    status: { $in: ['ended', 'expired'] },
    $or: [{ started_at: { $ne: null } }, { transcription_started_at: { $ne: null } }],
    transcription_status: { $in: ['completed', 'failed'] },
    minutes_status: { $in: ['not_ready', 'pending', 'processing', 'failed'] },
    transcription_error_code: { $nin: ['empty_minutes', 'no_transcript_segments'] },
  })
    .sort({ ended_at: 1 })
    .limit(25)
    .lean();
  for (const call of calls) {
    if (call.transcription_status === 'failed') {
      const segmentCount = await ProfessionalCallTranscriptSegment.countDocuments({
        call_id: call._id,
        final: true,
      });
      if (!segmentCount) continue;
      await ProfessionalCall.updateOne(
        { _id: call._id, transcription_status: 'failed' },
        { $set: consentCompletedArtifactSet(new Date()) },
      );
      call.transcription_status = 'completed';
      call.minutes_status = 'pending';
    }
    await processMinutesForCall(call);
  }
  return calls.length;
}

export function startCallMinutesReconciliation() {
  if (reconciliationTimer) return;
  void reconcileCallMinutes().catch((error) => {
    logger.warn('Initial call minutes reconciliation failed', { message: error?.message });
  });
  const intervalMs = positiveIntEnv(process.env.CALL_MINUTES_RECONCILE_INTERVAL_MS, 5000);
  reconciliationTimer = setInterval(() => {
    void reconcileCallMinutes().catch((error) => {
      logger.warn('Call minutes reconciliation failed', { message: error?.message });
    });
  }, intervalMs);
  reconciliationTimer.unref?.();
}

export function stopCallMinutesReconciliationForTests() {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  reconciliationTimer = null;
}
