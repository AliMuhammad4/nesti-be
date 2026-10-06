import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { AudioByteStream, AutoSubscribe, defineAgent, llm, tts, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import ProfessionalCall from '../models/ProfessionalCall.js';
import { ingestFinalTranscriptSegment } from '../services/proChat/transcriptSegmentService.js';
import { storeBrowserCallRecording } from '../services/proChat/recordingIngestionService.js';
import { persistSalesOutcome } from '../services/proChat/voiceAgentTurnService.js';
import {
  allowedVoice,
  bargeIn,
  responseEagerness,
  silenceSeconds,
  speechSpeed,
  liveSalesInstructions,
  loadCaller,
  loadSalesSettings,
  prepareSignupLink,
} from '../services/proChat/voiceSalesBrief.js';
import logger from '../utils/logger.js';

const require = createRequire(import.meta.url);
const { getFfmpegPath } = require('@livekit/av');

const SPOKEN_LANGUAGES = {
  en: 'English',
  english: 'English',
  fr: 'French',
  french: 'French',
  es: 'Spanish',
  spanish: 'Spanish',
  ar: 'Arabic',
  arabic: 'Arabic',
  ur: 'Urdu',
  urdu: 'Urdu',
};

function languageCue(code) {
  const raw = text(code).toLowerCase().replace('_', '-');
  const spoken = SPOKEN_LANGUAGES[raw] || SPOKEN_LANGUAGES[raw.split('-')[0]];
  if (!spoken) return 'Speak in the language of their latest words. English is the default.';
  return `Speak only in ${spoken}.`;
}

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
  if (!uri) throw new Error('MONGO_URI is required by the Ravi worker.');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function rememberLine(callId, speaker, line) {
  const spoken = text(line);
  if (!callId || !spoken) return;
  const stamp = Date.now();
  await ingestFinalTranscriptSegment({
    callId,
    segmentId: `${speaker}-${stamp}`,
    speakerUserId: speaker === 'agent' ? 'nesti-voice-agent' : 'caller',
    speakerName: speaker === 'agent' ? 'Nesti Voice' : 'Caller',
    text: spoken,
    provider: 'livekit',
    providerEventId: `ravi:${callId}:${speaker}:${stamp}`,
    model: process.env.OPENAI_VOICE_AGENT_MODEL || 'gpt-4o-mini',
  }).catch(() => {});
}

class CloneVoice extends tts.TTS {
  label = 'elevenlabs.TTS';
  constructor(voiceId, speed = 1) {
    super(24000, 1, { streaming: true });
    this.voiceId = voiceId;
    this.speed = speed;
  }
  get model() {
    return 'eleven_flash_v2_5';
  }
  get provider() {
    return 'elevenlabs';
  }
  synthesize() {
    throw new Error('Cloned voice uses the streaming path.');
  }
  stream() {
    return new CloneVoiceStream(this);
  }
}

class CloneVoiceStream extends tts.SynthesizeStream {
  label = 'elevenlabs.SynthesizeStream';
  constructor(parent) {
    super(parent);
    this.voiceId = parent.voiceId;
    this.speed = parent.speed;
  }
  async run() {
    const requestId = `${Date.now()}`;
    let pending = '';
    for await (const chunk of this.input) {
      if (chunk === tts.SynthesizeStream.FLUSH_SENTINEL) {
        if (pending) await this.speak(pending, requestId);
        pending = '';
        continue;
      }
      pending += chunk;
    }
    if (pending) await this.speak(pending, requestId);
  }
  async speak(line, requestId) {
    const spoken = text(line);
    if (!spoken) return;
    this.markStarted();
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': text(process.env.ELEVENLABS_API_KEY),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: spoken,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: this.speed || 1 },
        }),
        signal: this.abortSignal,
      },
    );
    if (!response.ok || !response.body) {
      throw new Error(`Cloned voice failed (${response.status})`);
    }
    const audio = new AudioByteStream(24000, 1);
    const reader = response.body.getReader();
    let lastFrame;
    const sendLast = (final) => {
      if (!lastFrame) return;
      this.queue.put({ requestId, segmentId: requestId, frame: lastFrame, final });
      lastFrame = undefined;
    };
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      for (const frame of audio.write(step.value)) {
        sendLast(false);
        lastFrame = frame;
      }
    }
    for (const frame of audio.flush()) {
      sendLast(false);
      lastFrame = frame;
    }
    sendLast(true);
  }
}

function openSession({ builtinVoice, speechSpeed: speed, cloneVoiceId, eagerness, interrupt, awaySeconds }) {
  const shared = { userAwayTimeout: awaySeconds, allowInterruptions: interrupt };
  if (cloneVoiceId && text(process.env.ELEVENLABS_API_KEY)) {
    return new voice.AgentSession({
      stt: new openai.STT({ model: 'gpt-4o-mini-transcribe', detectLanguage: true, useRealtime: true }),
      llm: new openai.LLM({ model: process.env.OPENAI_VOICE_AGENT_MODEL || 'gpt-4o-mini' }),
      tts: new CloneVoice(cloneVoiceId, speed),
      ...shared,
    });
  }
  return new voice.AgentSession({
    llm: new openai.realtime.RealtimeModel({
      voice: builtinVoice,
      speed,
      turnDetection: {
        type: 'semantic_vad',
        eagerness,
        create_response: true,
        interrupt_response: interrupt,
      },
      inputAudioTranscription: { model: 'gpt-4o-mini-transcribe' },
    }),
    ...shared,
  });
}

