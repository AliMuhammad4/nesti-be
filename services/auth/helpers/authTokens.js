import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../../../utils/jwtSecret.js';

export const SIGNUP_TOKEN_PURPOSE = 'signup_verify';
export const PASSWORD_RESET_TOKEN_PURPOSE = 'password_reset';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const PENDING_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
export const SIGNUP_CODE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
export const MAX_TOTAL_SIGNUP_ATTEMPTS = 15;
export const MAX_SIGNUP_CODES_PER_WINDOW = 6;
export const MAX_RESET_ATTEMPTS = 5;
export const RESET_WINDOW_MS = 60 * 60 * 1000;
export const MAX_RESET_CODES_PER_WINDOW = 5;
export const MAX_RESET_FAILURES_PER_WINDOW = 10;

export const randomOtp = () => String(crypto.randomInt(10000, 100000));

export const hashCode = (scope, value) =>
  crypto.createHmac('sha256', getJwtSecret()).update(`${scope}:${String(value || '').trim()}`).digest('hex');

export const codeMatches = (expectedHash, scope, value) => {
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  const actual = Buffer.from(hashCode(scope, value), 'hex');
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

export const signupCodeScope = (email) => `signup:${email}`;
export const resetCodeScope = (userId) => `reset:${String(userId)}`;

export const signJwt = (payload, expiresIn) => jwt.sign(payload, getJwtSecret(), { expiresIn });

export const tryVerifyJwt = (token) => {
  try {
    return { ok: true, payload: jwt.verify(token, getJwtSecret()) };
  } catch {
    return { ok: false, payload: null };
  }
};

export const signSessionToken = (user) =>
  signJwt({ id: String(user._id), tv: Number(user.token_version || 0) }, '30d');

export const signSignupToken = (pending) =>
  signJwt(
    { purpose: SIGNUP_TOKEN_PURPOSE, email: pending.email, nonce: pending.session_nonce },
    Math.floor(PENDING_SIGNUP_TTL_MS / 1000),
  );

export const stripBearer = (value) => {
  const raw = String(value || '').trim();
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
};

export const minutesUntil = (ms) => Math.max(1, Math.ceil(ms / 60000));
export const minutesLabel = (minutes) => `${minutes} minute${minutes === 1 ? '' : 's'}`;

export function signupCodeWindow(pending, now = new Date()) {
  const startedRaw = pending?.window_started_at || pending?.createdAt || null;
  const started = startedRaw ? new Date(startedRaw) : null;
  if (!pending || !started || now.getTime() - started.getTime() >= SIGNUP_CODE_WINDOW_MS) {
    return { fresh: true, started: now, codes: 0, wrong: 0, retryMinutes: 0 };
  }
  return {
    fresh: false,
    started,
    codes: Number(pending.codes_in_window ?? pending.resend_count ?? 0),
    wrong: Number(pending.total_attempts || 0),
    retryMinutes: minutesUntil(started.getTime() + SIGNUP_CODE_WINDOW_MS - now.getTime()),
  };
}
