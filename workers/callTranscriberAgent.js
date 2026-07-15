import 'dotenv/config';
import mongoose from 'mongoose';
import { ParticipantKind } from '@livekit/rtc-node';
import { AutoSubscribe, defineAgent, log } from '@livekit/agents';
import ProfessionalCall from '../models/ProfessionalCall.js';
import {
  assertImmutableParticipantSnapshot,
} from '../services/proChat/callTranscriptionSessionService.js';
import { transcribeParticipant } from './lib/participantTranscription.js';

const TERMINAL_CALL_STATUSES = ['ended', 'expired'];

function text(value) {
  return String(value || '').trim();
}

function parseMetadata(value) {
  try {
    const parsed = JSON.parse(text(value) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function connectMongo() {
  if (mongoose.connection.readyState === 1) return;
  const uri = text(process.env.MONGO_URI);
  if (!uri) throw new Error('MONGO_URI is required by the transcription worker.');
  await mongoose.connect(uri, {
    maxPoolSize: 20,
    minPoolSize: 1,
    maxIdleTimeMS: 30000,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true,
  });
}

async function markTranscriptionFailed(callId, code, error) {
  await ProfessionalCall.updateOne(
    { _id: callId, transcription_status: { $nin: ['failed', 'disabled'] } },
    {
      $set: {
        transcription_status: 'failed',
        transcription_failed_at: new Date(),
        transcription_error_code: code,
        transcription_error_message: text(error?.message || error).slice(0, 1000),
      },
    },
  );
}

async function completeTranscriptionAfterDrain(metadata) {
  const now = new Date();
  return ProfessionalCall.updateOne(
    {
      _id: metadata.call_id,
      status: { $in: TERMINAL_CALL_STATUSES },
      transcription_status: { $in: ['pending', 'dispatching', 'active', 'failed'] },
      transcription_dispatch_generation: metadata.dispatch_generation,
    },
    {
      $set: {
        transcription_status: 'completed',
        transcription_completed_at: now,
        transcription_drain_deadline: null,
        transcription_error_code: '',
        transcription_error_message: '',
        minutes_status: 'pending',
      },
    },
  );
}

export const callTranscriberAgent = defineAgent({
  entry: async (ctx) => {
    const logger = log();
    const metadata = parseMetadata(ctx.job.metadata);
    metadata.call_id = text(metadata.call_id);
    metadata.participant_ids = Array.isArray(metadata.participant_ids)
      ? [...new Set(metadata.participant_ids.map(text).filter(Boolean))]
      : [];
    metadata.consenting_participant_ids = Array.isArray(metadata.consenting_participant_ids)
      ? [...new Set(metadata.consenting_participant_ids.map(text).filter(Boolean))]
      : [];
    metadata.room_name = text(metadata.room_name);
    metadata.dispatch_generation = text(metadata.dispatch_generation);
    try {
      if (
        !metadata.call_id ||
        !metadata.room_name ||
        !metadata.dispatch_generation ||
        !metadata.participant_ids.length ||
        metadata.room_name !== text(ctx.job.room?.name)
      ) {
        throw new Error('Dispatch metadata must identify the call room and participant snapshot.');
      }
      if (!text(process.env.OPENAI_API_KEY)) {
        throw new Error('OPENAI_API_KEY is required by the transcription worker.');
      }
      await connectMongo();
      const call = await ProfessionalCall.findOne({
        _id: metadata.call_id,
        room_name: ctx.job.room?.name,
        transcription_dispatch_generation: metadata.dispatch_generation,
      }).lean();
      if (!call) throw new Error('The dispatched call was not found or metadata was invalid.');
      if (!assertImmutableParticipantSnapshot(call.participant_ids, metadata.participant_ids)) {
        throw new Error('Dispatch participant snapshot does not match the call snapshot.');
      }

      await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
      logger.info(
        {
          call_id: metadata.call_id,
          room: ctx.room?.name,
          remote_participants: [...(ctx.room?.remoteParticipants?.values?.() || [])].map((participant) => ({
            identity: participant.identity,
            kind: participant.kind,
            tracks: participant.trackPublications?.size || 0,
          })),
        },
        'Transcription agent connected to room',
      );

      const activeIdentities = new Set();
      const activeTasks = new Map();
      const retryAfter = new Map();
      const attempts = new Map();
      const maxConcurrentStreams = Math.max(
        1,
        Number.parseInt(process.env.CALL_TRANSCRIPTION_MAX_STREAMS_PER_JOB || '8', 10) || 8,
      );
      const maybeCompleteAfterDrain = async () => {
        if (activeTasks.size > 0) return;
        await completeTranscriptionAfterDrain(metadata);
      };
      const runParticipant = async (participant) => {
        const identity = text(participant?.identity);
        if (
          !identity ||
          activeIdentities.has(identity) ||
          activeTasks.has(identity) ||
          Number(retryAfter.get(identity) || 0) > Date.now() ||
          activeTasks.size >= maxConcurrentStreams
        ) return;

        // Reserve synchronously before the first await so discovery paths cannot
        // start duplicate realtime STT streams for the same participant.
        activeTasks.set(identity, null);
        const task = (async () => {
          try {
            const started = await transcribeParticipant(ctx, participant, metadata);
            if (started) activeIdentities.add(identity);
            else retryAfter.set(identity, Date.now() + 15_000);
          } catch (error) {
            const attempt = Number(attempts.get(identity) || 0) + 1;
            attempts.set(identity, attempt);
            const delayMs = Math.min(60_000, 2_000 * 2 ** Math.min(attempt - 1, 5));
            retryAfter.set(identity, Date.now() + delayMs + Math.floor(Math.random() * 1000));
            logger.error(
              { error, call_id: metadata.call_id, participant: identity, attempt, delay_ms: delayMs },
              'Participant transcription failed',
            );
          } finally {
            activeTasks.delete(identity);
            await maybeCompleteAfterDrain().catch(() => {});
          }
        })();
        activeTasks.set(identity, task);
        await task;
      };

      ctx.addParticipantEntrypoint(async (_jobCtx, participant) => {
        await runParticipant(participant);
      });
      for (const participant of ctx.room.remoteParticipants.values()) {
        void runParticipant(participant);
      }

      const consentRetry = setInterval(() => {
        for (const participant of ctx.room.remoteParticipants.values()) {
          void runParticipant(participant);
        }
      }, 15_000);
      consentRetry.unref?.();
      ctx.addShutdownCallback(async () => {
        clearInterval(consentRetry);
        const drainTimeoutMs = Math.max(
          5_000,
          Number.parseInt(process.env.CALL_TRANSCRIPTION_DRAIN_TIMEOUT_MS || '30000', 10) || 30_000,
        );
        await Promise.race([
          Promise.allSettled([...activeTasks.values()].filter(Boolean)),
          new Promise((resolve) => setTimeout(resolve, drainTimeoutMs)),
        ]);
        await completeTranscriptionAfterDrain(metadata).catch(() => {});
      });

      const activation = await ProfessionalCall.updateOne(
        {
          _id: metadata.call_id,
          status: 'active',
          transcription_status: { $in: ['pending', 'dispatching', 'active'] },
        },
        {
          $set: {
            transcription_status: 'active',
            transcription_started_at: new Date(),
            transcription_error_code: '',
            transcription_error_message: '',
          },
        },
      );
      if (!activation.modifiedCount) {
        const remotes = [...(ctx.room?.remoteParticipants?.values?.() || [])].filter(
          (participant) => text(participant?.identity) && participant.kind !== ParticipantKind.AGENT,
        );
        if (!remotes.length) {
          logger.warn({ call_id: metadata.call_id }, 'Call no longer active for transcription');
          ctx.shutdown('call is no longer active');
          return;
        }
        logger.warn(
          { call_id: metadata.call_id, remotes: remotes.length },
          'Call ended during agent join; continuing while participants remain',
        );
      }
    } catch (error) {
      logger.error({ error, call_id: metadata.call_id }, 'Transcription agent job failed');
      if (metadata.call_id) {
        await connectMongo().catch(() => {});
        await markTranscriptionFailed(metadata.call_id, 'transcription_worker_failed', error).catch(
          () => {},
        );
      }
      ctx.shutdown('transcription worker failed');
    }
  },
});

export default callTranscriberAgent;