const raviSalesAgent = defineAgent({
  entry: async (ctx) => {
    const metadata = parseMetadata(ctx.job.metadata);
    const callId = text(metadata.call_id);
    const mongoReady = connectMongo();
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    await mongoReady;
    const call = callId
      ? await ProfessionalCall.findById(callId).select('status voice_target_type voice_target_id voice_agent_voice').lean()
      : null;
    if (!call || ['ended', 'expired', 'declined'].includes(call.status)) {
      ctx.shutdown('call is not open');
      return;
    }
    const [settings, caller] = await Promise.all([
      loadSalesSettings().catch(() => null),
      loadCaller(call).catch(() => ({ name: '', note: '', userId: '', kind: call.voice_target_type })),
    ]);
    const builtinVoice = allowedVoice(settings?.voice, allowedVoice(call.voice_agent_voice));
    const session = openSession({
      builtinVoice,
      speechSpeed: speechSpeed(settings?.speech_speed),
      cloneVoiceId: text(settings?.clone_voice_id),
      eagerness: responseEagerness(settings?.vad_eagerness),
      interrupt: bargeIn(settings?.barge_in),
      awaySeconds: silenceSeconds(settings?.silence_seconds),
    });
    const role = call.voice_target_type === 'lead'
      ? 'client'
      : (metadata.role || (call.voice_target_type === 'client' ? 'client' : 'agent'));
    let spokenLanguage = '';
    let nudged = false;
    let modelSpoke = false;
    let closing = false;
    let closed = false;
    let confirmStarted = false;
    let closeTimer;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(closeTimer);
      ctx.shutdown('sales outcome saved');
    };
    const recordOutcome = llm.tool({
      description: 'Save the sales result only after the caller clearly agrees, clearly declines, or clearly asks for a callback. Do not call this when you only recommend a plan or during the greeting.',
      parameters: {
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: ['interested', 'callback', 'declined', 'plan_recommended'] },
          plan: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['outcome'],
      },
      execute: async (args) => {
        const saved = await persistSalesOutcome({
          callId,
          outcome: args?.outcome,
          plan: args?.plan,
          note: args?.note,
        });
        if (!saved.ok) return saved.message;
        const outcome = text(args?.outcome).toLowerCase();
        const shouldClose = outcome === 'interested' || outcome === 'declined' || outcome === 'callback';
        let next = 'Keep talking. Do not end the call.';
        if (outcome === 'interested') {
          const link = await prepareSignupLink({
            kind: call.voice_target_type === 'sales' ? 'professional' : 'client',
            userId: caller.userId,
            planLabel: args?.plan,
          });
          if (link.url) {
            await ProfessionalCall.updateOne({ _id: callId }, { $set: { voice_checkout_url: link.url } });
          }
          next = `${link.spoken} Do not read a web address.`;
        }
        if (outcome === 'callback') next = 'Confirm the follow-up in one sentence and stop pitching.';
        if (outcome === 'declined') next = 'Thank them in one sentence and stop pitching.';
        if (!shouldClose) return `${next} Do not say the word saved. ${languageCue(spokenLanguage)}`;
        closing = true;
        confirmStarted = false;
        closeTimer = setTimeout(finish, 20000);
        return `${next} Do not say the word saved. ${languageCue(spokenLanguage)}`;
      },
    });
    session.on('speech_created', () => {
      modelSpoke = true;
    });
    session.on('agent_state_changed', (event) => {
      if (!closing || closed) return;
      if (event?.newState === 'speaking') confirmStarted = true;
      if (confirmStarted && event?.oldState === 'speaking' && event?.newState === 'listening') finish();
    });
    session.on('user_state_changed', (event) => {
      if (closing) return;
      if (event?.newState !== 'away' || nudged) return;
      if (session.agentState === 'speaking' || session.agentState === 'thinking') return;
      nudged = true;
      session.generateReply({
        instructions: `They went quiet. Ask one short question that continues toward the subscription. Do not restart the pitch, repeat a plan, or introduce yourself. ${languageCue(spokenLanguage)}`,
      });
    });
    session.on('user_input_transcribed', (event) => {
      if (!event?.isFinal) return;
      nudged = false;
      if (event.language) spokenLanguage = text(event.language);
      void rememberLine(callId, 'caller', event.transcript);
    });
    session.on('conversation_item_added', (event) => {
      const item = event?.item;
      if (item?.role === 'assistant') void rememberLine(callId, 'agent', item.textContent);
    });
    const recordAudio = Boolean(getFfmpegPath());
    const recordingStarted = Date.now();
    ctx.addShutdownCallback(async () => {
      if (!callId || !recordAudio) return;
      try {
        await session.close();
      } catch {
        // The room may already have closed the session.
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
    await session.start({
      agent: new voice.Agent({
        instructions: liveSalesInstructions({ role, caller, settings }),
        tools: { record_sales_outcome: recordOutcome },
      }),
      room: ctx.room,
      record: recordAudio ? { audio: true, traces: false, logs: false, transcript: false } : false,
    });
    await ctx.waitForParticipant();
    if (!modelSpoke && session.agentState !== 'speaking' && session.agentState !== 'thinking') {
      const named = text(caller.name) ? ` Use their name, ${caller.name}.` : '';
      session.generateReply({
        instructions: `Greet in one short English sentence. Introduce yourself as Ravi from Nesti and ask what they want to get done. Do not name a plan.${named}`,
      });
    }
  },
});

export default raviSalesAgent;
