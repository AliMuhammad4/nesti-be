import { rateLimit } from 'express-rate-limit';

const defaultMessage = 'Too many requests. Please try again shortly.';

function normalizeEmailFromRequest(req) {
  const bodyEmail = String(req?.body?.email || '').trim().toLowerCase();
  if (bodyEmail) return bodyEmail;
  const queryEmail = String(req?.query?.email || '').trim().toLowerCase();
  if (queryEmail) return queryEmail;
  return '';
}

function resolveClientIp(req) {
  return String(req?.ip || req?.socket?.remoteAddress || 'unknown').trim().toLowerCase() || 'unknown';
}

function authKeyByIp(req) {
  return `ip:${resolveClientIp(req)}`;
}

function authKeyByEmailAndIp(req) {
  const email = normalizeEmailFromRequest(req);
  const ip = resolveClientIp(req);
  if (!email) return `ip:${ip}`;
  return `email:${email}|ip:${ip}`;
}

function authKeyByUserOrIp(req) {
  const userId = String(req?.user?._id || '').trim();
  if (userId) return `user:${userId}`;
  return `ip:${resolveClientIp(req)}`;
}

const buildLimiter = ({
  windowMs,
  max,
  message = defaultMessage,
  keyGenerator = authKeyByIp,
}) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

// Broad limiter for all auth routes.
export const authGlobalLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many auth requests from this IP. Please try again later.',
  keyGenerator: authKeyByIp,
});

// Sensitive auth actions (signup/login/reset/otp resend).
export const authSensitiveLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25,
  message: 'Too many attempts. Please wait a few minutes and try again.',
  keyGenerator: authKeyByEmailAndIp,
});

// OTP verification can happen multiple times in short bursts.
export const authOtpVerifyLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: 'Too many OTP verification attempts. Please wait and retry.',
  keyGenerator: authKeyByEmailAndIp,
});

// Authenticated auth endpoints should rate-limit per user, not shared IP.
export const authUserLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 120,
  message: 'Too many account requests. Please wait and try again.',
  keyGenerator: authKeyByUserOrIp,
});
