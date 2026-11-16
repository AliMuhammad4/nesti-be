export const CALENDLY_HTTP_TIMEOUT_MS = 15_000;

export function calendlyHttpError(message, status = null) {
  const err = new Error(message);
  if (status != null) err.status = Number(status);
  err.transient = status == null || Number(status) === 429 || Number(status) >= 500;
  return err;
}

export function isTransientCalendlyError(err) {
  if (!err) return false;
  if (err.transient === true) return true;
  const name = String(err.name || '');
  return name === 'TimeoutError' || name === 'AbortError';
}

export async function calendlyFetch(url, init = {}, { timeoutMs = CALENDLY_HTTP_TIMEOUT_MS } = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = String(err?.name || '');
    if (name === 'TimeoutError' || name === 'AbortError') {
      const e = calendlyHttpError(`Calendly did not respond within ${Math.round(timeoutMs / 1000)}s`);
      e.timeout = true;
      throw e;
    }
    throw calendlyHttpError(`Calendly request failed: ${err?.message || 'network error'}`);
  }
}

export async function readCalendlyText(res) {
  try {
    return await res.text();
  } catch (err) {
    throw calendlyHttpError(`Calendly response could not be read: ${err?.message || 'network error'}`);
  }
}
