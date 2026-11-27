import { monitorEventLoopDelay } from 'node:perf_hooks';
import logger from '../../utils/logger.js';

const STALL_LOG_MS = 500;
const STALL_TICK_MS = 200;

/** One line per answer: total is what the caller waited, from their last word to Ravi's voice. */
export function answerTiming(turn, sum = 0) {
  return {
    heard_ms: turn.end_of_turn_ms || 0,
    model_first_ms: turn.llm_first_token_ms ?? turn.realtime_first_token_ms ?? 0,
    voice_first_ms: turn.tts_first_audio_ms || 0,
    total_ms: turn.heard_to_voice_ms || sum,
  };
}

export function trackTurnLatency(session, callId) {
  const turns = new Map();
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let doing = 'joining';
  let doingAt = Date.now();
  let worstStall = { ms: 0, doing: '' };
  const note = (label) => {
    doing = label;
    doingAt = Date.now();
  };
  let tickAt = Date.now();
  const stallTimer = setInterval(() => {
    const now = Date.now();
    const stall = now - tickAt - STALL_TICK_MS;
    tickAt = now;
    if (stall < STALL_LOG_MS) return;
    const usage = process.memoryUsage();
    const during = `${doing} (${Math.max(0, now - stall - doingAt)} ms after it started)`;
    if (stall > worstStall.ms) worstStall = { ms: stall, doing };
    logger.warn(`Ravi worker stall ms=${stall} while=${during} ravi=${session.agentState || ''} caller=${session.userState || ''} rss_mb=${Math.round(usage.rss / 1048576)} heap_mb=${Math.round(usage.heapUsed / 1048576)}`, { call_id: callId });
  }, STALL_TICK_MS);
  stallTimer.unref?.();
  session.on('close', () => {
    loop.disable();
    clearInterval(stallTimer);
  });
  // The caller's wait as they hear it: from the end of their speech to the
  // start of Ravi's voice. The parts above do not include the wait for the
  // model's first full sentence, so this is the number to judge by.
  let callerStoppedAt = 0;
  let heardToVoice = 0;
  session.on('user_state_changed', (event) => {
    if (event?.newState === 'listening' && event?.oldState === 'speaking') callerStoppedAt = Date.now();
    else if (event?.newState === 'speaking' || event?.newState === 'away') callerStoppedAt = 0;
  });
  session.on('agent_state_changed', (event) => {
    if (event?.newState !== 'speaking' || !callerStoppedAt) return;
    heardToVoice = Date.now() - callerStoppedAt;
    callerStoppedAt = 0;
  });
  session.on('agent_state_changed', (event) => note(`ravi ${event?.newState || ''}`));
  session.on('user_state_changed', (event) => note(`caller ${event?.newState || ''}`));
  session.on('user_input_transcribed', (event) => note(event?.isFinal ? 'caller final transcript' : 'caller interim transcript'));
  session.on('conversation_item_added', () => note('saving a transcript line'));
  session.on('metrics_collected', (event) => note(`metrics ${event?.metrics?.type || ''}`));
  session.on('metrics_collected', (event) => {
    const m = event?.metrics;
    if (!m?.speechId) return;
    const turn = turns.get(m.speechId) || {};
    if (m.type === 'eou_metrics') {
      turn.end_of_turn_ms = Math.round(m.endOfUtteranceDelayMs);
      turn.transcript_ms = Math.round(m.transcriptionDelayMs);
    }
    if (m.type === 'llm_metrics') {
      turn.llm_first_token_ms = Math.round(m.ttftMs);
      turn.reply_via = m.label === 'inference.LLM' ? 'livekit' : m.label === 'openai.LLM' ? 'openai' : m.label || '';
      turn.reply_model = m.metadata?.modelName || '';
      turn.prompt_tokens = m.promptTokens || 0;
      turn.cached_tokens = m.promptCachedTokens || 0;
    }
    if (m.type === 'realtime_model_metrics') turn.realtime_first_token_ms = Math.round(m.ttftMs);
    if (m.type === 'tts_metrics') turn.tts_first_audio_ms = Math.round(m.ttfbMs);
    const done = m.type === 'tts_metrics' || m.type === 'realtime_model_metrics';
    if (done) {
      turns.delete(m.speechId);
      const total = (turn.end_of_turn_ms || 0) + (turn.llm_first_token_ms || turn.realtime_first_token_ms || 0) + (turn.tts_first_audio_ms || 0);
      if (heardToVoice && turn.llm_first_token_ms !== undefined) {
        turn.heard_to_voice_ms = heardToVoice;
        turn.first_sentence_ms = Math.max(0, heardToVoice - total);
      }
      heardToVoice = 0;
      turn.busy_max_ms = Math.round(loop.max / 1e6);
      if (turn.busy_max_ms > STALL_LOG_MS && worstStall.doing) turn.busy_while = `"${worstStall.doing}"`;
      worstStall = { ms: 0, doing: '' };
      loop.reset();
      const parts = Object.entries(turn).map(([key, value]) => `${key}=${value}`).join(' ');
      logger.info(`Ravi turn latency total_ms=${total} ${parts}`, { call_id: callId, ...turn, total_ms: total });
      const answer = answerTiming(turn, total);
      logger.info(`Ravi answer timing heard_ms=${answer.heard_ms} model_first_ms=${answer.model_first_ms} voice_first_ms=${answer.voice_first_ms} total_ms=${answer.total_ms}`, { call_id: callId, ...answer });
      return;
    }
    turns.set(m.speechId, turn);
    if (turns.size > 20) turns.delete(turns.keys().next().value);
  });
  return note;
}
