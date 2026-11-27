import { stt } from '@livekit/agents';
import logger from '../../utils/logger.js';

const { SpeechEventType } = stt;
export const LONG_SPEECH_MS = 12_000;
export const FINAL_LATE_MS = 3000;
export const LONG_SILENT_SEGMENT_MS = 4000;
export const LATE_PARTIAL_MS = 1000;
export const HOLD_QUIET_MS = 15_000;
const DROP_LOG_MS = 30_000;

export class HearingSwitch extends stt.STT {
  label = 'ravi.HearingSwitch';

  constructor({ primary, makeSpare = null, spareName = 'backup', callId = '' }) {
    super({ streaming: true, interimResults: true, alignedTranscript: false });
    this.primary = primary;
    this.makeSpare = makeSpare;
    this.spareName = spareName;
    this.callId = callId;
    this.spareStt = null;
    this.spareBroken = typeof makeSpare !== 'function';
    this.switched = false;
    this.session = null;
    this.activeStream = null;
    this.callerPresenting = null;
    this.localSpeechTimer = null;
    this.gapUntil = 0;
    this.stats = { lateDropped: 0, lateDroppedWhileRavi: 0, switchReason: '' };
    this.#listen(primary);
  }

  holdQuiet(ms = HOLD_QUIET_MS) {
    const until = Date.now() + ms;
    if (until > this.gapUntil) this.gapUntil = until;
  }

  inHearingGap() {
    return Date.now() < this.gapUntil;
  }

  #listen(child) {
    child.on('metrics_collected', (metrics) => this.emit('metrics_collected', metrics));
    child.on('error', (event) => {
      logger.warn(`Ravi hearing: ${child.label || 'speech-to-text'} error (${event?.error?.message || 'unknown error'})`, { call_id: this.callId });
    });
  }

  get model() {
    return this.switched && this.spareStt ? this.spareStt.model : this.primary.model;
  }

  get provider() {
    return this.switched && this.spareStt ? this.spareStt.provider : this.primary.provider;
  }

  watchSession(session) {
    this.session = session;
  }

  raviSpeaking() {
    return this.session?.agentState === 'speaking';
  }

  locallySpeaking() {
    return Boolean(this.callerPresenting?.());
  }

  noteLocalSpeech() {
    // The local detector no longer switches hearing. A switch closed the OpenAI stream.
  }

  spare() {
    if (this.spareBroken) return null;
    if (this.spareStt) return this.spareStt;
    try {
      this.spareStt = this.makeSpare();
      this.#listen(this.spareStt);
      return this.spareStt;
    } catch (error) {
      this.spareBroken = true;
      logger.warn(`Ravi hearing: spare speech-to-text ${this.spareName} could not start (${error?.message || 'unknown error'})`, { call_id: this.callId });
      return null;
    }
  }

  prewarm() {
    this.primary.prewarm?.();
    if (this.warming) return;
    this.warming = true;
    try {
      const stream = this.primary.stream();
      const timer = setTimeout(() => {
        try { stream.close(); } catch { /* already closed */ }
        this.warming = false;
      }, 2000);
      timer.unref?.();
      logger.info('Ravi is opening speech-to-text early', { call_id: this.callId });
    } catch (error) {
      this.warming = false;
      logger.warn(`Ravi could not pre-open speech-to-text (${error?.message || 'unknown error'})`, { call_id: this.callId });
    }
  }

  async _recognize() {
    throw new Error('Ravi hearing only streams');
  }

  stream(options = {}) {
    const stream = new HearingStream(this, options.connOptions);
    this.activeStream = stream;
    return stream;
  }

  async close() {
    await Promise.allSettled([this.primary.close?.(), this.spareStt?.close?.()]);
  }
}

class HearingStream extends stt.SpeechStream {
  label = 'ravi.HearingStream';

