import { persistSalesOutcome } from '../../services/proChat/voiceAgentTurnService.js';
import { callerDeclinesCall, callerWantsToEnd, isClosingLine, isPlanDecline, isPlanPitch } from '../../services/proChat/voiceSalesBrief.js';
import { isPhantomTurn } from '../../services/proChat/callerTurnFilter.js';
import logger from '../../utils/logger.js';
import { declineGoodbyeLine } from './lines.js';
import { dropFiller, rememberLine } from './transcript.js';
import { text } from './text.js';

const CALLER_ENDING_WAIT_MS = 7000;
const CLOSING_QUIET_MS = 3000;

function endAfterGoodbye(c, transcript) {
  const { session, callId } = c;
  const words = text(transcript).split(/\s+/).filter(Boolean).length;
  if (!callerWantsToEnd(transcript, c.lastRaviText) && !(words <= 4 && !/[?؟]/.test(transcript))) return false;
  void rememberLine(callId, 'caller', transcript);
  try {
    Promise.resolve(session.interrupt()?.await).catch(() => {});
  } catch {
  }
  void c.finish('caller done after goodbye');
  return true;
}

function followLanguage(c, transcript) {
  const { session, callId } = c;
  const heard = c.languages.heard(transcript);
  if (heard === c.callLanguage) return;
  c.callLanguage = heard;
  c.switchVoice(heard);
  c.instructionsStale = true;
  c.languageSwitched = true;
  session.llm?.skipHedgeOnce?.();
  logger.info(`Ravi call language ${heard}`, { call_id: callId });
}

function noteCallerEnding(c, transcript) {
  const { session, callId } = c;
  if (!c.callerEnding && callerDeclinesCall(transcript)) {
    c.callDeclined = true;
    logger.info('Ravi caller declined the call, saying goodbye', { call_id: callId });
  }
  if (!c.callerEnding && (c.callDeclined || callerWantsToEnd(transcript, c.lastRaviText))) {
    c.callerEnding = true;
    c.timers.push(setTimeout(() => {
      if (!c.closing && session.agentState !== 'speaking' && session.agentState !== 'thinking') void c.finish('caller ended the call');
    }, CALLER_ENDING_WAIT_MS));
  }
}

function mostlyScript(raw) {
  const letters = String(raw || '').match(/\p{L}/gu) || [];
  if (letters.length < 2) return false;
  const script = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\u0A00-\u0A7F]/;
  const hits = letters.filter((letter) => script.test(letter)).length;
  return hits / letters.length >= 0.6;
}

export function watchCallerTurns(c) {
  const { session, callId } = c;
  session.on('user_input_transcribed', (event) => {
    clearTimeout(c.softTimer);
    if (!event?.isFinal) {
      if (mostlyScript(event?.transcript)) session.tts?.warmScript?.();
      return;
    }
    if (isPhantomTurn(event.transcript, { lastRaviText: c.lastRaviText, lastCallerText: c.lastCallerText, lastCallerAt: c.lastCallerAt })) {
      c.phantomLines.push(text(event.transcript));
      logger.info('Ravi ignored a phantom caller line', { call_id: callId, text: text(event.transcript).slice(0, 80) });
      return;
    }
    clearTimeout(c.silenceTimer);
    clearTimeout(c.quietTimer);
    c.lastCallerText = text(event.transcript);
    c.lastCallerAt = Date.now();
    c.realFinals += 1;
    session.llm?.resetHedgeSkip?.();
    if (c.saidGoodbye && !c.closing && !c.closed && endAfterGoodbye(c, event.transcript)) return;
    c.nudged = false;
    c.callerTurn += 1;
    void rememberLine(callId, 'caller', event.transcript);
    followLanguage(c, event.transcript);
    c.pipeline?.heard(event.transcript);
    if (isPlanDecline(event.transcript, c.lastRaviText)) c.noteDecline();
    noteCallerEnding(c, event.transcript);
  });
}

export function watchRaviLines(c) {
  const { session, callId } = c;
  session.on('conversation_item_added', (event) => {
    const item = event?.item;
    if (item?.role !== 'assistant') return;
    const filler = c.agent?.pace?.fillerIn(item.textContent) || '';
    c.agent?.pace?.spoke(item.textContent, Boolean(item.interrupted));
    if (filler) dropFiller(item, filler);
    c.lastRaviText = text(item.textContent);
    c.spokenChars += c.lastRaviText.length;
    void rememberLine(callId, 'agent', item.textContent);
    c.pipeline?.said(c.lastRaviText);
    if (!c.pitched && isPlanPitch(c.lastRaviText)) {
      c.pitched = true;
      c.pipeline?.notePitch();
      // Save the brief after this reply finishes. Updating it now would
      // cancel the reply that is being written.
      c.instructionsStale = true;
      if (session.agentState === 'listening') {
        c.instructionsStale = false;
        c.refreshCallState();
      }
    }
    if (!c.closing && !c.closed && isClosingLine(c.lastRaviText)) {
      if (c.saidGoodbye || c.callerEnding) {
        c.hangUpAfterSpeech('closing line');
        return;
      }
      c.saidGoodbye = true;
      clearTimeout(c.softTimer);
      c.softTimer = setTimeout(() => {
        if (!c.closing && session.agentState === 'listening' && !c.callerBusy?.()) void c.finish('closing line, caller quiet');
      }, CLOSING_QUIET_MS);
    }
  });
}

function sayDeclineGoodbye(c) {
  const { session, callId } = c;
  const line = session.tts ? declineGoodbyeLine(c.callLanguage) : '';
  if (!line) return false;
  c.realFinals = 0;
  c.phantomLines = [];
  try {
    session.say(line);
  } catch (error) {
    logger.warn(`Ravi could not say the goodbye (${error?.message || 'unknown error'})`, { call_id: callId });
  }
  c.hangUpAfterSpeech('caller declined the call');
  if (!c.outcomeSaved) {
    c.outcomeSaved = true;
    persistSalesOutcome({ callId, outcome: 'declined', note: 'Caller said they did not want anything.' })
      .catch((error) => logger.warn('Ravi decline was not saved', { call_id: callId, message: error?.message }));
  }
  return true;
}

export function turnFilter(c) {
  const skip = (message) => {
    if (c.callDeclined && !c.closing && !c.closed && sayDeclineGoodbye(c)) return true;
    if (!c.filterTurns) return false;
    const phantoms = c.phantomLines;
    c.realFinals = 0;
    c.phantomLines = [];
    const parts = Array.isArray(message?.content) ? message.content : [];
    const said = text(parts.filter((part) => typeof part === 'string').join(' '));
    const kept = text(phantoms.reduce((acc, line) => acc.replace(line, ' '), said));
    if (phantoms.length && parts.length) {
      message.content = parts.map((part) => (typeof part === 'string'
        ? text(phantoms.reduce((acc, line) => acc.replace(line, ' '), part))
        : part));
    }
    if (!kept && (phantoms.length || !said)) {
      logger.info('Ravi skipped a caller turn with only phantom lines', { call_id: c.callId, text: said.slice(0, 80) });
      return true;
    }
    const now = Date.now();
    if (kept && kept === c.lastTurnText && now - c.lastTurnAt < 3000) {
      logger.info('Ravi skipped a repeated caller turn', { call_id: c.callId, text: kept.slice(0, 80) });
      return true;
    }
    c.lastTurnText = kept;
    c.lastTurnAt = now;
    return false;
  };
  return (message) => {
    const skipped = skip(message);
    if (skipped) c.skippedTurnAt = Date.now();
    return skipped;
  };
}
