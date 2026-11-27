import { callLanguageNote, languageCue } from '../../services/proChat/callLanguage.js';
import { callLanguagePriceNote, declinedPlansNote, liveSalesInstructions, pitchedPlanNote } from '../../services/proChat/voiceSalesBrief.js';
import { elevenLabsCanSay, RaviVoice } from '../raviVoiceTts.js';
import logger from '../../utils/logger.js';

export function attachCallBrief(c) {
  const { session, callId, mode, role, caller, settings } = c;
  c.voiceCan = (code) => {
    if (session.tts instanceof RaviVoice) return elevenLabsCanSay(code);
    return session.tts ? code === 'en' : true;
  };
  c.languageNow = () => languageCue(c.callLanguage, mode, c.voiceCan);
  c.switchVoice = (code) => {
    if (!(session.tts instanceof RaviVoice) || code === c.voiceLanguage) return;
    try {
      session.tts.speakLanguage(code);
      c.voiceLanguage = code;
      if (c.debugOn) logger.info(`Ravi voice language ${code} model=${session.tts.model}`, { call_id: callId });
    } catch (error) {
      logger.warn('Ravi voice language change failed', { call_id: callId, language: code, message: error?.message });
    }
  };
  c.instructionsFor = () => liveSalesInstructions({ role, caller, settings });
  c.baseInstructions = c.instructionsFor();
  c.stateNote = '';
  c.refreshCallState = () => {
    const notes = [
      c.callLanguage !== 'en' ? callLanguageNote(c.callLanguage, mode, c.voiceCan) : '',
      callLanguagePriceNote(role, c.callLanguage),
      c.declines ? declinedPlansNote(c.declines) : c.pitched ? pitchedPlanNote() : '',
    ].filter(Boolean);
    c.stateNote = notes.join(' ');
  };
  c.noteDecline = () => {
    if (c.lastDeclineTurn === c.callerTurn) return;
    c.lastDeclineTurn = c.callerTurn;
    c.declines += 1;
    c.instructionsStale = true;
  };
}
