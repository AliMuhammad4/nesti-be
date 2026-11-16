import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import User from '../../models/User.js';
import PendingSignup from '../../models/PendingSignup.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { USER_ROLE, isProfessionalRole, isSignupRole } from '../../constants/roles.js';
import { PASSWORD_POLICY_MESSAGE, isStrongPassword } from '../../utils/passwordPolicy.js';
import {
  PHONE_INVALID_MESSAGE,
  PHONE_TAKEN_MESSAGE,
  isPhoneDuplicateError,
  normalizePhoneE164,
} from '../../utils/phone.js';
import { disposableEmailErrorResponse, isDisposableEmail } from './disposableEmailGuard.js';
import { presentableNames } from '../../utils/placeholderName.js';

import {
  OTP_TTL_MS,
  PENDING_SIGNUP_TTL_MS,
  MAX_OTP_ATTEMPTS,
  MAX_TOTAL_SIGNUP_ATTEMPTS,
  MAX_SIGNUP_CODES_PER_WINDOW,
  randomOtp,
  hashCode,
  codeMatches,
  signupCodeScope,
  signSessionToken,
  signSignupToken,
  signupCodeWindow,
} from './helpers/authTokens.js';

import {
  signupCodeLimitResponse,
  emailSendFailedResponse,
  invalidSignupSessionResponse,
} from './helpers/authResponses.js';

import { sendSignupOtpEmail } from './helpers/authEmail.js';
import { isGoogleAuthUser } from './helpers/googleAuth.js';
import { phoneBelongsToAnotherUser, phoneHeldByOtherPending } from './helpers/phoneChecks.js';
import { loadPendingSignupFromToken } from './helpers/pendingSignupLookup.js';
import {
  signupNames,
  bootstrapProfessionalProfile,
  finalizeInviteForUser,
  resolveUserLoginPresentation,
  newClientTrialFields,
  clientTrialEndsAt,
} from './helpers/profileHelpers.js';

const SIGNUP_RESEND_COOLDOWN_MS = 60 * 1000;

function resendCooldownResponse(pending, now) {
  const lastSentAt = pending.otp_expires_at ? new Date(pending.otp_expires_at).getTime() - OTP_TTL_MS : 0;
  const waitMs = lastSentAt + SIGNUP_RESEND_COOLDOWN_MS - now.getTime();
  if (waitMs <= 0) return null;
  const seconds = Math.ceil(waitMs / 1000);
  return {
    status: 429,
    body: {
      success: false,
      code: 'RESEND_COOLDOWN',
      retry_after_seconds: seconds,
      message: `Please wait a moment before requesting a new code. Try again in ${seconds}s.`,
    },
  };
}