  constructor(owner, connOptions) {
    super(owner, undefined, connOptions);
    this.owner = owner;
    this.child = null;
    this.which = 'primary';
    this.ending = false;
    this.speaking = false;
    this.speechAt = 0;
    this.endAt = 0;
    this.textSinceStart = false;
    this.strikes = 0;
    this.primaryRestarts = 0;
    this.longTimer = null;
    this.finalTimer = null;
    this.recoverTimer = null;
    this.lastDropLogAt = 0;
  }

  async monitorMetrics() {
    for await (const event of this.queue) {
      if (this.output.closed) continue;
      try {
        this.output.put(event);
      } catch {
        continue;
      }
    }
    if (!this.output.closed) this.output.close();
  }

  put(event) {
    if (this.queue.closed) return;
    try {
      this.queue.put(event);
    } catch {
      return;
    }
  }

  open(which) {
    const owner = this.owner;
    const source = which === 'primary' ? owner.primary : owner.spare();
    if (!source) return false;
    let child;
    try {
      child = source.stream({ connOptions: this._connOptions });
    } catch (error) {
      logger.warn(`Ravi hearing: ${which} speech-to-text stream failed to open (${error?.message || 'unknown error'})`, { call_id: owner.callId });
      if (which === 'backup') owner.spareBroken = true;
      return false;
    }
    this.child = child;
    this.which = which;
    this.done = this.consume(child, which);
    return true;
  }

  async consume(child, which) {
    try {
      for await (const event of child) {
        if (this.child !== child) break;
        if (this.observe(event)) this.put(event);
      }
    } catch (error) {
      if (this.child === child) logger.warn(`Ravi hearing: ${which} speech-to-text stopped (${error?.message || 'unknown error'})`, { call_id: this.owner.callId });
    }
    if (this.child !== child || this.ending || this.abortSignal.aborted) return;
    this.recover(which);
  }

  recover(which) {
    const owner = this.owner;
    owner.holdQuiet();
    if (which === 'primary' && !owner.spareBroken && this.switchTo('backup', 'OpenAI speech-to-text stopped')) return;
    if (which === 'backup') {
      owner.spareBroken = true;
      logger.warn(`Ravi hearing: ${owner.spareName} stopped, going back to OpenAI speech-to-text`, { call_id: owner.callId });
    }
    this.primaryRestarts += 1;
    this.endSpeech();
    const reopen = () => {
      this.recoverTimer = null;
      if (this.ending || this.abortSignal?.aborted) return;
      if (this.open('primary')) return;
      this.recoverTimer = setTimeout(reopen, 2000);
      this.recoverTimer.unref?.();
    };
    clearTimeout(this.recoverTimer);
    if (this.primaryRestarts > 3) {
      if (this.primaryRestarts === 4 || Date.now() - this.lastDropLogAt >= DROP_LOG_MS) {
        this.lastDropLogAt = Date.now();
        logger.warn(`Ravi hearing: OpenAI dropped ${this.primaryRestarts} times, listening again in 2 s`, { call_id: owner.callId });
      }
      this.recoverTimer = setTimeout(reopen, 2000);
      this.recoverTimer.unref?.();
      return;
    }
    reopen();
  }

  endSpeech() {
    if (!this.speaking) return;
    this.speaking = false;
    this.put({ type: SpeechEventType.END_OF_SPEECH });
  }

  switchTo(which, reason) {
    const owner = this.owner;
    if (which === 'backup' && (this.which === 'backup' || owner.switched || owner.spareBroken)) return false;
    const old = this.child;
    const wasSpeaking = this.speaking;
    if (!this.open(which)) return false;
    owner.switched = which === 'backup';
    owner.stats.switchReason = reason;
    owner.holdQuiet();
    clearTimeout(this.longTimer);
    clearTimeout(this.finalTimer);
    if (wasSpeaking) this.endSpeech();
    this.endAt = 0;
    try {
      old?.close();
    } catch {
    }
    logger.warn(`Ravi hearing: switched speech-to-text to ${owner.spareName} for the rest of the call (${reason})`, { call_id: owner.callId });
    return true;
  }

