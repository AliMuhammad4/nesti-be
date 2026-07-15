import {
  AudioStream,
  ParticipantKind,
  TrackSource,
} from '@livekit/rtc-node';
import { log, stt } from '@livekit/agents';
import { STT as OpenAISTT } from '@livekit/agents-plugin-openai';
import { authorizeParticipantTranscriptionSession } from '../../services/proChat/callTranscriptionSessionService.js';
import {
  callRelativeTranscriptTimes,
  persistFinalTranscriptSegment,
} from '../../services/proChat/transcriptSegmentService.js';
import { waitForMicrophone } from './liveKitMicrophone.js';

function text(value) {
  return String(value || '').trim();
}

function shouldAttemptParticipant(participant, metadata) {
  const identity = text(participant?.identity);
  if (!identity) return false;
  if (participant.kind === ParticipantKind.AGENT) return false;
  return metadata.participant_ids.includes(identity);
}

export async function transcribeParticipant(ctx, participant, metadata) {
  const logger = log().child({
    call_id: metadata.call_id,
    participant: text(participant.identity),
    kind: participant.kind,
  });

  if (!shouldAttemptParticipant(participant, metadata)) {
    logger.info('Skipping participant outside call membership snapshot');
    return false;
  }

  const authorization = await authorizeParticipantTranscriptionSession({
    callId: metadata.call_id,
    roomName: metadata.room_name,
    participantIdentity: participant.identity,
    expectedParticipantIds: metadata.participant_ids,
  });
  if (!authorization) {
    logger.info('Participant not authorized yet (waiting for consent or join state)');
    return false;
  }

  const publication = await waitForMicrophone(ctx, participant, logger);
  if (!publication?.track) {
    logger.warn('No microphone track available for participant');
    return false;
  }

  logger.info({ trackSid: publication.sid }, 'Starting OpenAI STT for participant');
  const timestampOffsetMs = Math.max(0, Date.now() - authorization.started_at_ms);
  const model = text(process.env.CALL_TRANSCRIPTION_MODEL) || 'gpt-4o-mini-transcribe';
  const speechToText = new OpenAISTT({
    apiKey: text(process.env.OPENAI_API_KEY),
    model,
    language: text(process.env.CALL_TRANSCRIPTION_LANGUAGE) || 'en',
    detectLanguage:
      text(process.env.CALL_TRANSCRIPTION_DETECT_LANGUAGE).toLowerCase() === 'true',
    useRealtime: true,
  });
  const speechStream = speechToText.stream();
  const audioStream = new AudioStream(publication.track, {
    sampleRate: 24000,
    numChannels: 1,
  });
  let sequence = 0;
  let currentSegmentId = '';
  let finals = 0;
  const nextSegmentId = (alternative) => {
    sequence += 1;
    const { startTimeMs } = callRelativeTranscriptTimes(alternative, timestampOffsetMs);
    return `${participant.sid || participant.identity}:${publication.sid || 'mic'}:${startTimeMs}:${sequence}`;
  };

  const feedAudio = (async () => {
    let frames = 0;
    try {
      for await (const frame of audioStream) {
        frames += 1;
        speechStream.pushFrame(frame);
      }
    } finally {
      logger.info({ frames }, 'Finished feeding audio frames to STT');
      speechStream.endInput();
    }
  })();

  try {
    for await (const event of speechStream) {
      if (event.type === stt.SpeechEventType.START_OF_SPEECH) {
        currentSegmentId = '';
        continue;
      }
      if (
        event.type !== stt.SpeechEventType.INTERIM_TRANSCRIPT &&
        event.type !== stt.SpeechEventType.FINAL_TRANSCRIPT
      ) {
        continue;
      }
      const alternative = event.alternatives?.[0];
      if (!alternative || !text(alternative.text)) continue;
      if (!currentSegmentId) currentSegmentId = nextSegmentId(alternative);
      const final = event.type === stt.SpeechEventType.FINAL_TRANSCRIPT;
      if (final) {
        await persistFinalTranscriptSegment({
          callId: metadata.call_id,
          segmentId: currentSegmentId,
          participant,
          publication,
          alternative,
          model,
          timestampOffsetMs,
        });
        finals += 1;
        logger.info(
          { segment_id: currentSegmentId, text: text(alternative.text).slice(0, 120) },
          'Persisted final transcript segment',
        );
        currentSegmentId = '';
      }
    }
    await feedAudio;
    logger.info({ finals }, 'Participant transcription stream closed');
    return true;
  } finally {
    speechStream.close();
    await speechToText.close();
  }
}