export const signupService = async (payload) => {
  const { email, password, first_name, last_name, role, phone, invite_token } = payload;
  const normalizedEmail = String(email || '').toLowerCase().trim();
  const firstName = String(first_name || '').trim();
  const lastName = String(last_name || '').trim();

  if (!normalizedEmail || !password || !phone) {
    return { status: 400, body: { success: false, message: 'Please provide all required fields' } };
  }
  if (isDisposableEmail(normalizedEmail)) {
    return disposableEmailErrorResponse();
  }

  const existingUser = await User.findOne({ email: normalizedEmail }).select('_id role auth_provider is_verified').lean();
  if (existingUser) {
    if (isGoogleAuthUser(existingUser)) {
      return {
        status: 400,
        body: {
          success: false,
          code: 'EMAIL_REGISTERED_WITH_GOOGLE',
          message: 'This email is already registered with Google. Log in with Google instead.',
        },
      };
    }
    return {
      status: 400,
      body: {
        success: false,
        code: 'EMAIL_ALREADY_REGISTERED',
        message: existingUser.is_verified === false
          ? 'An account with this email already exists. Reset your password to confirm the email and sign in.'
          : 'An account with this email already exists. Please log in.',
      },
    };
  }

  const now = new Date();
  const existingPending = await PendingSignup.findOne({ email: normalizedEmail }).lean();
  const pendingStillOpen = Boolean(existingPending && new Date(existingPending.expires_at) > now);
  const codeStillValid = pendingStillOpen && new Date(existingPending.otp_expires_at) > now;
  if (codeStillValid) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'SIGNUP_ALREADY_PENDING',
        message: 'This email is already waiting for verification. Use the code we sent, or resend it from the verification page.',
      },
    };
  }

  if (!isSignupRole(role)) {
    return { status: 400, body: { success: false, code: 'ROLE_INVALID', message: 'Please select a valid account type' } };
  }
  const normalizedPhone = normalizePhoneE164(phone);
  if (!normalizedPhone) {
    return { status: 400, body: { success: false, code: 'PHONE_INVALID', message: PHONE_INVALID_MESSAGE } };
  }
  if (!isStrongPassword(password)) {
    return { status: 400, body: { success: false, code: 'PASSWORD_WEAK', message: PASSWORD_POLICY_MESSAGE } };
  }
  if (
    (await phoneBelongsToAnotherUser(normalizedPhone))
    || (await phoneHeldByOtherPending(normalizedPhone, normalizedEmail))
  ) {
    return { status: 400, body: { success: false, code: 'PHONE_TAKEN', message: PHONE_TAKEN_MESSAGE } };
  }

  // The code has expired, but the signup row is still here. A new signup may replace it.
  // The hourly code limit carries over, so this does not start the budget again.
  const replacing = pendingStillOpen;
  let window = null;
  if (replacing) {
    window = signupCodeWindow(existingPending, now);
    if (window.wrong >= MAX_TOTAL_SIGNUP_ATTEMPTS) return signupCodeLimitResponse(window.retryMinutes, 'wrong');
    if (window.codes >= MAX_SIGNUP_CODES_PER_WINDOW) return signupCodeLimitResponse(window.retryMinutes);
    const cooldown = resendCooldownResponse(existingPending, now);
    if (cooldown) return cooldown;
  }

  const names = signupNames({ firstName, lastName });
  const otp = randomOtp();
  const fields = {
    password_hash: await bcrypt.hash(String(password), 10),
    first_name: names.firstName,
    last_name: names.lastName,
    phone: normalizedPhone,
    role,
    invite_token: String(invite_token || '').trim(),
    session_nonce: crypto.randomBytes(16).toString('hex'),
    otp_hash: hashCode(signupCodeScope(normalizedEmail), otp),
    otp_expires_at: new Date(now.getTime() + OTP_TTL_MS),
    otp_attempts: 0,
    expires_at: new Date(now.getTime() + PENDING_SIGNUP_TTL_MS),
  };

  const previousSignup = replacing
    ? {
        password_hash: existingPending.password_hash,
        first_name: existingPending.first_name,
        last_name: existingPending.last_name,
        phone: existingPending.phone || '',
        role: existingPending.role,
        invite_token: existingPending.invite_token || '',
        session_nonce: existingPending.session_nonce,
        otp_hash: existingPending.otp_hash,
        otp_expires_at: existingPending.otp_expires_at,
        otp_attempts: Number(existingPending.otp_attempts || 0),
        expires_at: existingPending.expires_at,
        codes_in_window: Number(existingPending.codes_in_window ?? 0),
        window_started_at: existingPending.window_started_at || existingPending.createdAt || null,
        total_attempts: Number(existingPending.total_attempts || 0),
        resend_count: Number(existingPending.resend_count || 0),
      }
    : null;

  let pending;
  if (replacing) {
    pending = await PendingSignup.findOneAndUpdate(
      { _id: existingPending._id, otp_hash: existingPending.otp_hash },
      {
        $set: {
          ...fields,
          codes_in_window: window.codes + 1,
          window_started_at: window.started,
          total_attempts: window.wrong,
        },
        $inc: { resend_count: 1 },
      },
      { returnDocument: 'after' },
    ).lean();
    if (!pending) {
      return {
        status: 409,
        body: { success: false, code: 'OTP_REPLACED', message: 'A new code was just sent. Please check your inbox.' },
      };
    }
  } else {
    if (existingPending) {
      await PendingSignup.deleteOne({ _id: existingPending._id });
    }
    try {
      pending = await PendingSignup.create({
        email: normalizedEmail,
        ...fields,
        resend_count: 0,
        total_attempts: 0,
        codes_in_window: 1,
        window_started_at: now,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return {
          status: 409,
          body: { success: false, code: 'OTP_REPLACED', message: 'A new code was just sent. Please check your inbox.' },
        };
      }
      throw error;
    }
  }

  const sent = await sendSignupOtpEmail({
    email: normalizedEmail,
    first_name: names.firstName,
    last_name: names.lastName,
    otp,
  });
  if (!sent) {
    if (replacing) {
      await PendingSignup.updateOne(
        { _id: pending._id, otp_hash: fields.otp_hash },
        { $set: previousSignup },
      );
    } else {
      await PendingSignup.deleteOne({ _id: pending._id });
    }
    return emailSendFailedResponse();
  }

  return {
    status: 201,
    body: {
      success: true,
      message: 'We sent a 5-digit code to your email. Enter it to create your account.',
      verificationToken: signSignupToken(pending),
    },
  };
};