  observe(event) {
    const now = Date.now();
    const type = event?.type;
    if (this.owner.callerPresenting && this.owner.raviSpeaking() && !this.owner.locallySpeaking()) {
      if (type === SpeechEventType.START_OF_SPEECH || type === SpeechEventType.INTERIM_TRANSCRIPT) {
        this.owner.stats.lateDropped += 1;
        this.owner.stats.lateDroppedWhileRavi += 1;
        return false;
      }
    }
    if (type === SpeechEventType.START_OF_SPEECH) {
      this.speaking = true;
      this.speechAt = now;
      this.textSinceStart = false;
      clearTimeout(this.longTimer);
      if (this.which === 'primary') {
        this.longTimer = setTimeout(() => {
          if (this.speaking && !this.textSinceStart) {
            logger.warn(`Ravi hearing: caller spoke ${Math.round(LONG_SPEECH_MS / 1000)} s with no text, keeping OpenAI`, { call_id: this.owner.callId });
          }
        }, LONG_SPEECH_MS);
        this.longTimer.unref?.();
      }
      return true;
    }
    if (type === SpeechEventType.END_OF_SPEECH) {
      const spokeMs = this.speechAt ? now - this.speechAt : 0;
      this.speaking = false;
      this.endAt = now;
      clearTimeout(this.longTimer);
      clearTimeout(this.finalTimer);
      if (this.which === 'primary') {
        const stoppedAt = now;
        this.finalTimer = setTimeout(() => {
          if (this.endAt !== stoppedAt) return;
          this.strikes += 1;
          if (spokeMs >= LONG_SILENT_SEGMENT_MS || this.strikes >= 2) {
            logger.warn(`Ravi hearing: no text ${FINAL_LATE_MS / 1000} s after ${spokeMs} ms of speech, keeping OpenAI`, { call_id: this.owner.callId });
          }
        }, FINAL_LATE_MS);
        this.finalTimer.unref?.();
      }
      return true;
    }
    if (type === SpeechEventType.INTERIM_TRANSCRIPT) {
      this.textSinceStart = true;
      this.primaryRestarts = 0;
      clearTimeout(this.owner.localSpeechTimer);
      this.owner.localSpeechTimer = null;
      if (!this.speaking && this.endAt && now - this.endAt > LATE_PARTIAL_MS) {
        this.owner.stats.lateDropped += 1;
        if (this.owner.raviSpeaking()) this.owner.stats.lateDroppedWhileRavi += 1;
        return false;
      }
      return true;
    }
    if (type === SpeechEventType.FINAL_TRANSCRIPT) {
      this.textSinceStart = true;
      this.primaryRestarts = 0;
      clearTimeout(this.owner.localSpeechTimer);
      this.owner.localSpeechTimer = null;
      clearTimeout(this.finalTimer);
      const late = !this.speaking && this.endAt ? now - this.endAt : 0;
      this.endAt = 0;
      if (this.which === 'primary' && late > FINAL_LATE_MS) {
        logger.warn(`Ravi hearing: final text arrived ${late} ms after the caller stopped, keeping OpenAI`, { call_id: this.owner.callId });
      }
      return true;
    }
    return true;
  }

  async run() {
    const owner = this.owner;
    if (!(owner.switched && !owner.spareBroken && this.open('backup'))) this.open('primary');
    for await (const item of this.input) {
      if (this.abortSignal.aborted) break;
      const child = this.child;
      if (!child) continue;
      try {
        if (typeof item === 'symbol') child.flush();
        else child.pushFrame(item);
      } catch {
        continue;
      }
    }
    this.ending = true;
    clearTimeout(this.longTimer);
    clearTimeout(this.finalTimer);
    clearTimeout(this.recoverTimer);
    try {
      this.child?.endInput();
    } catch {
    }
    await this.done;
  }

  close() {
    this.ending = true;
    clearTimeout(this.longTimer);
    clearTimeout(this.finalTimer);
    clearTimeout(this.recoverTimer);
    try {
      this.child?.close();
    } catch {
    }
    super.close();
  }
}
