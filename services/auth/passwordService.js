import User from '../../models/User.js';
import { PASSWORD_POLICY_MESSAGE, isStrongPassword } from '../../utils/passwordPolicy.js';
import { disconnectUserSessions } from '../realtime/sessionSockets.js';

import {
  signJwt,
  tryVerifyJwt,
  stripBearer,
  signSessionToken,
  PASSWORD_RESET_TOKEN_PURPOSE,
  OTP_TTL_MS,
  RESET_WINDOW_MS,
  MAX_RESET_ATTEMPTS,
  MAX_RESET_CODES_PER_WINDOW,
  MAX_RESET_FAILURES_PER_WINDOW,
  randomOtp,
  hashCode,
  codeMatches,
  resetCodeScope,
} from './helpers/authTokens.js';

import { tooManyCodesResponse } from './helpers/authResponses.js';
import { queuePasswordResetEmail } from './helpers/authEmail.js';
import { isGoogleAuthUser } from './helpers/googleAuth.js';

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
  if (!user || !(await user.matchPassword(currentPassword))) {
    return { status: 401, body: { success: false, message: 'Incorrect current password' } };
  }
  if (!isStrongPassword(newPassword)) {
    return { status: 400, body: { success: false, message: PASSWORD_POLICY_MESSAGE } };
  }

  user.password = newPassword;
  user.token_version = Number(user.token_version || 0) + 1;
  await user.save();
  disconnectUserSessions(user._id);

  return {
    status: 200,
    body: { success: true, message: 'Password updated successfully', token: signSessionToken(user) },
  };
};

const RESET_CODE_SENT_MESSAGE = 'If an account exists for that email, a reset code has been sent.';

export const forgotPasswordService = async ({ email }) => {
  if (!email) {
    return { status: 400, body: { success: false, message: 'Please provide an email address' } };
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    return { status: 200, body: { success: true, message: RESET_CODE_SENT_MESSAGE } };
  }
  if (isGoogleAuthUser(user)) {
    return { status: 200, body: { success: true, message: RESET_CODE_SENT_MESSAGE } };
  }

  const otp = randomOtp();
  const now = new Date();
  const windowCutoff = new Date(now.getTime() - RESET_WINDOW_MS);
  const codeFields = {
    reset_password_token: hashCode(resetCodeScope(user._id), otp),
    reset_password_expires: new Date(now.getTime() + OTP_TTL_MS),
    reset_password_attempts: 0,
  };
  const startedWindow = await User.updateOne(
    {
      _id: user._id,
      $or: [{ reset_window_started_at: null }, { reset_window_started_at: { $lte: windowCutoff } }],
    },
    {
      $set: {
        ...codeFields,
        reset_window_started_at: now,
        reset_requests_in_window: 1,
        reset_failures_in_window: 0,
      },
    },
  );
  let issued = startedWindow.modifiedCount > 0;
  if (!issued) {
    const inWindow = await User.updateOne(
      {
        _id: user._id,
        reset_window_started_at: { $gt: windowCutoff },
        reset_requests_in_window: { $lt: MAX_RESET_CODES_PER_WINDOW },
      },
      { $set: codeFields, $inc: { reset_requests_in_window: 1 } },
    );
    issued = inWindow.modifiedCount > 0;
  }
  if (issued) queuePasswordResetEmail(user.email, otp);

  return {
    status: 200,
    body: {
      success: true,
      message: RESET_CODE_SENT_MESSAGE,
    },
  };
};

export const verifyResetOtpService = async ({ email, otp }) => {
  if (!email || !otp) {
    return {
      status: 400,
      body: { success: false, message: 'Please provide both email and OTP' },
    };
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user || !user.reset_password_token || !user.reset_password_expires) {
    return { status: 400, body: { success: false, message: 'Invalid or expired OTP' } };
  }
  if (isGoogleAuthUser(user)) {
    return {
      status: 400,
      body: { success: false, message: 'This account uses Google sign-in. Please continue with Google.' },
    };
  }

  const clearResetCode = async () => {
    user.reset_password_token = undefined;
    user.reset_password_expires = undefined;
    user.reset_password_attempts = 0;
    await user.save();
  };

  if (new Date() > new Date(user.reset_password_expires)) {
    await clearResetCode();
    return { status: 400, body: { success: false, message: 'OTP has expired' } };
  }
  const reserved = await User.findOneAndUpdate(
    {
      _id: user._id,
      reset_password_token: user.reset_password_token,
      reset_password_attempts: { $lt: MAX_RESET_ATTEMPTS },
      reset_failures_in_window: { $lt: MAX_RESET_FAILURES_PER_WINDOW },
    },
    { $inc: { reset_password_attempts: 1, reset_failures_in_window: 1 } },
    { returnDocument: 'after', projection: { _id: 1 } },
  ).lean();
  if (!reserved) {
    const stillSameCode = await User.exists({ _id: user._id, reset_password_token: user.reset_password_token });
    if (!stillSameCode) {
      return { status: 400, body: { success: false, message: 'Invalid or expired OTP' } };
    }
    await clearResetCode();
    return tooManyCodesResponse('Too many incorrect codes. Please try again later.');
  }
  if (!codeMatches(user.reset_password_token, resetCodeScope(user._id), otp)) {
    return { status: 400, body: { success: false, message: 'Invalid OTP' } };
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
    body: { success: true, message: 'OTP verified successfully', resetToken },
  };
};

export const resetPasswordService = async ({ resetToken, newPassword }) => {
  if (!resetToken || !newPassword) {
    return {
      status: 400,
      body: { success: false, message: 'Please provide reset token and new password' },
    };
  }

  const invalidSession = {
    status: 400,
    body: { success: false, message: 'Reset session expired or invalid. Please request a new OTP.' },
  };
  const verified = tryVerifyJwt(stripBearer(resetToken));
  if (!verified.ok || verified.payload?.purpose !== PASSWORD_RESET_TOKEN_PURPOSE) {
    return invalidSession;
  }
  const decoded = verified.payload;

  const user = await User.findById(decoded.id);
  if (!user) {
    return { status: 400, body: { success: false, message: 'User not found for this reset session' } };
  }
  if (isGoogleAuthUser(user)) {
    return {
      status: 400,
      body: { success: false, message: 'This account uses Google sign-in. Password reset is not available.' },
    };
  }
  if (Number(decoded.tv || 0) !== Number(user.token_version || 0)) {
    return invalidSession;
  }
  if (!isStrongPassword(newPassword)) {
    return { status: 400, body: { success: false, message: PASSWORD_POLICY_MESSAGE } };
  }

  user.password = newPassword;
  user.token_version = Number(user.token_version || 0) + 1;
  user.failed_login_count = 0;
  user.login_locked_until = null;
  await user.save();
  disconnectUserSessions(user._id);

  return {
    status: 200,
    body: { success: true, message: 'Password reset successfully' },
  };
};