export const verifyEmailService = async ({ verificationToken, otp, invite_token }) => {
  if (!otp) {
    return { status: 400, body: { success: false, message: 'Please enter the code' } };
  }

  // Only the browser that submitted the latest signup holds its session, so the account is always
  // created with the details from that signup, never from an earlier or someone else's.
  const pending = verificationToken ? await loadPendingSignupFromToken(verificationToken) : null;
  if (!pending) return invalidSignupSessionResponse();
  if (isDisposableEmail(pending.email)) {
    return disposableEmailErrorResponse();
  }
  const unverifiedUser = await User.findOne({ email: pending.email });
  if (unverifiedUser && unverifiedUser.is_verified !== false) {
    await PendingSignup.deleteOne({ _id: pending._id });
    return {
      status: 400,
      body: { success: false, code: 'ALREADY_VERIFIED', message: 'Account already verified. Please log in.' },
    };
  }
  if (new Date(pending.otp_expires_at) <= new Date()) {
    return { status: 400, body: { success: false, code: 'OTP_EXPIRED', message: 'This code has expired. Please request a new code.' } };
  }
  const reserved = await PendingSignup.findOneAndUpdate(
    {
      _id: pending._id,
      otp_hash: pending.otp_hash,
      otp_attempts: { $lt: MAX_OTP_ATTEMPTS },
      total_attempts: { $lt: MAX_TOTAL_SIGNUP_ATTEMPTS },
    },
    { $inc: { otp_attempts: 1, total_attempts: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!reserved) {
    const current = await PendingSignup.findOne({ _id: pending._id, otp_hash: pending.otp_hash }).lean();
    if (!current) {
      return {
        status: 400,
        body: { success: false, code: 'OTP_REPLACED', message: 'A newer code was sent. Please use the latest code.' },
      };
    }
    const window = signupCodeWindow(current);
    if (!window.fresh && window.wrong >= MAX_TOTAL_SIGNUP_ATTEMPTS) {
      return signupCodeLimitResponse(window.retryMinutes, 'wrong');
    }
    return {
      status: 429,
      body: { success: false, code: 'OTP_LOCKED', message: 'Too many incorrect codes. Please request a new code.' },
    };
  }
  if (!codeMatches(pending.otp_hash, signupCodeScope(pending.email), otp)) {
    const attemptsLeft = Math.max(0, MAX_OTP_ATTEMPTS - Number(reserved.otp_attempts || 0));
    return {
      status: 400,
      body: {
        success: false,
        code: 'INVALID_OTP',
        attempts_left: attemptsLeft,
        message: attemptsLeft > 0
          ? `That code isn't right. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`
          : 'That code isn\'t right. Please request a new code.',
      },
    };
  }
  await PendingSignup.updateOne({ _id: pending._id }, { $inc: { otp_attempts: -1, total_attempts: -1 } });

  if (
    (await phoneBelongsToAnotherUser(pending.phone, unverifiedUser?._id || null))
    || (pending.phone
      && (await PendingSignup.exists({
        phone: pending.phone,
        email: { $ne: pending.email },
        expires_at: { $gt: new Date() },
        _id: { $lt: pending._id },
      })))
  ) {
    return {
      status: 400,
      body: { success: false, code: 'PHONE_TAKEN', message: `${PHONE_TAKEN_MESSAGE}. Please sign up again with another number.` },
    };
  }
  if (!isSignupRole(pending.role)) return invalidSignupSessionResponse();

  const existingBeforeConsume = await User.findOne({ email: pending.email });
  if (existingBeforeConsume && existingBeforeConsume.is_verified !== false) {
    await PendingSignup.deleteOne({ _id: pending._id });
    return {
      status: 400,
      body: { success: false, code: 'ALREADY_VERIFIED', message: 'Account already verified. Please log in.' },
    };
  }
  if (existingBeforeConsume?.role && existingBeforeConsume.role !== pending.role) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'This email already has an account. Please log in.',
      },
    };
  }

  const consumed = await PendingSignup.findOneAndDelete({ _id: pending._id, otp_hash: pending.otp_hash });
  if (!consumed) {
    if (await User.exists({ email: pending.email })) {
      return { status: 400, body: { success: false, message: 'Account already verified. Please login.' } };
    }
    return invalidSignupSessionResponse();
  }

  const existingUser = await User.findOne({ email: consumed.email });
  if (existingUser && existingUser.is_verified !== false) {
    return {
      status: 400,
      body: { success: false, message: 'Account already verified. Please login.' },
    };
  }
  if (existingUser && existingUser.role && existingUser.role !== consumed.role) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'This email already has an account. Please log in.',
      },
    };
  }

  let user;
  try {
    if (existingUser) {
      user = existingUser;
      user.password = consumed.password_hash;
      user.first_name = consumed.first_name;
      user.last_name = consumed.last_name;
      user.phone = consumed.phone || '';
      user.is_verified = true;
      user.auth_provider = 'local';
      user.token_version = Number(user.token_version || 0) + 1;
      if (user.role === USER_ROLE.CLIENT && !clientTrialEndsAt(user)) {
        Object.assign(user, newClientTrialFields());
      }
      user.$locals.passwordAlreadyHashed = true;
      await user.save();
    } else {
      user = new User({
        email: consumed.email,
        password: consumed.password_hash,
        first_name: consumed.first_name,
        last_name: consumed.last_name,
        phone: consumed.phone || '',
        role: consumed.role,
        is_verified: true,
        auth_provider: 'local',
        ...(consumed.role === USER_ROLE.CLIENT ? newClientTrialFields() : {}),
      });
      user.$locals.passwordAlreadyHashed = true;
      await user.save();
    }
  } catch (error) {
    if (error?.code === 11000) {
      if (isPhoneDuplicateError(error)) {
        return {
          status: 400,
          body: { success: false, code: 'PHONE_TAKEN', message: `${PHONE_TAKEN_MESSAGE}. Please sign up again with another number.` },
        };
      }
      return {
        status: 400,
        body: { success: false, message: 'Account already verified. Please login.' },
      };
    }
    throw error;
  }

  if (isProfessionalRole(user.role)) {
    const existingProfile = await ProfessionalProfile.findOne({ user_id: user._id });
    if (!existingProfile) {
      await bootstrapProfessionalProfile(user);
    } else if (
      existingProfile.professional_type !== user.role
      || existingProfile.phone !== (user.phone || '')
    ) {
      existingProfile.professional_type = user.role;
      existingProfile.full_name = presentableNames(user).name;
      existingProfile.phone = user.phone || '';
      await existingProfile.save();
      if (user.role === USER_ROLE.AGENT) {
        const { ensureAgentPropertyMatchScoring } = await import('../agent/propertyMatch/scoringConfig.js');
        await ensureAgentPropertyMatchScoring(user._id);
      }
    }
  } else if (!existingUser) {
    await bootstrapProfessionalProfile(user);
  }

  const inviteTokenFromPayload = String(invite_token || consumed.invite_token || '').trim();
  finalizeInviteForUser({
    invite_token: inviteTokenFromPayload,
    userId: user._id,
    method: 'signup_verify_email',
    path: '/auth/verify-email',
  });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Email verified successfully and account created',
      token: signSessionToken(user),
      role: user.role,
      user: await resolveUserLoginPresentation(user),
    },
  };
};

