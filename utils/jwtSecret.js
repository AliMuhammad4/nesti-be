import 'dotenv/config';

export function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET must be configured; refusing to use an insecure fallback secret.');
  }
  return secret;
}

export function assertJwtSecretConfigured() {
  getJwtSecret();
}
