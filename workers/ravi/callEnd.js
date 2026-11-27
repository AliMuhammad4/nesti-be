import { deleteLiveKitRoom } from '../../services/proChat/liveKitRoomService.js';
import logger from '../../utils/logger.js';

export function attachCallEnd(c) {
  const { ctx, session, callId } = c;
  c.markCall = (value) => {
    ctx.room?.localParticipant?.setAttributes?.({ 'nesti.call': value })?.catch?.(() => {});
  };
  c.quietRoom = () => {
    if (c.roomQuiet) return;
    c.roomQuiet = true;
    try {
      session.output?.setTranscriptionEnabled?.(false);
    } catch {
    }
    const host = session.sessionHost;
    session.sessionHost = undefined;
    Promise.resolve(host?.close?.()).catch(() => {});
  };
  c.finish = async (reason = 'ravi ended the call', mark = 'ended') => {
    if (c.closed) return;
    c.closed = true;
    clearTimeout(c.closeTimer);
    clearTimeout(c.idleTimer);
    clearTimeout(c.softTimer);
    clearTimeout(c.silenceTimer);
    clearTimeout(c.quietTimer);
    logger.info('Ravi ended the call', { call_id: callId, reason });
    c.markCall(mark);
    c.quietRoom();
    await deleteLiveKitRoom(ctx.room?.name).catch(() => false);
    ctx.shutdown(reason);
  };
  c.failVoice = (reason) => {
    if (c.closed || c.voiceFailed) return;
    c.voiceFailed = true;
    logger.error(`Ravi voice: ElevenLabs can't speak (${reason}); ending the call`, { call_id: callId });
    c.markCall('voice_failed');
    c.timers.push(setTimeout(() => void c.finish('voice failed', 'voice_failed'), 1500));
  };
  c.hangUpAfterSpeech = (reason) => {
    if (c.closing || c.closed) return;
    c.closing = true;
    c.markCall('closing');
    clearTimeout(c.softTimer);
    c.closeTimer = setTimeout(() => void c.finish(reason), 9000);
    if (session.agentState === 'listening') c.idleTimer = setTimeout(() => void c.finish(reason), 2500);
  };
}