export const resendVerificationService = async ({ email, verification_token }) => {
  if (!email || !String(email).trim()) {
    return { status: 400, body: { success: false, message: 'Please provide a valid email' } };
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  if (isDisposableEmail(normalizedEmail)) {
    return disposableEmailErrorResponse();
  }
  const alreadyVerified = await User.findOne({ email: normalizedEmail, is_verified: { $ne: false } })
    .select('_id')
    .lean();
  if (alreadyVerified) {
    return {
      status: 400,
      body: { success: false, code: 'ALREADY_VERIFIED', message: 'Account already verified. Please log in.' },
    };
  }

  let pending = verification_token ? await loadPendingSignupFromToken(verification_token) : null;
  if (pending && pending.email !== normalizedEmail) pending = null;
  if (!pending) return invalidSignupSessionResponse();

  const now = new Date();
  const window = signupCodeWindow(pending, now);
  if (window.wrong >= MAX_TOTAL_SIGNUP_ATTEMPTS) return signupCodeLimitResponse(window.retryMinutes, 'wrong');
  if (window.codes >= MAX_SIGNUP_CODES_PER_WINDOW) return signupCodeLimitResponse(window.retryMinutes);

  const cooldown = resendCooldownResponse(pending, now);
  if (cooldown) return cooldown;

  const otp = randomOtp();
  const updated = await PendingSignup.findOneAndUpdate(
    {
      _id: pending._id,
      session_nonce: pending.session_nonce,
      otp_hash: pending.otp_hash,
    },
    {
      $set: {
        otp_hash: hashCode(signupCodeScope(pending.email), otp),
        otp_expires_at: new Date(now.getTime() + OTP_TTL_MS),
        otp_attempts: 0,
        codes_in_window: window.codes + 1,
        window_started_at: window.started,
        total_attempts: window.wrong,
      },
      $inc: { resend_count: 1 },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) {
    return {
      status: 409,
      body: { success: false, code: 'OTP_REPLACED', message: 'A new code was just sent. Please check your inbox.' },
    };
  }

  const sent = await sendSignupOtpEmail({
    email: normalizedEmail,
    first_name: pending.first_name || '',
    last_name: pending.last_name || '',
    otp,
  });
  if (!sent) {
    const newHash = hashCode(signupCodeScope(pending.email), otp);
    await PendingSignup.updateOne(
      { _id: pending._id, otp_hash: newHash },
      {
        $set: {
          otp_hash: pending.otp_hash,
          otp_expires_at: pending.otp_expires_at,
          otp_attempts: Number(pending.otp_attempts || 0),
          codes_in_window: Number(pending.codes_in_window ?? 0),
          window_started_at: pending.window_started_at || pending.createdAt || null,
          total_attempts: Number(pending.total_attempts || 0),
        },
        $inc: { resend_count: -1 },
      },
    );
    return emailSendFailedResponse();
  }

  return {
    status: 200,
    body: {
      success: true,
      message: 'A new code has been sent to your email.',
      verificationToken: signSignupToken(updated),
    },
  };
};
