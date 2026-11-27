// Ravi's reply model, raced across two routes.
//
// LiveKit Inference (primary) is usually the faster start from Lahore, but in
// the 2:36 AM call on Nov 24 2026 it gave nothing for 4 s on 2 of 3 turns, and
// LiveKit's FallbackAdapter only moved to OpenAI after that full wait (6.6 s
// to the first word). It also sent the whole conversation again in the
// background to test whether LiveKit was back, and flipped back on the next
// turn. Here:
// - LiveKit starts first. On the first answer of the call, OpenAI starts at
//   the same time (the 17:57 call: 2215 tokens, nothing cached, 4.0 s). After
//   that, OpenAI starts if LiveKit has no word in HEDGE_MS. Whichever speaks
//   first is used; the other is cancelled. skipHedgeOnce() does not start
//   that second request for one reply (the language-switch turn). OpenAI
//   still starts if LiveKit fails or returns no word.
// - After LiveKit fails, or loses once, it is retired for the rest of the
//   call. Later replies use OpenAI only, with no background test requests
//   and no return to LiveKit.
// - If both fail (the 3:02 AM internet drop on Nov 24: LiveKit, OpenAI and
//   ElevenLabs all lost their connections), there is no retry: 'reply_failed'
//   is emitted with each route's reason so the call can say a short line
//   right away, and each route's reason is logged.
// - Metrics carry the route that actually answered (inference.LLM or
//   openai.LLM) and its model, for the "Ravi turn latency" log line.
import { APIConnectionError, llm } from '@livekit/agents';

export const HEDGE_MS = 1800;
export const PAUSE_MS = 3 * 60_000;
export const SLOW_SKIP_TURNS = 3;
const PRIMARY_TIMEOUT_MS = 6000;
// Was 10 s; with LiveKit already given 1.8-6 s, 6 s more is the limit.
const BACKUP_TIMEOUT_MS = 6000;
// Used only when the caller passes none (AgentSession always passes its own).
const DEFAULT_CONN_OPTIONS = { maxRetry: 1, timeoutMs: BACKUP_TIMEOUT_MS, retryIntervalMs: 500 };

export class ReplyRace extends llm.LLM {
  constructor({ primary, backup, hedgeMs = HEDGE_MS, pauseMs = PAUSE_MS, slowSkipTurns = SLOW_SKIP_TURNS, onEvent = () => {} }) {
    super();
    this.primary = primary;
    this.backup = backup;
    this.hedgeMs = hedgeMs;
    this.baseHedgeMs = hedgeMs;
    this.pauseMs = pauseMs;
    this.onEvent = onEvent;
    this.pausedUntil = 0;
    this.retired = false;
    this.slowSkipTurns = slowSkipTurns;
    this.skipTurns = 0;
    this.misses = 0;
    this.skipNextHedge = false;
    this.coldStart = true;
    this._hedges = new Set();
    this.routes = new Map();
    this.lastError = new Map();
    // A child with no 'error' listener would throw from inside its stream.
    // The last error per route is kept as the reason it failed.
    for (const child of [primary, backup]) {
      child.on('error', (event) => this.lastError.set(child, failureReason(event?.error)));
    }
  }

  get model() {
    return this.primary.model;
  }

  get provider() {
    return this.primary.provider;
  }

  label() {
    return 'ravi.reply';
  }

  chat(opts) {
    return new ReplyRaceStream(this, opts);
  }

  prewarm() {
    this.primary.prewarm?.();
    this.backup.prewarm?.();
  }

  async aclose() {
    await Promise.allSettled([this.primary.aclose(), this.backup.aclose()]);
  }

  // Swap our own label for the route that answered, so the turn log shows it.
  emit(name, value, ...rest) {
    if (name === 'metrics_collected' && value?.label === 'ravi.reply') {
      const route = this.routes.get(value.requestId);
      if (route) {
        this.routes.delete(value.requestId);
        value = { ...value, label: route.label, metadata: { ...(value.metadata || {}), modelName: route.model } };
      }
    }
    return super.emit(name, value, ...rest);
  }

  skipHedgeOnce() {
    this.skipNextHedge = true;
    for (const handle of this._hedges) handle.hold();
  }

  resetHedgeSkip() {
    this.skipNextHedge = false;
  }

  /** @internal */
  _armHedge(ms) {
    if (this.skipNextHedge) {
      this.skipNextHedge = false;
      return null;
    }
    let timer;
    let fire;
    const hedge = new Promise((resolve) => {
      fire = resolve;
      timer = setTimeout(() => resolve('hedge'), ms);
    });
    const handle = {
      hedge,
      hold: () => {
        clearTimeout(timer);
        this._hedges.delete(handle);
        fire('hold');
      },
      clear: () => {
        clearTimeout(timer);
        this._hedges.delete(handle);
      },
    };
    this._hedges.add(handle);
    return handle;
  }

  /** @internal */
  _primaryUsable() {
    if (this.retired || Date.now() < this.pausedUntil) return false;
    if (this.skipTurns > 0) {
      this.skipTurns -= 1;
      if (!this.skipTurns) this.onEvent({ type: 'primary_back' });
      return false;
    }
    return true;
  }

  /** @internal */
  _reasonFor(child, fallback) {
    return this.lastError.get(child) || fallback;
  }

