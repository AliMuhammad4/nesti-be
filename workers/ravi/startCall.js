import { ParticipantKind } from '@livekit/rtc-node';
import { createReplyPace } from '../../services/proChat/replyPace.js';
import { voiceEngine } from '../../services/proChat/voiceSalesBrief.js';
import { createSalesPipeline, pipelineRole } from '../../services/proChat/salesPipeline.js';
import { chatFaqAnswer, warmChatKnowledge } from '../../services/proChat/chatKnowledge.js';
import { claimRaviGreeting } from '../../services/proChat/liveKitRoomService.js';
import { elevenLabsOptions, RaviVoice } from '../raviVoiceTts.js';
import logger from '../../utils/logger.js';
import { turnFilter } from './callerTurns.js';
import { englishGreeting } from './lines.js';
import { RaviAgent } from './raviAgent.js';
import { warmReplyModel } from './replyLlm.js';
import { text } from './text.js';

export function createAgent(c) {
  const { callId } = c;
  const agent = new RaviAgent({
    instructions: c.baseInstructions,
    tools: c.tools,
  }, turnFilter(c));
  c.agent = agent;
  agent.pace = c.filterTurns ? createReplyPace(() => c.callLanguage) : null;
  agent.replyCue = () => (c.languageSwitched ? `Call state: the caller just changed language. ${c.languageNow()}` : '');
  c.pipeline = createSalesPipeline(c.role, {
    roleKnown: Boolean(pipelineRole(c.role)),
    questions: c.settings?.[`${pipelineRole(c.role)}_questions`],
    faqAnswer: chatFaqAnswer,
  });
  void warmChatKnowledge();
  agent.pipelineCue = () => c.pipeline?.cue() || '';
  agent.stateCue = () => c.stateNote || '';
  agent.onSlowReply = (kind, ms, line = '') => {
    c.noteActivity(kind === 'retry' ? 'reply retry' : 'reply filler');
    if (kind === 'retry') logger.warn(`Ravi reply model gave no first word in ${ms} ms, stopped that request and asked again once`, { call_id: callId });
    else logger.info(`Ravi reply slow (${ms} ms), said a short filler: "${line}"`, { call_id: callId });
  };
  if (c.debugOn) {
    agent.onSpokenScript = (original, spoken, guessed = []) => {
      const unknown = guessed.length ? ` guessed=${guessed.join(',')}` : '';
      logger.info(`Ravi voice text (Devanagari for the voice only): "${spoken}" from "${original}"${unknown}`, { call_id: callId });
    };
  }
  return agent;
}

export function watchRoom(c) {
  const { ctx, callId } = c;
  ctx.room?.on?.('participantConnected', (participant) => {
    if (participant?.kind !== ParticipantKind.AGENT) return;
    const mine = ctx.room?.localParticipant;
    if (!mine || participant.identity === mine.identity) return;
    const mineAt = Number(mine.joinedAt || 0);
    const theirs = Number(participant.joinedAt || 0);
    if (!theirs || !mineAt || mineAt <= theirs) return;
    logger.info('Ravi left because another Ravi was already in the call', { call_id: callId });
    ctx.shutdown('another Ravi is already in the call');
  });
  ctx.room?.on?.('disconnected', c.quietRoom);
  ctx.room?.on?.('participantDisconnected', (participant) => {
    if (participant?.kind === ParticipantKind.AGENT) return;
    if (participant?.identity === ctx.room?.localParticipant?.identity) return;
    c.quietRoom();
  });
}

export async function greetCaller(c) {
  const { session, caller } = c;
  const roomName = c.ctx?.room?.name || c.call?.room_name;
  const first = await claimRaviGreeting(roomName);
  if (!first) {
    c.greeted = true;
    logger.info('Ravi skipped the greeting because this call already has one', { call_id: c.callId });
    return false;
  }
  const voiceMissing = c.elevenCall && !(session.tts instanceof RaviVoice);
  if (voiceMissing) {
    c.failVoice(c.voiceCheck && !c.voiceCheck.ok ? c.voiceCheck.problem : 'the ElevenLabs voice could not start');
  } else if (session.tts) {
    warmReplyModel(session.llm, c.baseInstructions);
    session.say(englishGreeting(caller.name, c.recorded && !c.isTest));
  } else {
    const named = text(caller.name) ? ` Use their name, ${caller.name}.` : '';
    session.generateReply({
      instructions: `Greet in one short English sentence. Introduce yourself as Ravi from Nesti and ask what they want to get done. Do not name a plan.${named}`,
    });
  }
  return voiceMissing;
}

export function logJoined(c, { startedAt, callerAt, voiceMissing }) {
  const { session, callId, joinedAt, loadedAt, roomAt, pickedVoice, pickedModel, builtinVoice, tuned, role } = c;
  const joinedVoice = session.tts instanceof RaviVoice
    ? `elevenlabs:${elevenLabsOptions({ voiceId: pickedVoice, model: pickedModel }).voiceId} model=${elevenLabsOptions({ model: pickedModel }).model}`
    : voiceMissing ? 'none (ElevenLabs could not start)'
    : builtinVoice;
  const steps = `db_ms=${loadedAt - joinedAt} room_ms=${roomAt - loadedAt} session_ms=${startedAt - roomAt} caller_ms=${callerAt - startedAt}`;
  logger.info(`Ravi joined the call voice=${joinedVoice} ready_ms=${Date.now() - joinedAt} ${steps}`, {
    call_id: callId,
    ready_ms: Date.now() - joinedAt,
    engine: voiceEngine(tuned.voice_engine),
    voice: joinedVoice,
    role,
  });
}
