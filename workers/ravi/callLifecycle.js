import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import { storeBrowserCallRecording } from '../../services/proChat/recordingIngestionService.js';
import logger from '../../utils/logger.js';
import { DROP_LINE_GAP_MS, dropLine } from './lines.js';
import { isDebugOn } from './text.js';

const require = createRequire(import.meta.url);
const { getFfmpegPath } = require('@livekit/av');
const MAX_CALL_MS = { test: 20 * 60 * 1000, live: 45 * 60 * 1000 };
const MEMORY_LOG_MS = 60 * 1000;

export function watchReplyFailures(c) {
  const { session, callId } = c;
  const sayDrop = (retry) => {
    if (c.closing || c.closed) return;
    if (!retry && Date.now() - c.dropLineAt < DROP_LINE_GAP_MS) return;
    const line = session.tts ? dropLine(c.callLanguage) : '';
    if (!line) return;
    c.dropLineAt = Date.now();
    try {
      session.say(line, { addToChatCtx: false });
      c.dropLineOwedUntil = retry ? 0 : Date.now() + DROP_LINE_GAP_MS;
      logger.info(`Ravi reply failed on both routes, said: "${line}"`, { call_id: callId });
    } catch (error) {
      c.dropLineOwedUntil = Date.now() + DROP_LINE_GAP_MS;
      c.dropLineAt = 0;
      logger.warn(`Ravi could not say the line-dropped message (${error?.message || 'unknown error'})`, { call_id: callId });
    }
  };
  c.onVoiceFallback = () => {
    if (Date.now() > c.dropLineOwedUntil) return;
    sayDrop(true);
  };
  session.llm?.on?.('reply_failed', () => sayDrop(false));
}

export function watchCallLifecycle(c) {
  const { ctx, session, callId, isTest } = c;
  session.on('speech_created', () => {
    clearTimeout(c.idleTimer);
  });
  session.on('close', () => {
    for (const timer of c.timers) clearTimeout(timer);
    clearTimeout(c.closeTimer);
    clearTimeout(c.silenceTimer);
    clearTimeout(c.quietTimer);
    logger.info(`Ravi spoke ${c.spokenChars} characters on this call`, { call_id: callId, spoken_chars: c.spokenChars });
    if (!c.closed) {
      c.closed = true;
      c.quietRoom();
      ctx.shutdown('session closed');
    }
  });
  c.timers.push(setTimeout(() => {
    logger.info('Ravi call reached its time limit', { call_id: callId });
    void c.finish('time limit');
  }, isTest ? MAX_CALL_MS.test : MAX_CALL_MS.live));
  const memoryLog = () => {
    const usage = process.memoryUsage();
    const mb = (value) => Math.round(value / 1048576);
    logger.info('Ravi call memory', { call_id: callId, rss_mb: mb(usage.rss), heap_mb: mb(usage.heapUsed), external_mb: mb(usage.external), buffers_mb: mb(usage.arrayBuffers) });
  };
  const memoryTimer = isDebugOn() ? setInterval(memoryLog, MEMORY_LOG_MS) : null;
  memoryTimer?.unref?.();
  ctx.addShutdownCallback(async () => {
    clearInterval(memoryTimer);
    for (const timer of c.timers) clearTimeout(timer);
    clearTimeout(c.silenceTimer);
    clearTimeout(c.quietTimer);
    if (isTest && callId) {
      await ProfessionalCall.updateOne(
        { _id: callId, status: { $nin: ['ended', 'expired'] } },
        { $set: { status: 'ended', ended_at: new Date(), active_thread_key: null } },
      ).catch((error) => logger.warn('Ravi test call end failed', { call_id: callId, message: error?.message }));
    }
  });
}

export function watchClosing(c) {
  const { session } = c;
  session.on('agent_state_changed', (event) => {
    if (c.closed) return;
    if (c.instructionsStale && event?.newState === 'listening') {
      c.instructionsStale = false;
      c.languageSwitched = false;
      c.refreshCallState();
    }
    if (c.callerEnding && !c.closing && event?.newState === 'speaking') c.hangUpAfterSpeech('caller ended the call');
    if (!c.closing) return;
    clearTimeout(c.idleTimer);
    if (event?.newState === 'listening') c.idleTimer = setTimeout(() => void c.finish('closing line played'), 600);
  });
}

export function keepRecording(c) {
  const { ctx, session, callId, isTest } = c;
  const recordAudio = !isTest && Boolean(getFfmpegPath());
  c.recorded = recordAudio;
  const recordingStarted = Date.now();
  ctx.addShutdownCallback(async () => {
    if (!callId || !recordAudio) return;
    try {
      await session.close();
    } catch {
    }
    const filePath = path.join(ctx.sessionDirectory, 'audio.ogg');
    try {
      const buffer = await fs.readFile(filePath);
      await storeBrowserCallRecording({
        callId,
        buffer,
        durationSeconds: Math.max(0, Math.round((Date.now() - recordingStarted) / 1000)),
        extension: 'ogg',
        mimeType: 'audio/ogg',
      });
    } catch (error) {
      logger.warn('Ravi recording was not stored', { call_id: callId, error: error?.message });
      await ProfessionalCall.updateOne(
        { _id: callId, recording_status: { $ne: 'ready' } },
        { $set: { recording_status: 'failed', recording_last_error: error?.message || 'Recording was not stored' } },
      );
    }
  });
  return recordAudio;
}
