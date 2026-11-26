import 'dotenv/config';
import os from 'node:os';
import { defineAgent } from '@livekit/agents';
import logger from '../utils/logger.js';
import { attachCallBrief } from './ravi/callBrief.js';
import { attachCallEnd } from './ravi/callEnd.js';
import { watchCallerHearing } from './ravi/callerHearing.js';
import { prewarmPresenceVad, watchCallerPresence } from './ravi/callerPresence.js';
import { watchCallerTurns, watchRaviLines } from './ravi/callerTurns.js';
import { keepRecording, watchCallLifecycle, watchClosing, watchReplyFailures } from './ravi/callLifecycle.js';
import { createCallTools } from './ravi/callTools.js';
import { connectMongo, markMongoPrewarm } from './ravi/mongo.js';
import { prepareCall } from './ravi/prepareCall.js';
import { watchPipeline } from './ravi/pipelineSave.js';
import { watchQuiet } from './ravi/quietCheckIn.js';
import { watchReplies } from './ravi/replyWatchdog.js';
import { prewarmHearing } from './ravi/session.js';
import { createAgent, greetCaller, logJoined, watchRoom } from './ravi/startCall.js';
import { isDebugOn } from './ravi/text.js';
import { trackTurnLatency } from './ravi/turnLatency.js';
import { loadSalesSettings } from '../services/proChat/voiceSalesBrief.js';
import { CREDITS_LOW } from './raviVoiceTts.js';

function prewarmDatabase() {
  connectMongo().then(() => {
    markMongoPrewarm(true);
    loadSalesSettings({ fresh: true }).catch(() => {});
  }).catch((error) => {
    markMongoPrewarm(false);
    logger.warn(`Ravi could not reach the database (${error?.message || 'unknown error'})`);
  });
}

const raviSalesAgent = defineAgent({
  prewarm: async () => {
    try {
      os.setPriority(0, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    } catch (error) {
      logger.warn(`Ravi call process could not raise its priority (${error?.message || 'unknown error'})`);
    }
    prewarmDatabase();
    prewarmHearing();
    prewarmPresenceVad();
  },
  entry: async (ctx) => {
    const c = await prepareCall(ctx);
    if (!c) return;
    const { session } = c;
    watchReplyFailures(c);
    c.debugOn = isDebugOn();
    attachCallBrief(c);
    attachCallEnd(c);
    c.voiceCheckPromise?.then((checked) => {
      const credits = checked?.credits;
      if (credits) {
        const line = `ElevenLabs credits used ${credits.used} of ${credits.limit} (plan ${credits.tier || 'unknown'})`;
        if (credits.left < CREDITS_LOW) logger.warn(`${line}, only ${credits.left} left`, { call_id: c.callId });
        else logger.info(line, { call_id: c.callId });
      }
      if (c.closed || c.voiceFailed) return;
      if (checked && checked.ok === false) c.failVoice(checked.problem || 'ElevenLabs could not speak');
    });
    c.tools = createCallTools(c);
    watchCallLifecycle(c);
    c.noteActivity = trackTurnLatency(session, c.callId);
    watchClosing(c);
    watchCallerHearing(c);
    watchCallerPresence(c);
    watchQuiet(c);
    watchCallerTurns(c);
    watchReplies(c);
    watchRaviLines(c);
    watchPipeline(c);
    const recordAudio = keepRecording(c);
    const agent = createAgent(c);
    c.join?.stage('session start');
    await session.start({
      agent,
      room: ctx.room,
      record: recordAudio ? { audio: true, traces: false, logs: false, transcript: false } : false,
      outputOptions: c.isTest ? { syncTranscription: false } : undefined,
    });
    watchRoom(c);
    c.join?.stage('caller');
    const startedAt = Date.now();
    const callerAt = await Promise.race([
      ctx.waitForParticipant().then(() => Date.now()),
      new Promise((resolve) => setTimeout(() => resolve(0), 60_000)),
    ]);
    c.join?.done();
    if (!callerAt) {
      logger.info('Ravi ended the call, caller never joined', { call_id: c.callId });
      await c.finish('caller never joined');
      return;
    }
    const voiceMissing = c.voiceFailed ? true : await greetCaller(c);
    logJoined(c, { startedAt, callerAt, voiceMissing });
  },
});

export default raviSalesAgent;
