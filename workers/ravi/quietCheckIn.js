import { silenceSeconds } from '../../services/proChat/voiceSalesBrief.js';
import logger from '../../utils/logger.js';
import { HEARD_GRACE_MS, heardSinceRavi } from './callerHearing.js';
import { goodbyeLine, missedLine, quietLine } from './lines.js';

const SILENCE_HANGUP_MS = 12_000;
export const AFTER_QUESTION_MS = 12_000;

export function waitingOnAnswer(c) {
  return /[?؟]/.test(String(c?.lastRaviText || ''));
}

/** The caller spoke since Ravi's last line, but no final text came back, and Ravi has not asked again yet. */
export function missedCaller(c) {
  const since = c?.heard?.sinceRavi;
  if (!since || since.starts < 1 || since.finals > 0) return false;
  return c.missedAskedAtFinals !== c.heard.allFinals;
}

export function quietDelayMs(c, quietMs) {
  return quietMs + (waitingOnAnswer(c) ? AFTER_QUESTION_MS : 0);
}

export function watchQuiet(c) {
  const { session, callId, tuned } = c;
  const QUIET_MS = silenceSeconds(tuned.silence_seconds) * 1000;
  let aside = null;
  const stopAside = () => {
    const handle = aside;
    aside = null;
    try {
      handle?.interrupt?.();
    } catch {
      // The line already finished.
    }
  };
  const speakAside = (line) => {
    try {
      aside = session.say(line);
    } catch (error) {
      logger.warn(`Ravi could not say the quiet line (${error?.message || 'unknown error'})`, { call_id: callId });
    }
  };
  const callerBusy = () => Boolean(c.callerBusy?.()) || session.userState === 'speaking';
  const lastSound = () => Math.max(c.raviDoneAt, c.callerDoneAt, c.heardAt || 0, c.joinedAt || 0);
  const armQuiet = (ms) => {
    clearTimeout(c.quietTimer);
    c.quietTimer = setTimeout(sayCheckIn, ms);
  };
  const armHangUp = (ms) => {
    clearTimeout(c.silenceTimer);
    c.silenceTimer = setTimeout(endAfterSilence, ms);
  };
  session.on('agent_state_changed', (event) => {
    if (event?.oldState === 'speaking' && event?.newState !== 'speaking') {
      c.raviDoneAt = Date.now();
      c.greeted = true;
      if (event?.newState === 'listening' && !c.nudged && !c.closing && !c.closed) armQuiet(QUIET_MS);
    }
    if (event?.newState === 'thinking') stopAside();
    if (event?.newState === 'speaking' || event?.newState === 'thinking') clearTimeout(c.quietTimer);
  });
  session.on('user_state_changed', (event) => {
    if (event?.oldState !== 'speaking' || event?.newState === 'speaking') return;
    c.callerDoneAt = Date.now();
    if (c.closing || c.closed || c.callerEnding) return;
    if (c.nudged) armHangUp(SILENCE_HANGUP_MS);
    else if (c.greeted && session.agentState === 'listening') armQuiet(QUIET_MS);
  });
  function endAfterSilence() {
    c.silenceTimer = null;
    if (c.closing || c.closed || c.callerEnding) return;
    if (callerBusy() || session.agentState === 'speaking' || session.agentState === 'thinking') {
      armHangUp(HEARD_GRACE_MS);
      return;
    }
    const last = lastSound();
    const quietFor = Date.now() - last;
    if (!last || quietFor < SILENCE_HANGUP_MS - 500) {
      armHangUp(last ? Math.max(1, SILENCE_HANGUP_MS - quietFor) : SILENCE_HANGUP_MS);
      return;
    }
    logger.info('Ravi ended the call after silence', { call_id: callId });
    const goodbye = session.tts ? goodbyeLine(c.callLanguage) : '';
    if (goodbye) {
      speakAside(goodbye);
    } else {
      session.generateReply({
        instructions: `The caller has stayed silent after you checked in. Say one short calm goodbye with no question, then stop. ${c.languageNow()}`,
      });
    }
    c.hangUpAfterSpeech('caller silent');
  }
  // A sentence the hearing lost is not silence, so ask once for it again.
  function askToRepeat(quietFor) {
    if (!missedCaller(c)) return false;
    c.missedAskedAtFinals = c.heard.allFinals;
    const line = session.tts ? missedLine(c.callLanguage) : '';
    if (line) {
      speakAside(line);
    } else {
      session.generateReply({
        instructions: `The caller just spoke but you did not catch the words. In one short sentence say sorry, you missed that, and ask them to say it once more. Do not guess what they said. ${c.languageNow()}`,
      });
    }
    logger.info(`Ravi missed the caller's words, asked them to repeat after ${Math.round(quietFor / 1000)} s${heardSinceRavi(c)}`, { call_id: callId });
    return true;
  }
  c.onMissedWords = () => {
    if (c.closing || c.closed || c.callerEnding || !c.greeted) return;
    if (session.userState === 'speaking' || session.agentState !== 'listening') return;
    if (askToRepeat(Date.now() - lastSound())) clearTimeout(c.quietTimer);
  };
  function sayCheckIn() {
    if (c.closing || c.closed || c.callerEnding || c.nudged || !c.greeted) return;
    if (session.agentState === 'speaking' || session.agentState === 'thinking') return;
    if (callerBusy()) {
      armQuiet(HEARD_GRACE_MS);
      return;
    }
    const last = lastSound();
    const quietFor = Date.now() - last;
    if (askToRepeat(quietFor)) return;
    const wait = quietDelayMs(c, QUIET_MS);
    if (!last || quietFor < wait - 500) {
      armQuiet(last ? Math.max(1, wait - quietFor) : wait);
      return;
    }
    c.nudged = true;
    const line = session.tts ? quietLine(c.callLanguage, c.declines) : '';
    if (line) {
      speakAside(line);
    } else {
      session.generateReply({
        instructions: c.declines
          ? `The caller has said nothing for several seconds; this is silence, not a cut-off sentence. In one short sentence ask if there is anything else you can help with. Do not say "go on" or mention any plan. ${c.languageNow()}`
          : `The caller has said nothing for several seconds; this is silence, not a cut-off sentence. In one short sentence ask if they are still there and what they want to get done. Do not say "go on", restart the pitch, repeat a plan, or introduce yourself. ${c.languageNow()}`,
      });
    }
    logger.info(`Ravi caller went quiet, checked in with ${line ? `a fixed line: "${line}"` : 'a model reply'} after ${Math.round(quietFor / 1000)} s of quiet${heardSinceRavi(c)}`, { call_id: callId });
    armHangUp(SILENCE_HANGUP_MS + 4000);
  }
  session.on('user_state_changed', (event) => {
    if (event?.newState === 'speaking') {
      stopAside();
      clearTimeout(c.silenceTimer);
      clearTimeout(c.quietTimer);
      if (session.tts?.retryFast?.()) logger.info('Ravi voice: trying the ElevenLabs fast model again', { call_id: callId });
    }
    if (c.closing || c.callerEnding) return;
    if (event?.newState !== 'away' || c.nudged) return;
    sayCheckIn();
  });
}
