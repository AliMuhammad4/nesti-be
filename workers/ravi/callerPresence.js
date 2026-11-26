import { inference, VADEventType } from '@livekit/agents';
import { AudioStream, ParticipantKind, RoomEvent, TrackKind, TrackSource } from '@livekit/rtc-node';
import logger from '../../utils/logger.js';

let sharedVad;

export function presenceVad() {
  if (sharedVad === undefined) sharedVad = createPresenceVad();
  return sharedVad;
}

export function createPresenceVad() {
  try {
    return new inference.VAD({
      model: 'silero',
      minSpeechDuration: 80,
      minSilenceDuration: 200,
      activationThreshold: 0.5,
    });
  } catch (error) {
    logger.warn(`Ravi local speaking detector could not start (${error?.message || 'unknown error'})`);
    return null;
  }
}

export function prewarmPresenceVad() {
  try {
    const vad = presenceVad();
    if (!vad) return;
    const stream = vad.stream();
    const timer = setTimeout(() => {
      try { stream.close(); } catch { /* already closed */ }
    }, 200);
    timer.unref?.();
    logger.info('Ravi local speaking detector is ready');
  } catch (error) {
    logger.warn(`Ravi local speaking detector could not pre-warm (${error?.message || 'unknown error'})`);
  }
}

export function watchCallerPresence(c, vad = presenceVad()) {
  const { ctx, callId, session } = c;
  c.callerPresent = false;
  c.presentAt = 0;
  if (session?.stt) session.stt.callerPresenting = () => Boolean(c.callerPresent) || Date.now() - (c.presentAt || 0) < 400;
  if (!vad || !ctx?.room) return () => {};
  const streams = new Set();
  let closed = false;
  let vadStream;
  try {
    vadStream = vad.stream();
  } catch (error) {
    logger.warn(`Ravi local speaking detector stream failed (${error?.message || 'unknown error'})`, { call_id: callId });
    return () => {};
  }

  const listen = async () => {
    try {
      for await (const event of vadStream) {
        if (closed) break;
        if (event.type === VADEventType.START_OF_SPEECH) {
          c.callerPresent = true;
          c.presentAt = Date.now();
          session?.stt?.noteLocalSpeech?.(true);
          logger.info('Ravi local detector heard the caller start speaking', { call_id: callId });
        } else if (event.type === VADEventType.END_OF_SPEECH) {
          c.callerPresent = false;
          c.presentAt = Date.now();
          session?.stt?.noteLocalSpeech?.(false);
          logger.info('Ravi local detector heard the caller stop speaking', { call_id: callId });
        } else if (event.type === VADEventType.INFERENCE_DONE && event.speaking) {
          c.callerPresent = true;
          c.presentAt = Date.now();
        }
      }
    } catch (error) {
      if (!closed) logger.warn(`Ravi local speaking detector stopped (${error?.message || 'unknown error'})`, { call_id: callId });
    }
  };
  void listen();

  const attach = (track, publication, participant) => {
    if (closed || !track) return;
    if (participant?.kind === ParticipantKind.AGENT) return;
    if (participant?.identity && participant.identity === ctx.room?.localParticipant?.identity) return;
    if (publication?.source && publication.source !== TrackSource.SOURCE_MICROPHONE) return;
    if (track.kind != null && track.kind !== TrackKind.KIND_AUDIO && track.kind !== 'audio') return;
    let audio;
    try {
      audio = new AudioStream(track, { sampleRate: 16000, numChannels: 1 });
    } catch (error) {
      logger.warn(`Ravi local speaking detector could not open the caller audio (${error?.message || 'unknown error'})`, { call_id: callId });
      return;
    }
    streams.add(audio);
    (async () => {
      try {
        for await (const frame of audio) {
          if (closed) break;
          try { vadStream.pushFrame(frame); } catch { break; }
        }
      } catch {
        return;
      }
    })();
  };

  const onSubscribed = (track, publication, participant) => attach(track, publication, participant);
  ctx.room.on(RoomEvent.TrackSubscribed, onSubscribed);
  for (const participant of ctx.room.remoteParticipants?.values?.() || []) {
    for (const publication of participant.trackPublications?.values?.() || []) {
      if (publication.track) attach(publication.track, publication, participant);
    }
  }

  const stop = () => {
    if (closed) return;
    closed = true;
    ctx.room.off(RoomEvent.TrackSubscribed, onSubscribed);
    try { vadStream.close(); } catch { /* already closed */ }
    for (const stream of streams) {
      try { stream.cancel?.(); } catch { /* already closed */ }
    }
  };
  session?.on?.('close', stop);
  return stop;
}
