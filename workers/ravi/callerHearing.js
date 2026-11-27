import logger from '../../utils/logger.js';
import { SPEECH_CAP_MS } from './callerPresence.js';

const PARTIAL_LOG_MS = 5000;
const NO_TEXT_WAIT_MS = 8000;
const WAITING_MAX_MS = 10_000;
// Shorter sounds are usually a cough or a click, not a lost sentence.
const MISSED_MIN_SPEECH_MS = 800;
export const HEARD_GRACE_MS = 3000;

export function watchCallerHearing(c) {
  const { session, callId } = c;
  const heard = {
    starts: 0,
    allPartials: 0,
    allFinals: 0,
    whileRavi: 0,
    windowPartials: 0,
    current: null,
    waiting: [],
    sinceRavi: { starts: 0, partials: 0, finals: 0, whileRavi: 0 },
  };
  let partialTimer = null;
  const noTextTimers = new Set();
  c.heard = heard;
  c.heardAt = 0;
  c.callerBusy = () => {
    if (c.callerPresent && c.speechStartedAt && Date.now() - c.speechStartedAt >= SPEECH_CAP_MS) {
      c.callerPresent = false;
      c.speechStartedAt = 0;
    }
    return session.userState === 'speaking' || Boolean(c.callerPresent) || Date.now() - (c.heardAt || 0) < HEARD_GRACE_MS || Date.now() - (c.presentAt || 0) < HEARD_GRACE_MS || Boolean(session.stt?.inHearingGap?.());
  };
  const flushPartials = () => {
    partialTimer = null;
    if (!heard.windowPartials) return;
    logger.info(`Ravi is receiving the caller's partial transcripts (${heard.windowPartials} in the last ${PARTIAL_LOG_MS / 1000} s)`, { call_id: callId });
    heard.windowPartials = 0;
  };
  const textTarget = () => {
    while (heard.waiting[0] && Date.now() - heard.waiting[0].stopAt > WAITING_MAX_MS) heard.waiting.shift();
    return heard.waiting[0] || heard.current;
  };
  session.on('agent_state_changed', (event) => {
    if (event?.oldState === 'speaking' && event?.newState !== 'speaking') heard.sinceRavi = { starts: 0, partials: 0, finals: 0, whileRavi: 0 };
  });
  session.on('user_state_changed', (event) => {
    if (event?.newState === 'speaking') {
      heard.starts += 1;
      heard.sinceRavi.starts += 1;
      heard.current = { startAt: Date.now(), stopAt: 0, partials: 0, finals: 0, firstPartialMs: -1 };
      c.heardAt = Date.now();
      logger.info(`Ravi heard the caller start speaking (ravi=${session.agentState || ''})`, { call_id: callId });
      return;
    }
    if (event?.oldState !== 'speaking' || !heard.current) return;
    const utterance = heard.current;
    heard.current = null;
    utterance.stopAt = Date.now();
    c.heardAt = utterance.stopAt;
    const spokeMs = utterance.stopAt - utterance.startAt;
    logger.info(`Ravi heard the caller stop speaking after ${spokeMs} ms partials=${utterance.partials} finals=${utterance.finals}`, { call_id: callId });
    if (utterance.finals) return;
    heard.waiting.push(utterance);
    const timer = setTimeout(() => {
      noTextTimers.delete(timer);
      if (utterance.finals || c.closed) return;
      logger.warn(`Ravi heard the caller speak for ${spokeMs} ms but no final transcript arrived within ${NO_TEXT_WAIT_MS / 1000} s (partials=${utterance.partials})`, { call_id: callId });
      if (utterance.partials > 0) return;
      if (spokeMs >= MISSED_MIN_SPEECH_MS && !heard.current) c.onMissedWords?.();
    }, NO_TEXT_WAIT_MS);
    timer.unref?.();
    noTextTimers.add(timer);
  });
  session.on('user_input_transcribed', (event) => {
    const now = Date.now();
    c.heardAt = now;
    const target = textTarget();
    if (event?.isFinal) {
      heard.allFinals += 1;
      heard.sinceRavi.finals += 1;
      if (!target) return;
      target.finals += 1;
      if (heard.waiting[0] === target) heard.waiting.shift();
      const late = target.stopAt ? `${now - target.stopAt} ms after they stopped` : 'while they were still speaking';
      const first = target.firstPartialMs >= 0 ? `${target.firstPartialMs} ms` : 'none';
      logger.info(`Ravi got the caller's final text ${late} (first partial ${first}, partials=${target.partials})`, { call_id: callId });
      return;
    }
    heard.allPartials += 1;
    heard.sinceRavi.partials += 1;
    heard.windowPartials += 1;
    if (session.agentState === 'speaking') {
      heard.whileRavi += 1;
      heard.sinceRavi.whileRavi += 1;
    }
    if (target) {
      if (target.firstPartialMs < 0) target.firstPartialMs = now - (target.stopAt || target.startAt);
      target.partials += 1;
    }
    if (partialTimer) return;
    partialTimer = setTimeout(flushPartials, PARTIAL_LOG_MS);
    partialTimer.unref?.();
  });
  session.on('close', () => {
    clearTimeout(partialTimer);
    for (const timer of noTextTimers) clearTimeout(timer);
    const stats = session.stt?.stats;
    const dropped = stats ? ` late_partials_ignored=${stats.lateDropped} (while Ravi spoke ${stats.lateDroppedWhileRavi})${stats.switchReason ? ` backup_reason="${stats.switchReason}"` : ''}` : '';
    logger.info(`Ravi caller hearing summary speech_starts=${heard.starts} partials=${heard.allPartials} finals=${heard.allFinals} partials_while_ravi_spoke=${heard.whileRavi}${dropped}`, { call_id: callId });
  });
}

export function heardSinceRavi(c) {
  const since = c.heard?.sinceRavi;
  if (!since) return '';
  return ` (since Ravi last spoke: caller speech starts=${since.starts} partials=${since.partials} finals=${since.finals} partials_while_ravi_spoke=${since.whileRavi})`;
}
