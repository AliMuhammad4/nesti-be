import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import User from '../../models/User.js';
import { ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE } from '../../constants/accountStatus.js';

import { signSessionToken } from './helpers/authTokens.js';
import { loginLockedResponse } from './helpers/authResponses.js';
import { finalizeInviteForUser, resolveUserLoginPresentation } from './helpers/profileHelpers.js';

const MAX_FAILED_LOGINS = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

let dummyHashPromise = null;
const dummyPasswordHash = () => {
  dummyHashPromise ||= bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
  return dummyHashPromise;
};

export const loginService = async ({ email, password, invite_token }) => {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    await bcrypt.compare(String(password || ''), await dummyPasswordHash());
    return { status: 401, body: { success: false, message: 'Invalid email or password' } };
  }
  if (user.auth_provider === 'google') {
    return {
      status: 400,
      body: { success: false, message: 'This account uses Google sign-in. Please continue with Google.' },
    };
  }
  if (user.login_locked_until && new Date(user.login_locked_until) > new Date()) {
    return loginLockedResponse();
  }
  if (!(await user.matchPassword(password))) {
    const failed = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failed_login_count: 1 } },
      { returnDocument: 'after', projection: { failed_login_count: 1 } },
    ).lean();
    if (Number(failed?.failed_login_count || 0) >= MAX_FAILED_LOGINS) {
      await User.updateOne(
        { _id: user._id },
        { $set: { failed_login_count: 0, login_locked_until: new Date(Date.now() + LOGIN_LOCK_MS) } },
      );
      return loginLockedResponse();
    }
    return { status: 401, body: { success: false, message: 'Invalid email or password' } };
  }
  if (Number(user.failed_login_count || 0) > 0 || user.login_locked_until) {
    await User.updateOne({ _id: user._id }, { $set: { failed_login_count: 0, login_locked_until: null } });
  }

  if (user.is_active === false) {
    return {
      status: 401,
      body: { success: false, code: ACCOUNT_SUSPENDED_CODE, message: ACCOUNT_SUSPENDED_MESSAGE },
    };
  }

  if (!user.is_verified) {
    return {
      status: 403,
      body: {
        success: false,
        message: 'Email not verified. Reset your password to confirm this email and sign in.',
      },
    };
  }

  finalizeInviteForUser({
    invite_token,
    userId: user._id,
    method: 'login',
    path: '/auth/login',
  });

  const userPresentation = await resolveUserLoginPresentation(user);

  return {
    status: 200,
    body: {
      success: true,
      token: signSessionToken(user),
      role: user.role,
      user: userPresentation,
    },
  };
};
