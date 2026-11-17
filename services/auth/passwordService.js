import User from '../../models/User.js';
import { PASSWORD_POLICY_MESSAGE, isStrongPassword } from '../../utils/passwordPolicy.js';
import { disconnectUserSessions } from '../realtime/sessionSockets.js';

import {
  signJwt,
  tryVerifyJwt,
  stripBearer,
  signSessionToken,
  minutesLabel,
  PASSWORD_RESET_TOKEN_PURPOSE,
  OTP_TTL_MS,
  RESET_WINDOW_MS,
  RESET_RESEND_COOLDOWN_MS,
  MAX_RESET_ATTEMPTS,
  MAX_RESET_CODES_PER_REQUESTER,
  MAX_RESET_CODES_PER_EMAIL,
  MAX_RESET_FAILURES_PER_REQUESTER,
  MAX_RESET_FAILURES_PER_WINDOW,
  MAX_PASSWORD_CHANGE_FAILURES,
  PASSWORD_CHANGE_WINDOW_MS,
  randomOtp,
  hashCode,
  codeMatches,
  resetCodeScope,
} from './helpers/authTokens.js';

import {
  queueGoogleSignInReminderEmail,
  queuePasswordChangedEmail,
  queuePasswordResetEmail,
} from './helpers/authEmail.js';
import { isGoogleAuthUser } from './helpers/googleAuth.js';
import { bumpCounter, emailKey, readCounter, requesterKey } from './helpers/resetThrottle.js';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const secondsUntil = (date, now) => Math.max(1, Math.ceil((new Date(date).getTime() - now.getTime()) / 1000));
const minutesUntil = (date, now) => Math.max(1, Math.ceil((new Date(date).getTime() - now.getTime()) / 60000));

const limitResponse = (code, retryAfterSeconds, message) => ({
  status: 429,
  body: { success: false, code, retry_after_seconds: retryAfterSeconds, message },
});

// ─── Change password ─────────────────────────────────────────────────────────

/** Counts a wrong current password; at the limit every session (this one too) is signed out. */
async function recordWrongCurrentPassword(userId) {
  const now = new Date();
  const windowCutoff = new Date(now.getTime() - PASSWORD_CHANGE_WINDOW_MS);
  const projection = { password_change_failures: 1 };
  const freshWindow = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { password_change_window_started_at: null },
        { password_change_window_started_at: { $lte: windowCutoff } },
      ],
    },
    { $set: { password_change_window_started_at: now, password_change_failures: 1 } },
    { returnDocument: 'after', projection },
  ).lean();
  const counted = freshWindow || await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { password_change_failures: 1 } },
    { returnDocument: 'after', projection },
  ).lean();
  const failures = Number(counted?.password_change_failures || 0);

  if (failures >= MAX_PASSWORD_CHANGE_FAILURES) {
    await User.updateOne(
      { _id: userId },
      {
        $inc: { token_version: 1 },
        $set: { password_change_failures: 0, password_change_window_started_at: null },
      },
    );
    disconnectUserSessions(userId);
    return {
      status: 401,
      body: {
        success: false,
        code: 'SESSION_INVALID',
        message: 'Too many incorrect password attempts. For your security, please sign in again.',
      },
    };
  }

  const left = MAX_PASSWORD_CHANGE_FAILURES - failures;
  return {
    status: 401,
    body: {
      success: false,
      code: 'CURRENT_PASSWORD_INCORRECT',
      attempts_left: left,
      message: `Incorrect current password. ${plural(left, 'attempt')} left before you are signed out.`,
    },
  };
}