  /** @internal */
  _primaryResult(outcome, detail = '', elapsedMs = 0) {
    if (this.retired) return;
    if (outcome === 'won') {
      this.misses = 0;
      this.pausedUntil = 0;
      // A slow win (the 20:53 reply, 2.0 s) used to keep the 1.8 s wait on
      // the next turns. Start the backup immediately until LiveKit is quick.
      this.hedgeMs = elapsedMs > 1500 ? 0 : this.baseHedgeMs;
      return;
    }
    this.misses = 0;
    if (outcome === 'slow' && this.slowSkipTurns > 0) {
      this.skipTurns = this.slowSkipTurns;
      this.onEvent({ type: 'primary_paused', reason: outcome, detail, turns: this.skipTurns });
      return;
    }
    this.retired = true;
    this.pausedUntil = Infinity;
    this.onEvent({ type: 'primary_paused', reason: outcome, detail, pauseMs: this.pauseMs });
  }
}

export function failureReason(error) {
  if (!error) return 'no reply';
  const status = Number(error.statusCode ?? error.status);
  const name = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
  const message = String(error.message || error).replace(/\s+/g, ' ').slice(0, 160);
  return `${name}${message}${status > 0 ? ` (HTTP ${status})` : ''}`;
}

class ReplyRaceStream extends llm.LLMStream {
  #race;
  #opts;
  #contenders = [];

  constructor(race, opts) {
    super(race, { chatCtx: opts.chatCtx, toolCtx: opts.toolCtx, connOptions: opts.connOptions || DEFAULT_CONN_OPTIONS });
    this.#race = race;
    this.#opts = opts;
    this.abortController.signal.addEventListener('abort', () => {
      for (const c of this.#contenders) c.stream.close();
    });
  }

  #start(which) {
    const race = this.#race;
    const child = which === 'primary' ? race.primary : race.backup;
    const stream = child.chat({
      chatCtx: this.chatCtx,
      toolCtx: this.toolCtx,
      connOptions: { maxRetry: 0, timeoutMs: which === 'primary' ? PRIMARY_TIMEOUT_MS : BACKUP_TIMEOUT_MS, retryIntervalMs: 0 },
      parallelToolCalls: this.#opts.parallelToolCalls,
      toolChoice: this.#opts.toolChoice,
      extraKwargs: this.#opts.extraKwargs,
    });
    const it = stream[Symbol.asyncIterator]();
    race.lastError.delete(child);
    const c = { which, child, stream, it, startedAt: Date.now() };
    c.first = it.next().then((r) => ({ c, r }), (e) => ({ c, e }));
    this.#contenders.push(c);
    return c;
  }

  async #firstGood(list, aborted) {
    const pending = new Map(list.map((c) => [c, c.first]));
    while (pending.size) {
      const res = await Promise.race([...pending.values(), aborted]);
      if (res === 'aborted') return null;
      pending.delete(res.c);
      if (!res.e && !res.r.done) return res;
      this.#failed(res.c, res.e);
    }
    return null;
  }

  #failed(c, error) {
    if (c.failed) return;
    c.failed = true;
    c.reason = this.#race._reasonFor(c.child, error ? failureReason(error) : 'ended with no reply');
    c.failedAfterMs = Date.now() - c.startedAt;
  }

  async run() {
    const race = this.#race;
    const signal = this.abortController.signal;
    const aborted = new Promise((resolve) => {
      if (signal.aborted) resolve('aborted');
      signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    let winner = null;
    let primary = null;
    if (race._primaryUsable()) {
      const opening = race.coldStart;
      race.coldStart = false;
      const wait = opening ? 0 : race.hedgeMs;
      primary = this.#start('primary');
      const armed = race._armHedge(wait);
      let early = armed
        ? await Promise.race([primary.first, armed.hedge, aborted])
        : await Promise.race([primary.first, aborted]);
      armed?.clear();
      if (early === 'aborted') return;
      if (early === 'hold') {
        early = await Promise.race([primary.first, aborted]);
        if (early === 'aborted') return;
      }
      if (early !== 'hedge') {
        if (!early.e && !early.r.done) winner = early;
        else this.#failed(primary, early.e);
      }
      if (!winner) {
        if (early === 'hedge') race.onEvent({ type: 'hedge_started', afterMs: wait });
        const backup = this.#start('backup');
        winner = await this.#firstGood(primary.failed ? [backup] : [primary, backup], aborted);
      }
    } else {
      race.skipNextHedge = false;
      winner = await this.#firstGood([this.#start('backup')], aborted);
    }
    if (signal.aborted) return;
    for (const c of this.#contenders) if (c !== winner?.c) c.stream.close();
    if (primary) {
      const elapsed = Date.now() - primary.startedAt;
      if (winner?.c === primary) race._primaryResult('won', '', elapsed);
      else race._primaryResult(primary.failed ? 'failed' : 'slow', primary.failed ? `${primary.reason} after ${primary.failedAfterMs} ms` : '');
    }
    if (!winner) {
      const routes = this.#contenders.map((c) => ({
        route: c.which === 'primary' ? 'livekit' : 'openai',
        model: c.child.model,
        reason: c.reason || 'cancelled',
        afterMs: c.failedAfterMs ?? Date.now() - c.startedAt,
      }));
      race.onEvent({ type: 'both_failed', routes });
      race.emit('reply_failed', { routes });
      // No retry: the caller hears a short line and says it again.
      throw new APIConnectionError({ message: 'Ravi reply: LiveKit Inference and OpenAI both failed', options: { retryable: false } });
    }
    const { c, r } = winner;
    race.routes.set(r.value.id, { label: c.child.label(), model: c.child.model });
    if (race.routes.size > 50) race.routes.delete(race.routes.keys().next().value);
    this.queue.put(r.value);
    for (let next = await c.it.next(); !next.done; next = await c.it.next()) {
      if (signal.aborted) break;
      this.queue.put(next.value);
    }
  }
}
