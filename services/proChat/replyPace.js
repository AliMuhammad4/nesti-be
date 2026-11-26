export const RETRY_MS = 0;
// No filler. "Right." at 2.2 s (the 20:55 call) spoke before the real answer
// and sounded like a second reply.
export const FILLER_MS = 0;
const MAX_RETRIES = 2;
const RETRY_EVERY = 3;
const FILLER_EVERY = 4;
const FILLER_MAX = 2;
const RECHECK_MS = 200;

const FILLERS = {
  en: ['Right.', 'Okay.'],
  ur: ['جی۔', 'اچھا۔'],
  hi: ['जी।', 'अच्छा।'],
  pa: ['جی۔', 'اچھا۔'],
  fr: ['D\'accord.', 'Oui.'],
  es: ['Claro.', 'Vale.'],
  ta: ['சரி.', 'ஆம்.'],
};

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function createReplyPace(languageNow = () => 'en') {
  let replies = 0;
  let fillersUsed = 0;
  let fillerAt = -Infinity;
  let pending = '';
  let retries = 0;
  let retryAt = -Infinity;
  return {
    takeFiller() {
      if (pending || fillersUsed >= FILLER_MAX || replies - fillerAt < FILLER_EVERY) return '';
      const code = String(languageNow() || 'en');
      const lines = FILLERS[code] || FILLERS[code.split('-')[0]];
      if (!lines) return '';
      pending = lines[fillersUsed % lines.length];
      return pending;
    },
    // The filler this reply starts with, if any (before spoke() clears it).
    fillerIn(textContent) {
      return pending && clean(textContent).startsWith(clean(pending)) ? pending : '';
    },
    releaseFiller(line) {
      if (pending && pending === line) pending = '';
    },
    canRetry() {
      return retries < MAX_RETRIES && replies - retryAt >= RETRY_EVERY;
    },
    noteRetry() {
      retries += 1;
      retryAt = replies;
    },
    spoke(textContent, interrupted = false) {
      replies += 1;
      if (!pending) return;
      if (!interrupted && clean(textContent).startsWith(clean(pending))) {
        fillersUsed += 1;
        fillerAt = replies;
      }
      pending = '';
    },
  };
}

const TIMEOUT = Symbol('timeout');

export function pacedReply(openStream, { retryMs = RETRY_MS, fillerMs = FILLER_MS, pace = null, canFill = () => true, onEvent = null } = {}) {
  let reader = null;
  let cancelled = false;
  let finished = false;
  let fillerTimer = null;
  let retryTimer = null;
  let filler = '';
  const stopTimers = () => {
    clearTimeout(fillerTimer);
    clearTimeout(retryTimer);
  };
  const open = async () => {
    const stream = await openStream();
    return stream ? stream.getReader() : null;
  };
  return new ReadableStream({
    start(controller) {
      const startedAt = Date.now();
      let gotFirst = false;
      const safe = (fn) => {
        try {
          fn();
        } catch {
          // Stream already closed (reply cancelled).
        }
      };
      const end = () => {
        finished = true;
        stopTimers();
        safe(() => controller.close());
      };
      const tryFiller = () => {
        if (gotFirst || cancelled || finished || filler) return;
        if (!canFill()) {
          fillerTimer = setTimeout(tryFiller, RECHECK_MS);
          fillerTimer.unref?.();
          return;
        }
        const line = pace?.takeFiller() || '';
        if (!line) return;
        filler = line;
        safe(() => controller.enqueue(`${line} `));
        onEvent?.('filler', Date.now() - startedAt, line);
      };
      const run = async () => {
        reader = await open();
        if (!reader || cancelled) {
          end();
          return;
        }
        if (pace && fillerMs > 0) {
          fillerTimer = setTimeout(tryFiller, fillerMs);
          fillerTimer.unref?.();
        }
        let first = reader.read();
        if (retryMs > 0 && pace?.canRetry()) {
          const waited = new Promise((resolve) => {
            retryTimer = setTimeout(() => resolve(TIMEOUT), retryMs);
            retryTimer.unref?.();
          });
          const result = await Promise.race([first, waited]);
          clearTimeout(retryTimer);
          if (result === TIMEOUT && !cancelled) {
            pace.noteRetry();
            onEvent?.('retry', Date.now() - startedAt);
            first.catch(() => {});
            // Aborts the slow request (closes its HTTP stream).
            reader.cancel().catch(() => {});
            reader = await open();
            if (!reader || cancelled) {
              end();
              return;
            }
            first = reader.read();
          } else if (result !== TIMEOUT) {
            first = Promise.resolve(result);
          }
        }
        let chunk = await first;
        gotFirst = true;
        clearTimeout(fillerTimer);
        while (!chunk.done && !cancelled) {
          safe(() => controller.enqueue(chunk.value));
          chunk = await reader.read();
        }
        end();
      };
      run().catch((error) => {
        finished = true;
        stopTimers();
        if (filler) pace?.releaseFiller(filler);
        if (!cancelled) safe(() => controller.error(error));
      });
    },
    cancel() {
      cancelled = true;
      stopTimers();
      if (filler && !finished) pace?.releaseFiller(filler);
      reader?.cancel().catch(() => {});
    },
  });
}

// The reply text with a leading filler line removed.
export function withoutFiller(textContent, filler) {
  const said = String(textContent || '');
  const line = clean(filler);
  if (!line) return said;
  const trimmed = said.replace(/^\s+/, '');
  return trimmed.startsWith(line) ? trimmed.slice(line.length).replace(/^\s+/, '') : said;
}