export const changePasswordService = async ({ userId, currentPassword, newPassword }) => {
  if (!currentPassword || !newPassword) {
    return {
      status: 400,
      body: { success: false, message: 'Please provide both current and new passwords' },
    };
  }

  const user = await User.findById(userId);
  if (isGoogleAuthUser(user)) {
    return {
      status: 400,
      body: { success: false, message: 'This account uses Google sign-in. Password changes are not available.' },
    };
  }
  if (!user) {
    return { status: 401, body: { success: false, code: 'SESSION_INVALID', message: 'Not authorized, please sign in again.' } };
  }
  if (!(await user.matchPassword(currentPassword))) {
    return recordWrongCurrentPassword(user._id);
  }
  if (!isStrongPassword(newPassword)) {
    return { status: 400, body: { success: false, message: PASSWORD_POLICY_MESSAGE } };
  }
  if (String(newPassword) === String(currentPassword)) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'PASSWORD_UNCHANGED',
        message: 'Your new password must be different from your current password.',
      },
    };
  }

  user.password = newPassword;
  user.token_version = Number(user.token_version || 0) + 1;
  user.password_change_failures = 0;
  user.password_change_window_started_at = null;
  await user.save();
  disconnectUserSessions(user._id);
  queuePasswordChangedEmail(user.email, { via: 'change' });

  return {
    status: 200,
    body: { success: true, message: 'Password updated successfully', token: signSessionToken(user) },
  };
};

// ─── Forgot password ─────────────────────────────────────────────────────────

const RESET_CODE_SENT_MESSAGE = 'If an account exists for that email, a reset code has been sent.';
const RESEND_AFTER_SECONDS = Math.round(RESET_RESEND_COOLDOWN_MS / 1000);
/** Every forgot-password answer takes at least this long, so timing doesn't hint whether an account exists. */
const FORGOT_MIN_RESPONSE_MS = process.env.NODE_ENV === 'test' ? 0 : 450;

const codeSentResponse = () => ({
  status: 200,
  body: { success: true, message: RESET_CODE_SENT_MESSAGE, resend_after_seconds: RESEND_AFTER_SECONDS },
});

const wrongCodesFromHereResponse = (windowEndsAt, now) => {
  const minutes = minutesUntil(windowEndsAt, now);
  return limitResponse(
    'RESET_TOO_MANY_WRONG_CODES',
    minutes * 60,
    `Too many incorrect codes were entered. Please try again in ${minutesLabel(minutes)}.`,
  );
};

/** Account-wide brute-force ceiling: honest answer, and no new code is sent while it lasts. */
function accountLockedResponse(user, now) {
  const startedAt = user?.reset_window_started_at ? new Date(user.reset_window_started_at) : null;
  if (!startedAt || now.getTime() - startedAt.getTime() >= RESET_WINDOW_MS) return null;
  if (Number(user.reset_failures_in_window || 0) < MAX_RESET_FAILURES_PER_WINDOW) return null;
  const minutes = minutesUntil(new Date(startedAt.getTime() + RESET_WINDOW_MS), now);
  return limitResponse(
    'RESET_LOCKED',
    minutes * 60,
    `Too many incorrect codes were entered for this email. For your security, password reset is paused. Please try again in ${minutesLabel(minutes)}.`,
  );
}

/** Same limits for every email, whether or not an account exists. */
async function requestLimitResponse(normalizedEmail, ip, now) {
  const [fromHere, allConnections, wrongFromHere] = await Promise.all([
    readCounter(requesterKey('reset-codes', normalizedEmail, ip), now),
    readCounter(emailKey('reset-codes', normalizedEmail), now),
    readCounter(requesterKey('reset-wrong', normalizedEmail, ip), now),
  ]);
  if (wrongFromHere.count >= MAX_RESET_FAILURES_PER_REQUESTER) {
    return wrongCodesFromHereResponse(wrongFromHere.windowEndsAt, now);
  }
  if (fromHere.lastAt && now.getTime() - fromHere.lastAt.getTime() < RESET_RESEND_COOLDOWN_MS) {
    const seconds = secondsUntil(new Date(fromHere.lastAt.getTime() + RESET_RESEND_COOLDOWN_MS), now);
    return limitResponse(
      'RESET_RESEND_COOLDOWN',
      seconds,
      `Please wait before requesting another code. Try again in ${seconds}s.`,
    );
  }
  const capped = fromHere.count >= MAX_RESET_CODES_PER_REQUESTER
    ? fromHere
    : allConnections.count >= MAX_RESET_CODES_PER_EMAIL ? allConnections : null;
  if (capped) {
    const minutes = minutesUntil(capped.windowEndsAt, now);
    return limitResponse(
      'RESET_CODE_LIMIT',
      minutes * 60,
      `You've reached the limit of reset codes for now. Please try again in ${minutesLabel(minutes)}.`,
    );
  }
  return null;
}

