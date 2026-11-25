import { voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as openai from '@livekit/agents-plugin-openai';
import { languageMode } from '../../services/proChat/callLanguage.js';
import { ttsModel, voiceEngine } from '../../services/proChat/voiceSalesBrief.js';
import { createElevenLabsVoice, elevenLabsKey, secondElevenLabsOptions } from '../raviVoiceTts.js';
import logger from '../../utils/logger.js';
import { CloneVoice } from './cloneVoice.js';
import { HearingSwitch } from './hearingSwitch.js';
import { replyLlm } from './replyLlm.js';

const HEARING_MODEL = 'gpt-4o-mini-transcribe';
const ENDPOINTING_MIN_DELAY = { low: 900, medium: 600, high: 450, auto: 600 };
const ENDPOINTING_MAX_DELAY = 1000;

const HEARING_HINT = 'Nesti, Ravi, realtor, mortgage broker, lawyer';
const SPARE_HEARING = 'scribe_v2_realtime';
const SPARE_HINTS = HEARING_HINT.split(',').map((word) => word.trim()).filter(Boolean);

function openAiHearing(mode) {
  const shared = { model: HEARING_MODEL, useRealtime: true, prompt: HEARING_HINT, noiseReductionType: 'near_field' };
  if (languageMode(mode) === 'english') return new openai.STT({ ...shared, language: 'en', detectLanguage: false });
  return new openai.STT({ ...shared, language: '', detectLanguage: true });
}

function spareHearing(mode) {
  const apiKey = elevenLabsKey();
  if (!apiKey) throw new Error('ElevenLabs API key is not set');
  const opts = { model: SPARE_HEARING, apiKey, keyterms: SPARE_HINTS, serverVad: {} };
  if (languageMode(mode) === 'english') opts.languageCode = 'en';
  return new elevenlabs.STT(opts);
}

function anyLanguageHearing(mode = 'auto', callId = '') {
  return new HearingSwitch({
    primary: openAiHearing(mode),
    makeSpare: () => spareHearing(mode),
    spareName: 'ElevenLabs Scribe',
    callId,
  });
}

export function callEndpointing(isTest, eagerness) {
  return isTest
    ? { mode: 'dynamic', minDelay: 300, maxDelay: 550 }
    : { mode: 'dynamic', minDelay: ENDPOINTING_MIN_DELAY[eagerness] || 600, maxDelay: ENDPOINTING_MAX_DELAY };
}

function pipelineVoice(engine, speed, cloneVoiceId, voiceCheck, callId, onVoiceFail, onVoiceFallback) {
  if (voiceCheck && !voiceCheck.ok) return undefined;
  const model = ttsModel(engine?.tts_model);
  try {
    return createElevenLabsVoice({
      voiceId: cloneVoiceId,
      model,
      speed: Math.min(1.2, Math.max(0.7, Number(speed) || 1)),
      onFallback: (reason, { staying } = {}) => {
        const second = secondElevenLabsOptions({ voiceId: cloneVoiceId, model });
        const until = staying ? 'for the rest of the call' : "until the caller's next turn";
        logger.warn(`Ravi voice: ElevenLabs fast model failed (${reason}), using ElevenLabs ${second.model} voice=${second.voiceId} ${until}`, { call_id: callId });
        onVoiceFallback?.();
      },
      onGiveUp: (reason) => onVoiceFail?.(reason),
    });
  } catch (error) {
    logger.error(`Ravi voice: ElevenLabs voice failed to start (${error?.message || 'unknown error'})`, { call_id: callId });
    return undefined;
  }
}

function withHearing(session) {
  session.stt?.watchSession?.(session);
  return session;
}

function pipelineSession({ engine, interrupt, awaySeconds, speed, cloneVoiceId, voiceCheck, callId, onVoiceFail, onVoiceFallback, endpointing }) {
  return withHearing(new voice.AgentSession({
    stt: anyLanguageHearing(engine.language_mode, callId),
    llm: replyLlm(),
    tts: pipelineVoice(engine, speed, cloneVoiceId, voiceCheck, callId, onVoiceFail, onVoiceFallback),
    vad: null,
    userAwayTimeout: awaySeconds,
    turnHandling: {
      turnDetection: 'stt',
      endpointing,
      interruption: {
        enabled: interrupt,
        minDuration: 500,
        minWords: 3,
        falseInterruptionTimeout: 1500,
        resumeFalseInterruption: true,
      },
      preemptiveGeneration: { enabled: true, maxRetries: 1 },
    },
  }));
}

export function openSession({ builtinVoice, speechSpeed: speed, cloneVoiceId, eagerness, interrupt, awaySeconds, engine, voiceCheck, callId, onVoiceFail, onVoiceFallback, endpointing }) {
  if (voiceEngine(engine?.voice_engine) === 'pipeline') {
    try {
      return pipelineSession({ engine, eagerness, interrupt, awaySeconds, speed, cloneVoiceId, voiceCheck, callId, onVoiceFail, onVoiceFallback, endpointing });
    } catch (error) {
      logger.warn('Ravi pipeline voice failed, using realtime', { error: error?.message });
    }
  }
  const shared = { userAwayTimeout: awaySeconds, turnHandling: { interruption: { enabled: interrupt, minDuration: 600 } } };
  if (cloneVoiceId && elevenLabsKey()) {
    return withHearing(new voice.AgentSession({
      stt: anyLanguageHearing(engine?.language_mode, callId),
      llm: replyLlm(),
      tts: new CloneVoice(cloneVoiceId, speed),
      vad: null,
      ...shared,
    }));
  }
  return new voice.AgentSession({
    llm: new openai.realtime.RealtimeModel({
      voice: builtinVoice,
      speed,
      turnDetection: {
        type: 'semantic_vad',
        eagerness: eagerness === 'medium' ? 'high' : eagerness,
        create_response: true,
        interrupt_response: true,
      },
      inputAudioTranscription: languageMode(engine?.language_mode) === 'english'
        ? { model: HEARING_MODEL, language: 'en' }
        : { model: HEARING_MODEL },
    }),
    vad: null,
    ...shared,
  });
}

export function prewarmSession(session, { urdu = true } = {}) {
  for (const part of [session.tts, session.llm]) {
    try {
      part?.prewarm?.({ urdu });
    } catch {
      continue;
    }
  }
}
