import crypto from 'crypto';

export const CALENDLY_SIGNATURE_TOLERANCE_SEC = 5 * 60;

export function verifyCalendlySignature(
  rawBodyString,
  signatureHeader,
  signingKey,
  { toleranceSec = CALENDLY_SIGNATURE_TOLERANCE_SEC, nowMs = Date.now() } = {}
) {
  if (!signingKey || !signatureHeader || rawBodyString == null) return false;
  try {
    const parts = {};
    for (const segment of String(signatureHeader).split(',')) {
      const eq = segment.indexOf('=');
      if (eq !== -1) parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
    }
    const { t, v1 } = parts;
    if (!t || !v1) return false;
    const signedAtSec = Number(t);
    if (!Number.isFinite(signedAtSec)) return false;
    if (toleranceSec != null && Math.abs(nowMs / 1000 - signedAtSec) > toleranceSec) return false;
    const hmac = crypto.createHmac('sha256', signingKey).update(`${t}.${rawBodyString}`).digest('hex');
    const a = Buffer.from(v1, 'utf8');
    const b = Buffer.from(hmac, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