async function issueResetCode(normalizedEmail, ip) {
  const now = new Date();
  const limited = await requestLimitResponse(normalizedEmail, ip, now);
  if (limited) return limited;

  const user = await User.findOne({ email: normalizedEmail });
  const googleUser = Boolean(user) && isGoogleAuthUser(user);
  if (user && !googleUser) {
    const locked = accountLockedResponse(user, now);
    if (locked) return locked;
  }

  await Promise.all([
    bumpCounter(requesterKey('reset-codes', normalizedEmail, ip), RESET_WINDOW_MS, now),
    bumpCounter(emailKey('reset-codes', normalizedEmail), RESET_WINDOW_MS, now),
  ]);

  if (!user) return codeSentResponse();
  if (googleUser) {
    queueGoogleSignInReminderEmail(user.email);
    return codeSentResponse();
  }

  const otp = randomOtp();
  const windowOpen = user.reset_window_started_at
    && now.getTime() - new Date(user.reset_window_started_at).getTime() < RESET_WINDOW_MS;
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        reset_password_token: hashCode(resetCodeScope(user._id), otp),
        reset_password_expires: new Date(now.getTime() + OTP_TTL_MS),
        reset_password_attempts: 0,
        ...(windowOpen ? {} : { reset_window_started_at: now, reset_failures_in_window: 0 }),
      },
    },
  );
  queuePasswordResetEmail(user.email, otp);
  return codeSentResponse();
}

export const forgotPasswordService = async ({ email, ip } = {}) => {
  if (!email) {
    return { status: 400, body: { success: false, message: 'Please provide an email address' } };
  }
  const startedAt = Date.now();
  const result = await issueResetCode(String(email).toLowerCase().trim(), ip);
  const wait = FORGOT_MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return result;
};

// ─── Verify reset code ───────────────────────────────────────────────────────

const invalidCodeResponse = () => ({
  status: 400,
  body: { success: false, code: 'RESET_CODE_INVALID', message: 'This code is invalid or has expired. Please request a new code.' },
});

const usedUpCodeResponse = (status = 429) => ({
  status,
  body: {
    success: false,
    code: 'RESET_CODE_USED_UP',
    attempts_left: 0,
    message: 'This code was entered incorrectly too many times. Please request a new code.',
  },
});

