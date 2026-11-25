import * as openai from '@livekit/agents-plugin-openai';
import { AutoSubscribe } from '@livekit/agents';
import { ParticipantKind } from '@livekit/rtc-node';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import {
  allowedVoice,
  bargeIn,
  loadCaller,
  loadSalesSettings,
  responseEagerness,
  silenceSeconds,
  speechSpeed,
  ttsModel,
  ttsVoice,
  voiceEngine,
} from '../../services/proChat/voiceSalesBrief.js';
import { createLanguageTracker, languageMode } from '../../services/proChat/callLanguage.js';
import { checkElevenLabs, voiceSetupProblem } from '../raviVoiceTts.js';
import { newCallState } from './callState.js';
import { connectMongo, mongoReady, waitForMongo } from './mongo.js';
import { callEndpointing, openSession, prewarmSession } from './session.js';
import { isDebugOn, parseMetadata, text } from './text.js';
import logger from '../../utils/logger.js';

const SLOW_JOIN_MS = 8000;
const SLOW_CALLER_MS = 15000;
const DB_WAIT_MS = 4000;
const DB_RETRY_MS = 5000;

export function watchJoin(callId) {
  let stage = 'room';
  let timer;
  const startedAt = Date.now();
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      logger.warn(`Ravi is slow to join the call (${Date.now() - startedAt} ms, waiting on ${stage})`, { call_id: callId });
    }, ms);
    timer.unref?.();
  };
  arm(SLOW_JOIN_MS);
  return {
    stage: (name) => {
      stage = name;
      if (name === 'caller') arm(SLOW_CALLER_MS);
    },
    done: () => clearTimeout(timer),
  };
}

async function connectRoom(ctx, callId) {
  try {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
  } catch (error) {
    logger.warn(`Ravi room connect failed (${error?.message || 'unknown error'}), trying once more`, { call_id: callId });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
  }
}

function keepTryingMongo(callId) {
  let tries = 0;
  const attempt = () => {
    if (mongoReady()) return;
    tries += 1;
    connectMongo().then(() => {
      logger.info(`Ravi reached the database during the call after ${tries} tries`, { call_id: callId });
    }).catch(() => {
      if (tries >= 12) return;
      const timer = setTimeout(attempt, DB_RETRY_MS);
      timer.unref?.();
    });
  };
  const timer = setTimeout(attempt, DB_RETRY_MS);
  timer.unref?.();
}

function offlineCall(metadata) {
  const testRoom = /^admin-voice:test:/.test(text(metadata.room_name)) || Boolean(metadata.test);
  return {
    status: 'active',
    voice_target_type: testRoom ? 'test' : text(metadata.role) === 'client' ? 'client' : 'sales',
    voice_target_id: '',
    voice_agent_voice: '',
  };
}

