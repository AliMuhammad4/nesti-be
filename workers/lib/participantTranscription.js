import {
  AudioStream,
  ParticipantKind,
} from '@livekit/rtc-node';
import { log, stt } from '@livekit/agents';
import { STT as OpenAISTT } from '@livekit/agents-plugin-openai';
import { authorizeParticipantTranscriptionSession } from '../../services/proChat/callTranscriptionSessionService.js';
import {
  callRelativeTranscriptTimes,
  persistFinalTranscriptSegment,
} from '../../services/proChat/transcriptSegmentService.js';
import { waitForMicrophone } from './liveKitMicrophone.js';
import {
  isAllowedCallTranscriptScript,
  looksLikeLatinSttGibberish,
  resolveSegmentLanguage,
} from '../../services/proChat/transcriptTextCleaning.js';
import {
  frameSampleCount,
  getCallEchoTracker,
  passesTranscriptionConfidence,
  readTranscriptionVadOptions,
  shouldPersistTranscriptAlternative,
} from './transcriptionQuality.js';

function text(value) {
  return String(value || '').trim();
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function participantStillPresent(ctx, identity) {
  const id = text(identity);
  return [...(ctx.room?.remoteParticipants?.values?.() || [])].some(
    (participant) => text(participant.identity) === id,
  );
}

function shouldAttemptParticipant(participant, metadata) {
  const identity = text(participant?.identity);
  if (!identity) return false;
  if (participant.kind === ParticipantKind.AGENT) return false;
  return metadata.participant_ids.includes(identity);
}

function createSpeechToText() {
  const model = text(process.env.CALL_TRANSCRIPTION_MODEL) || 'gpt-4o-transcribe';
  const detectLanguage =
    text(process.env.CALL_TRANSCRIPTION_DETECT_LANGUAGE).toLowerCase() !== 'false';
  const configuredLanguage = text(process.env.CALL_TRANSCRIPTION_LANGUAGE);
  const language = detectLanguage ? '' : configuredLanguage || 'en';
  const vad = readTranscriptionVadOptions();
  const sttOptions = {
    apiKey: text(process.env.OPENAI_API_KEY),
    model,
    detectLanguage,
    useRealtime: true,
    language: language || undefined,
    noiseReductionType: 'far_field',
    turnDetection: {
      type: 'server_vad',
      threshold: vad.threshold,
      prefix_padding_ms: vad.prefix_padding_ms,
      silence_duration_ms: vad.silence_duration_ms,
    },
  };
  return {
    model,
    detectLanguage,
    language: language || 'auto',
    speechToText: new OpenAISTT(sttOptions),
  };
}

async function waitForTranscriptionConsent(ctx, participant, metadata, logger) {
  while (participantStillPresent(ctx, participant.identity)) {
    const authorization = await authorizeParticipantTranscriptionSession({
      callId: metadata.call_id,
      roomName: metadata.room_name,
      participantIdentity: participant.identity,
      expectedParticipantIds: metadata.participant_ids,
    });
    if (authorization) return authorization;
    await sleep(500);
  }
  logger.info('Participant left before transcription consent');
  return null;
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

  const publication = await waitForMicrophone(ctx, participant, logger);
  if (!publication?.track) {
    logger.warn('No microphone track available for participant');
    return false;
  }

  const sampleRate = 24000;
  const prerollSeconds = Math.min(
    60,
    Math.max(10, positiveInt(process.env.CALL_TRANSCRIPTION_PREROLL_SECONDS, 60)),
  );
  const maxPrerollSamples = sampleRate * prerollSeconds;
  const audioStream = new AudioStream(publication.track, {
    sampleRate,
    numChannels: 1,
  });

  const preroll = [];
  let prerollSamples = 0;
  let liveStream = null;
  let audioClosed = false;

  const producer = (async () => {
    try {
      for await (const frame of audioStream) {
        if (liveStream) {
          liveStream.pushFrame(frame);
          continue;
        }
        preroll.push(frame);
        prerollSamples += frameSampleCount(frame);
        while (prerollSamples > maxPrerollSamples && preroll.length > 1) {
          const dropped = preroll.shift();
          prerollSamples -= frameSampleCount(dropped);
        }
      }
    } finally {
      audioClosed = true;
      if (liveStream) liveStream.endInput();
    }
  })();

  const authorization = await waitForTranscriptionConsent(ctx, participant, metadata, logger);
  if (!authorization) {
    await producer.catch(() => {});
    return false;
  }

  const { model, detectLanguage, language, speechToText } = createSpeechToText();
  const callStartedAtMs = authorization.started_at_ms;
  const timestampOffsetMs = Math.max(0, Date.now() - callStartedAtMs);
  const vad = readTranscriptionVadOptions();
  logger.info(
    {
      trackSid: publication.sid,
      model,
      detect_language: detectLanguage,
      language,
      vad_threshold: vad.threshold,
      vad_silence_ms: vad.silence_duration_ms,
      preroll_seconds: prerollSeconds,
      buffered_preroll_frames: preroll.length,
    },
    'Starting OpenAI STT for participant',
  );

  const speechStream = speechToText.stream();
  liveStream = speechStream;
  for (const frame of preroll) {
    speechStream.pushFrame(frame);
  }
  preroll.length = 0;
  prerollSamples = 0;
  if (audioClosed) speechStream.endInput();

  let sequence = 0;
  let finals = 0;
  let lastPersistedText = '';
  let pendingAlternative = null;
  const echoTracker = getCallEchoTracker(metadata.call_id);

  const nextSegmentId = (alternative) => {
    sequence += 1;
    const { startTimeMs } = callRelativeTranscriptTimes(alternative, timestampOffsetMs, {
      nowMs: Date.now(),
      callStartedAtMs,
    });
    return `${participant.sid || participant.identity}:${publication.sid || 'mic'}:${startTimeMs}:${sequence}`;
  };

  const persistUtterance = async (alternative, segmentId) => {
    const body = text(alternative?.text);
    if (
      !shouldPersistTranscriptAlternative(alternative, {
        previousText: lastPersistedText,
      })
    ) {
      if (body && !isAllowedCallTranscriptScript(body)) {
        logger.info(
          { text: body.slice(0, 80) },
          'Dropped unsupported-script transcript',
        );
      } else if (body && looksLikeLatinSttGibberish(body)) {
        logger.info(
          { text: body.slice(0, 80) },
          'Dropped Latin STT gibberish',
        );
      } else if (body && !passesTranscriptionConfidence(alternative)) {
        logger.info(
          {
            confidence: alternative?.confidence,
            text: body.slice(0, 80),
          },
          'Dropped low-confidence transcript',
        );
      }
      return false;
    }

    const nowMs = Date.now();
    const { startTimeMs } = callRelativeTranscriptTimes(alternative, timestampOffsetMs, {
      nowMs,
      callStartedAtMs,
    });

    if (echoTracker.isEcho({
      speakerId: participant.identity,
      text: body,
      startTimeMs,
    })) {
      logger.info({ text: body.slice(0, 80) }, 'Dropped cross-speaker echo');
      return false;
    }

    const saved = await persistFinalTranscriptSegment({
      callId: metadata.call_id,
      segmentId,
      participant,
      publication,
      alternative,
      model,
      timestampOffsetMs,
      callStartedAtMs,
      nowMs,
    });
    if (!saved) return false;

    echoTracker.remember({
      speakerId: participant.identity,
      text: body,
      startTimeMs,
    });
    lastPersistedText = body;
    finals += 1;
    logger.info(
      {
        segment_id: segmentId,
        language: resolveSegmentLanguage(alternative),
        stt_language: text(alternative?.language) || 'auto',
        text: body.slice(0, 120),
      },
      'Persisted final transcript segment',
    );
    return true;
  };

  try {
    for await (const event of speechStream) {
      if (event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
        const alternative = event.alternatives?.[0];
        pendingAlternative = null;
        if (!alternative || !text(alternative.text)) continue;
        await persistUtterance(alternative, nextSegmentId(alternative));
        continue;
      }
      if (event.type === stt.SpeechEventType.INTERIM_TRANSCRIPT) {
        const alternative = event.alternatives?.[0];
        if (alternative && text(alternative.text)) {
          pendingAlternative = alternative;
        }
      }
    }
    await producer;
    if (pendingAlternative && text(pendingAlternative.text).replace(/\s+/g, '').length >= 8) {
      await persistUtterance(pendingAlternative, nextSegmentId(pendingAlternative));
    }
    logger.info({ finals }, 'Participant transcription stream closed');
    return true;
  } finally {
    speechStream.close();
    await speechToText.close();
    await producer.catch(() => {});
  }
}