export const verifyResetOtpService = async ({ email, otp, ip } = {}) => {
  if (!email || !otp) {
    return {
      status: 400,
      body: { success: false, message: 'Please provide both email and code' },
    };
  }

  const now = new Date();
  const normalizedEmail = String(email).toLowerCase().trim();
  const wrongKey = requesterKey('reset-wrong', normalizedEmail, ip);
  const wrongFromHere = await readCounter(wrongKey, now);
  if (wrongFromHere.count >= MAX_RESET_FAILURES_PER_REQUESTER) {
    return wrongCodesFromHereResponse(wrongFromHere.windowEndsAt, now);
  }
  const noteWrongCode = () => bumpCounter(wrongKey, RESET_WINDOW_MS, now);

  const user = await User.findOne({ email: normalizedEmail });
  if (!user || !user.reset_password_token || !user.reset_password_expires || isGoogleAuthUser(user)) {
    await noteWrongCode();
    return invalidCodeResponse();
  }

  const clearResetCode = async () => {
    user.reset_password_token = undefined;
    user.reset_password_expires = undefined;
    user.reset_password_attempts = 0;
    await user.save();
  };

  if (now > new Date(user.reset_password_expires)) {
    await clearResetCode();
    return {
      status: 400,
      body: { success: false, code: 'RESET_CODE_EXPIRED', message: 'This code has expired. Please request a new code.' },
    };
  }
  const lockedBefore = accountLockedResponse(user, now);
  if (lockedBefore) {
    await clearResetCode();
    return lockedBefore;
  }

  const reserved = await User.findOneAndUpdate(
    {
      _id: user._id,
      reset_password_token: user.reset_password_token,
      reset_password_attempts: { $lt: MAX_RESET_ATTEMPTS },
      reset_failures_in_window: { $lt: MAX_RESET_FAILURES_PER_WINDOW },
    },
    { $inc: { reset_password_attempts: 1, reset_failures_in_window: 1 } },
    {
      returnDocument: 'after',
      projection: { reset_password_attempts: 1, reset_failures_in_window: 1, reset_window_started_at: 1 },
    },
  ).lean();
  if (!reserved) {
    await noteWrongCode();
    const latest = await User.findById(user._id)
      .select('reset_password_token reset_failures_in_window reset_window_started_at')
      .lean();
    if (!latest || latest.reset_password_token !== user.reset_password_token) {
      return invalidCodeResponse();
    }
    await clearResetCode();
    return accountLockedResponse(latest, now) || usedUpCodeResponse();
  }

  if (!codeMatches(user.reset_password_token, resetCodeScope(user._id), otp)) {
    await noteWrongCode();
    const left = Math.max(0, MAX_RESET_ATTEMPTS - Number(reserved.reset_password_attempts || 0));
    const lockedNow = accountLockedResponse(reserved, now);
    if (left === 0 || lockedNow) {
      await clearResetCode();
      return lockedNow || {
        status: 400,
        body: {
          success: false,
          code: 'RESET_CODE_USED_UP',
          attempts_left: 0,
          message: 'Incorrect code. This code can no longer be used. Please request a new code.',
        },
      };
    }
    return {
      status: 400,
      body: {
        success: false,
        code: 'RESET_CODE_INCORRECT',
        attempts_left: left,
        message: `Incorrect code. ${plural(left, 'attempt')} left.`,
      },
    };
  }
  await User.updateOne({ _id: user._id }, { $inc: { reset_failures_in_window: -1 } });

  const resetToken = signJwt(
    {
      id: String(user._id),
      purpose: PASSWORD_RESET_TOKEN_PURPOSE,
      tv: Number(user.token_version || 0),
    },
    '15m',
  );

  if (user.is_verified === false) user.is_verified = true;
  await clearResetCode();

  return {
    status: 200,
    body: { success: true, message: 'Code verified', resetToken },
  };
};

// ─── Reset password ──────────────────────────────────────────────────────────

const invalidResetSessionResponse = () => ({
  status: 400,
  body: {
    success: false,
    code: 'RESET_SESSION_INVALID',
    message: 'Your reset session has expired. Please request a new code.',
  },
});

export const resetPasswordService = async ({ resetToken, newPassword }) => {
  if (!resetToken || !newPassword) {
    return {
      status: 400,
      body: { success: false, message: 'Please provide reset token and new password' },
    };
  }

  const verified = tryVerifyJwt(stripBearer(resetToken));
  if (!verified.ok || verified.payload?.purpose !== PASSWORD_RESET_TOKEN_PURPOSE) {
    return invalidResetSessionResponse();
  }
  const decoded = verified.payload;

  const user = await User.findById(decoded.id);
  if (!user) return invalidResetSessionResponse();
  if (isGoogleAuthUser(user)) {
    return {
      status: 400,
      body: { success: false, message: 'This account uses Google sign-in. Password reset is not available.' },
    };
  }
  if (Number(decoded.tv || 0) !== Number(user.token_version || 0)) {
    return invalidResetSessionResponse();
  }
  if (!isStrongPassword(newPassword)) {
    return { status: 400, body: { success: false, message: PASSWORD_POLICY_MESSAGE } };
  }

  user.password = newPassword;
  user.token_version = Number(user.token_version || 0) + 1;
  user.failed_login_count = 0;
  user.login_locked_until = null;
  user.password_change_failures = 0;
  user.password_change_window_started_at = null;
  await user.save();
  disconnectUserSessions(user._id);
  queuePasswordChangedEmail(user.email, { via: 'reset' });

  return {
    status: 200,
    body: { success: true, message: 'Password reset successfully' },
  };
};
