import { minutesLabel } from './authTokens.js';

export const signupCodeLimitResponse = (retryMinutes, reason = 'codes') => ({
  status: 429,
  body: {
    success: false,
    code: 'SIGNUP_CODE_LIMIT',
    retry_after_minutes: retryMinutes,
    message: reason === 'wrong'
      ? `Too many incorrect codes for this email. Please try again in ${minutesLabel(retryMinutes)}.`
      : `Too many codes requested for this email. Please try again in ${minutesLabel(retryMinutes)}.`,
  },
});

export const emailSendFailedResponse = () => ({
  status: 503,
  body: {
    success: false,
    code: 'EMAIL_SEND_FAILED',
    message: "We couldn't send the verification email right now. Please try again in a moment.",
  },
});

export const invalidSignupSessionResponse = () => ({
  status: 400,
  body: {
    success: false,
    code: 'SIGNUP_SESSION_INVALID',
    message: 'This signup has expired or was replaced. Please sign up again.',
  },
});

export const loginLockedResponse = () => ({
  status: 429,
  body: {
    success: false,
    code: 'LOGIN_TEMPORARILY_LOCKED',
    message: 'Too many failed attempts. Please try again in 15 minutes or reset your password.',
  },
});
