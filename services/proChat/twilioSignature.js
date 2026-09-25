import crypto from 'node:crypto';

export function computeTwilioSignature(authToken, url, params = {}) {
  const keys = Object.keys(params || {}).sort();
  const payload = keys.reduce((acc, key) => acc + key + String(params[key] ?? ''), url);
  return crypto.createHmac('sha1', String(authToken || '')).update(payload, 'utf8').digest('base64');
}

export function verifyTwilioSignature({ authToken, signature, url, params }) {
  if (!authToken || !signature || !url) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function publicWebhookUrl(req, pathWithQuery) {
  const configured = String(process.env.TWILIO_WEBHOOK_BASE_URL || '').trim().replace(/\/+$/, '');
  const path = String(pathWithQuery || '').startsWith('/') ? pathWithQuery : `/${pathWithQuery || ''}`;
  if (configured) return `${configured}${path}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}${path}`;
}
