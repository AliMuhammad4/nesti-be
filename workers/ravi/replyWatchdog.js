import logger from '../../utils/logger.js';
import { text } from './text.js';

export const REPLY_WAIT_MS = 5000;
const CHECK_MS = 1000;
const MAX_FORCED = 3;
const ARM_AFTER_MS = 4000;

function lastUserText(session) {
  const items = session.history?.items || session.chatCtx?.items || [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.type && item.type !== 'message') continue;
    if (item?.role === 'assistant') return '';
    if (item?.role === 'user') return text(item.textContent || '');
  }
  return '';
}

export function watchReplies(c) {
  const { session, callId } = c;
  let pending = [];
  let pendingAt = 0;
  let timer = null;
  let forced = 0;
  const clear = () => {
    pending = [];
    pendingAt = 0;
    clearTimeout(timer);
    timer = null;
  };
  const check = () => {
    timer = null;
    if (!pending.length || c.closing || c.closed || c.callerEnding || c.callDeclined) return clear();
    if (c.skippedTurnAt && c.skippedTurnAt >= pendingAt) return clear();
    const quietFrom = Math.max(pendingAt, c.callerDoneAt || 0);
    const waited = Date.now() - quietFrom;
    const talking = session.userState === 'speaking' && (!c.heard?.current || (c.heard.current.partials || 0) > 0);
    if (talking || session.agentState !== 'listening' || waited < REPLY_WAIT_MS - 50) {
      timer = setTimeout(check, Math.max(CHECK_MS, REPLY_WAIT_MS - waited));
      timer.unref?.();
      return;
    }
    const said = text(pending.join(' '));
    clear();
    if (forced >= MAX_FORCED) {
      logger.warn(`Ravi had the caller's words for ${Math.round(waited / 1000)} s with no reply, not forcing again (limit ${MAX_FORCED})`, { call_id: callId });
      return;
    }
    forced += 1;
    const inChat = lastUserText(session).endsWith(text(said.split(/\s+/).slice(-4).join(' ')));
    logger.warn(`Ravi had the caller's words for ${Math.round(waited / 1000)} s with no reply, replying now (${inChat ? 'turn was saved' : 'turn was not saved'})`, { call_id: callId });
    try {
      session.generateReply(inChat ? {} : { userInput: said });
    } catch (error) {
      logger.warn(`Ravi forced reply failed (${error?.message || 'unknown error'})`, { call_id: callId });
    }
  };
  const arm = () => {
    if (!c.lastCallerText || Date.now() - c.lastCallerAt > ARM_AFTER_MS) return;
    if (!pending.length) pending.push(c.lastCallerText);
    pendingAt = c.lastCallerAt;
    clearTimeout(timer);
    timer = setTimeout(check, REPLY_WAIT_MS);
    timer.unref?.();
  };
  session.on('user_input_transcribed', (event) => {
    if (!event?.isFinal) return;
    if (c.lastCallerAt < Date.now() - 50 || text(event.transcript) !== c.lastCallerText) return;
    arm();
  });
  session.on('user_state_changed', (event) => {
    if (event?.oldState !== 'speaking' || event?.newState === 'speaking') return;
    if (session.agentState !== 'listening') return;
    arm();
  });
  session.on('agent_state_changed', (event) => {
    if (event?.newState === 'speaking' || event?.newState === 'thinking') clear();
  });
  session.on('close', clear);
}
