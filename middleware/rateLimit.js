import { rateLimit } from 'express-rate-limit';

const defaultMessage = 'Too many requests. Please try again shortly.';

const buildLimiter = ({
  windowMs,
  max,
  message = defaultMessage,
}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

// Broad limiter for all auth routes.
export const authGlobalLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many auth requests from this IP. Please try again later.',
});

// Sensitive auth actions (signup/login/reset/otp resend).
export const authSensitiveLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

// OTP verification can happen multiple times in short bursts.
export const authOtpVerifyLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: 'Too many OTP verification attempts. Please wait and retry.',
});
