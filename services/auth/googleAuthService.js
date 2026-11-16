import User from '../../models/User.js';
import PendingSignup from '../../models/PendingSignup.js';
import { USER_ROLE, isSignupRole } from '../../constants/roles.js';
import {
  PHONE_INVALID_MESSAGE,
  PHONE_TAKEN_MESSAGE,
  isPhoneDuplicateError,
  normalizePhoneE164,
} from '../../utils/phone.js';
import { ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE } from '../../constants/accountStatus.js';
import { disposableEmailErrorResponse, isDisposableEmail } from './disposableEmailGuard.js';

import { signSessionToken } from './helpers/authTokens.js';
import { verifyGoogleToken, isGoogleAuthUser, isSameFreshGoogleSignup } from './helpers/googleAuth.js';
import { phoneBelongsToAnotherUser, phoneHeldByOtherPending } from './helpers/phoneChecks.js';
import {
  bootstrapProfessionalProfile,
  finalizeInviteForUser,
  resolveUserLoginPresentation,
  newClientTrialFields,
} from './helpers/profileHelpers.js';

async function googleSignupSuccessResponse(user) {
  return {
    status: 201,
    body: {
      success: true,
      message: 'Signed up with Google successfully',
      token: signSessionToken(user),
      role: user.role,
      user: await resolveUserLoginPresentation(user),
    },
  };
}

export const googleSignupService = async ({ token, token_type, role, phone, invite_token }) => {
  if (!isSignupRole(role)) {
    return { status: 400, body: { success: false, code: 'ROLE_INVALID', message: 'Please select a valid account type' } };
  }
  if (!String(phone || '').trim()) {
    return { status: 400, body: { success: false, code: 'PHONE_REQUIRED', message: 'Please enter your mobile number' } };
  }
  const normalizedPhone = normalizePhoneE164(phone);
  if (!normalizedPhone) {
    return { status: 400, body: { success: false, code: 'PHONE_INVALID', message: PHONE_INVALID_MESSAGE } };
  }

  let googleProfile;
  try {
    googleProfile = await verifyGoogleToken({ token, token_type });
  } catch (error) {
    return { status: error?.status || 401, body: { success: false, message: error.message } };
  }

  const existing = await User.findOne({ email: googleProfile.email });
  if (existing) {
    if (!isGoogleAuthUser(existing)) {
      return {
        status: 409,
        body: {
          success: false,
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'This email is already registered with email and password. Please log in with your email.',
        },
      };
    }
    if (isSameFreshGoogleSignup(existing, googleProfile)) {
      return googleSignupSuccessResponse(existing);
    }
    return {
      status: 409,
      body: {
        success: false,
        code: 'GOOGLE_ACCOUNT_EXISTS',
        message: 'This Google account already has a Nesti account. Log in with Google instead.',
      },
    };
  }

  if (isDisposableEmail(googleProfile.email)) {
    return disposableEmailErrorResponse();
  }
  const waitingSignup = await PendingSignup.findOne({ email: googleProfile.email })
    .select('expires_at')
    .lean();
  if (waitingSignup && new Date(waitingSignup.expires_at) > new Date()) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'SIGNUP_ALREADY_PENDING',
        message: 'This email is already waiting for a verification code. Finish that code, or wait until it expires, before continuing with Google.',
      },
    };
  }
  if (
    (await phoneBelongsToAnotherUser(normalizedPhone))
    || (await phoneHeldByOtherPending(normalizedPhone, googleProfile.email))
  ) {
    return { status: 400, body: { success: false, code: 'PHONE_TAKEN', message: PHONE_TAKEN_MESSAGE } };
  }

  let user;
  try {
    user = await User.create({
      email: googleProfile.email,
      first_name: googleProfile.first_name,
      last_name: googleProfile.last_name,
      phone: normalizedPhone,
      role,
      is_verified: true,
      auth_provider: 'google',
      google_id: googleProfile.google_id,
      ...(role === USER_ROLE.CLIENT ? newClientTrialFields() : {}),
    });
  } catch (error) {
    if (error?.code === 11000) {
      if (isPhoneDuplicateError(error)) {
        return { status: 400, body: { success: false, code: 'PHONE_TAKEN', message: PHONE_TAKEN_MESSAGE } };
      }
      const raced = await User.findOne({ email: googleProfile.email });
      if (raced && isSameFreshGoogleSignup(raced, googleProfile)) {
        return googleSignupSuccessResponse(raced);
      }
      return {
        status: 409,
        body: {
          success: false,
          code: 'GOOGLE_ACCOUNT_EXISTS',
          message: 'This Google account already has a Nesti account. Log in with Google instead.',
        },
      };
    }
    throw error;
  }

  await bootstrapProfessionalProfile(user);
  finalizeInviteForUser({
    invite_token,
    userId: user._id,
    method: 'google_signup',
    path: '/auth/google-signup',
  });

  return googleSignupSuccessResponse(user);
};

export const googleLoginService = async ({ token, token_type, invite_token }) => {
  let googleProfile;
  try {
    googleProfile = await verifyGoogleToken({ token, token_type });
  } catch (error) {
    return { status: error?.status || 401, body: { success: false, message: error.message } };
  }

  const user = await User.findOne({ email: googleProfile.email });
  if (!user) {
    return {
      status: 404,
      body: {
        success: false,
        message: 'No Google account found for this email. Please sign up first.',
      },
    };
  }
  if (user.auth_provider !== 'google') {
    return {
      status: 400,
      body: {
        success: false,
        message: 'This account uses email/password login. Please sign in with email.',
      },
    };
  }

  if (user.is_active === false) {
    return {
      status: 401,
      body: { success: false, code: ACCOUNT_SUSPENDED_CODE, message: ACCOUNT_SUSPENDED_MESSAGE },
    };
  }

  if (user.google_id && googleProfile.google_id && user.google_id !== googleProfile.google_id) {
    return {
      status: 401,
      body: {
        success: false,
        message: 'This Google account does not match the one linked to this email. Please use the original Google account.',
      },
    };
  }
  if (!user.is_verified) {
    user.is_verified = true;
  }
  if (googleProfile.google_id && !user.google_id) {
    user.google_id = googleProfile.google_id;
  }
  if (user.isModified('is_verified') || user.isModified('google_id')) {
    await user.save();
  }

  finalizeInviteForUser({
    invite_token,
    userId: user._id,
    method: 'google_login',
    path: '/auth/google',
  });

  const userPresentation = await resolveUserLoginPresentation(user);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Logged in with Google successfully',
      token: signSessionToken(user),
      role: user.role,
      user: userPresentation,
    },
  };
};