async function findCall(callId, metadata) {
  const isTest = /^admin-voice:test:/.test(text(metadata?.room_name)) || Boolean(metadata?.test);
  // Test calls are saved in the background, so a fast click may reach here
  // before the row exists. Three quick looks, then the offline fallback.
  const tries = isTest ? 3 : 6;
  for (let i = 0; callId && i < tries; i += 1) {
    const row = await ProfessionalCall.findById(callId).select('status voice_target_type voice_target_id voice_agent_voice').lean();
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return isTest ? offlineCall(metadata) : null;
}

export async function prepareCall(ctx) {
  const joinedAt = Date.now();
  const metadata = parseMetadata(ctx.job.metadata);
  const callId = text(metadata.call_id);
  const join = watchJoin(callId);
  const roomReady = connectRoom(ctx, callId);
  join.stage('database');
  const dbReady = await waitForMongo(DB_WAIT_MS);
  join.stage('call record');
  let call;
  let settings = null;
  if (dbReady) {
    [call, settings] = await Promise.all([
      findCall(callId, metadata).catch(() => offlineCall(metadata)),
      loadSalesSettings({ fresh: true }).catch(() => null),
    ]);
  } else {
    logger.warn('Ravi started without the database, using default settings; the call is saved once it reconnects', { call_id: callId });
    call = offlineCall(metadata);
    keepTryingMongo(callId);
  }
  if (!call || ['ended', 'expired', 'declined'].includes(call.status)) {
    join.done();
    logger.info(`Ravi left, the call is not open (${call ? call.status : 'not found'})`, { call_id: callId });
    ctx.shutdown('call is not open');
    return null;
  }
  const pipelineCall = voiceEngine({ ...(settings || {}), ...(metadata.test || {}) }.voice_engine) === 'pipeline';
  const voicePrefs = { ...(settings || {}), ...(metadata.test || {}) };
  const pickedVoice = text(settings?.clone_voice_id) || ttsVoice(voicePrefs.tts_voice);
  const pickedModel = ttsModel(voicePrefs.tts_model);
  const loadedAt = Date.now();
  const elevenCall = pipelineCall;
  const setupProblem = elevenCall ? voiceSetupProblem() : '';
  const voiceCheckPromise = elevenCall && !setupProblem
    ? checkElevenLabs({ voiceId: pickedVoice, model: pickedModel }).catch(() => null)
    : null;
  // Open the session and the ElevenLabs socket BEFORE waiting on the room, so
  // the first greeting doesn't pay for the socket handshake. The session is
  // only started after the room and caller lookups come back.
  const isTest = call.voice_target_type === 'test';
  const testOverrides = isTest && metadata.test && typeof metadata.test === 'object' ? metadata.test : {};
  const tuned = { ...(settings || {}), ...testOverrides };
  const builtinVoice = allowedVoice(tuned.voice, allowedVoice(call.voice_agent_voice));
  const voiceCheck = setupProblem ? { ok: false, problem: setupProblem } : null;
  const endpointing = callEndpointing(isTest, responseEagerness(tuned.vad_eagerness));
  // The call state is created after the room is ready, so the voice callbacks
  // use a late-bound reference and fire once failVoice/onVoiceFallback are set.
  const stateRef = { current: null };
  const session = openSession({
    onVoiceFail: (reason) => stateRef.current?.failVoice?.(reason),
    onVoiceFallback: () => stateRef.current?.onVoiceFallback?.(),
    endpointing,
    builtinVoice,
    speechSpeed: speechSpeed(tuned.speech_speed),
    cloneVoiceId: pickedVoice,
    eagerness: responseEagerness(tuned.vad_eagerness),
    interrupt: bargeIn(tuned.barge_in),
    awaySeconds: silenceSeconds(tuned.silence_seconds),
    engine: tuned,
    voiceCheck,
    callId,
  });
  const mode = languageMode(tuned.language_mode);
  prewarmSession(session, { urdu: mode !== 'english' });
  join.stage('room and caller');
  const [caller] = await Promise.all([
    (dbReady ? loadCaller(call) : Promise.resolve({ name: '', note: '', userId: '', kind: call.voice_target_type })).catch(() => ({ name: '', note: '', userId: '', kind: call.voice_target_type })),
    roomReady,
  ]);
  const roomAt = Date.now();
  const otherRavi = [...(ctx.room?.remoteParticipants?.values?.() || [])].some((p) => p?.kind === ParticipantKind.AGENT);
  if (otherRavi) {
    join.done();
    logger.info('Ravi left, another Ravi is already in the call', { call_id: callId });
    ctx.shutdown('another Ravi is already in the call');
    try { await session.close?.(); } catch { /* already closed */ }
    return null;
  }
  const c = newCallState({
    ctx,
    callId,
    call,
    settings,
    caller,
    tuned,
    isTest,
    elevenCall,
    voiceCheck,
    voiceCheckPromise,
    pickedVoice,
    pickedModel,
    builtinVoice,
    joinedAt,
    loadedAt,
    roomAt,
    join,
  });
  stateRef.current = c;
  c.session = session;
  c.mode = mode;
  c.filterTurns = !(session.llm instanceof openai.realtime.RealtimeModel);
  c.role = call.voice_target_type === 'lead'
    ? 'client'
    : (metadata.role || (call.voice_target_type === 'client' ? 'client' : 'agent'));
  c.languages = createLanguageTracker(c.mode);
  return c;
}
