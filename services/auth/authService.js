import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { USER_ROLE, USER_ROLE_VALUES } from '../../constants/roles.js';
import { evaluateProfessionalProfileSetup } from '../../utils/professionalProfileSetup.js';
import jwt from 'jsonwebtoken';
import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { EMAIL_BRAND, renderBrandedEmailShell } from '../email/emailTheme.js';
import { finalizeInviteAttribution } from '../referral/inviteService.js';
import {
  createFreeTrialSubscription,
  getSubscriptionPresentationForUser,
} from '../billing/subscriptionService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const signJwt = (payload, expiresIn) => jwt.sign(payload, JWT_SECRET, { expiresIn });

const tryVerifyJwt = (token) => {
  try {
    return { ok: true, payload: jwt.verify(token, JWT_SECRET) };
  } catch {
    return { ok: false };
  }
};

const randomOtp = () => Math.floor(10000 + Math.random() * 90000).toString();

function brandOtpEmailHtml({ title, subtitle, otp, footerNote = '' }) {
  const safeTitle = String(title || '').trim();
  const safeSubtitle = String(subtitle || '').trim();
  const safeOtp = String(otp || '').trim();
  const safeFooter = String(footerNote || '').trim();
  const content = `
    <h1 style="margin:0 0 8px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:22px;line-height:1.3;color:#2D3748;">${safeTitle}</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#4A5568;">${safeSubtitle}</p>
    <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #bdecc8;border-radius:10px;background:#f2fff6;text-align:center;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_BRAND.primaryDark};margin-bottom:6px;">One-time password</div>
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:34px;font-weight:800;letter-spacing:0.18em;color:#1f8b3d;">${safeOtp}</div>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#718096;">
      This code expires in <strong style="color:#2D3748;">10 minutes</strong>. ${safeFooter}
    </p>`;
  return renderBrandedEmailShell({
    kicker: 'Nesti AI',
    title: 'Account security',
    innerHtml: content,
    maxWidth: 560,
  });
}

const queueSignupOtpEmail = ({ email, first_name, otp }) => {
  sendEmail({
    email,
    subject: 'Nesti AI - Verify Your Email',
    message: `Welcome to Nesti AI! Your email verification OTP is: ${otp}. It will expire in 10 minutes.`,
    htmlMessage: brandOtpEmailHtml({
      title: `Welcome to Nesti AI${first_name ? `, ${first_name}` : ''}!`,
      subtitle: 'Use this OTP to verify your email address and complete your signup.',
      otp,
    }),
  }).then((result) => {
    if (!result.success) {
      logger.error(`Background OTP email failed to send to ${email}`);
    }
  });
};

const queuePasswordResetEmail = (email, otp) => {
  sendEmail({
    email,
    subject: 'Nesti AI - Password Reset OTP',
    message: `You requested a password reset. Your OTP is: ${otp}. It will expire in 10 minutes.`,
    htmlMessage: brandOtpEmailHtml({
      title: 'Password reset request',
      subtitle: 'Use this OTP to continue resetting your password.',
      otp,
      footerNote: 'If you did not request this, you can safely ignore this email.',
    }),
  }).then((result) => {
    if (!result.success) {
      logger.error(`Password reset email failed to send to ${email}`);
    }
  });
};

function normalizeProfessionalProfile(profileDoc) {
  const p = profileDoc || {};
  return {
    ...p,
    full_name: p.full_name || '',
    website: p.website || '',
    company_name: p.company_name || '',
    certificates: Array.isArray(p.certificates) ? p.certificates : [],
    phone: p.phone || '',
    location: p.location || '',
    target_neighborhoods: p.target_neighborhoods || '',
    experience: p.experience || '',
    license_number: p.license_number || '',
    social_media: p.social_media || '',
    transaction_volume: p.transaction_volume || '',
    avg_sale_price: p.avg_sale_price || '',
    response_time: p.response_time || '',
    availability: p.availability || '',
    support_level: p.support_level || '',
    negotiation_style: p.negotiation_style || '',
    sales_approach: p.sales_approach || '',
    energy_style: p.energy_style || '',
    personality_tag: p.personality_tag || '',
    awards: p.awards || '',
    specializations: Array.isArray(p.specializations) ? p.specializations : [],
    communication_channels: Array.isArray(p.communication_channels) ? p.communication_channels : [],
    preferred_clients: Array.isArray(p.preferred_clients) ? p.preferred_clients : [],
    calendly_link: p.calendly_link || '',
    bio: p.bio || '',
  };
}

export const signupService = async (payload) => {
  const { email, password, first_name, last_name, role, invite_token } = payload;
  const normalizedEmail = String(email || '').toLowerCase().trim();

  if (!normalizedEmail || !password || !first_name || !last_name) {
    return { status: 400, body: { success: false, message: 'Please provide all required fields' } };
  }

  const assignedRole = role && USER_ROLE_VALUES.includes(role) ? role : USER_ROLE.AGENT;

  if (await User.findOne({ email: normalizedEmail })) {
    return { status: 400, body: { success: false, message: 'User already exists' } };
  }

  const otp = randomOtp();
  queueSignupOtpEmail({ email: normalizedEmail, first_name, otp });

  const verificationToken = signJwt(
    { email: normalizedEmail, password, first_name, last_name, role: assignedRole, otp, invite_token: invite_token || '' },
    '10m'
  );

  return {
    status: 201,
    body: {
      success: true,
      message: 'OTP sent successfully. Please verify to create your account.',
      verificationToken,
    },
  };
};

export const verifyEmailService = async ({ verificationToken, otp, invite_token }) => {
  if (!verificationToken) {
    return {
      status: 401,
      body: { success: false, message: 'Not authorized, no verification token found in headers' },
    };
  }
  if (!otp) {
    return { status: 400, body: { success: false, message: 'Please provide the OTP' } };
  }

  const verified = tryVerifyJwt(verificationToken);
  if (!verified.ok) {
    return {
      status: 400,
      body: { success: false, message: 'Verification session expired or invalid. Please sign up again.' },
    };
  }
  const decoded = verified.payload;

  if (decoded.otp !== String(otp)) {
    return { status: 400, body: { success: false, message: 'Invalid OTP' } };
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 3);

  if (await User.findOne({ email: decoded.email })) {
    return {
      status: 400,
      body: { success: false, message: 'Account already verified. Please login.' },
    };
  }

  let user;
  try {
    user = await User.create({
      email: decoded.email,
      password: decoded.password,
      first_name: decoded.first_name,
      last_name: decoded.last_name,
      role: decoded.role,
      is_verified: true,
    });
    await createFreeTrialSubscription(user._id, trialEndsAt);
  } catch (error) {
    if (error?.code === 11000) {
      return {
        status: 400,
        body: { success: false, message: 'Account already verified. Please login.' },
      };
    }
    throw error;
  }

  if (user.role !== USER_ROLE.ADMIN) {
    await ProfessionalProfile.create({
      user_id: user._id,
      professional_type: user.role,
      full_name: `${user.first_name} ${user.last_name}`,
    });
    if (user.role === USER_ROLE.AGENT) {
      const { ensureAgentPropertyMatchScoring } = await import('../agent/propertyMatch/scoringConfig.js');
      await ensureAgentPropertyMatchScoring(user._id);
    }
  }

  const inviteTokenFromPayload = String(invite_token || decoded?.invite_token || '').trim();
  if (inviteTokenFromPayload) {
    try {
      const finResult = await finalizeInviteAttribution({
        invite_token: inviteTokenFromPayload,
        authenticated_user_id: user._id,
        method: 'signup_verify_email',
        path: '/auth/verify-email',
      });
      if (finResult?.ok === false) {
        logger.warn('Invite attribution finalization failed after verify-email', {
          user_id: String(user._id),
          code: finResult.code,
          message: finResult.message,
        });
      }
    } catch (err) {
      logger.warn('Invite attribution finalization failed after verify-email', {
        user_id: String(user._id),
        error: err?.message,
      });
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      message: 'Email verified successfully and account created',
      token: signJwt({ id: user._id }, '30d'),
    },
  };
};

export const loginService = async ({ email, password, invite_token }) => {
  const user = await User.findOne({ email });

  if (!user || !(await user.matchPassword(password))) {
    return { status: 401, body: { success: false, message: 'Invalid email or password' } };
  }

  if (!user.is_verified) {
    return { status: 403, body: { success: false, message: 'Email not verified' } };
  }

  if (invite_token && String(invite_token).trim()) {
    const normalizedInviteToken = String(invite_token).trim();
    finalizeInviteAttribution({
      invite_token: normalizedInviteToken,
      authenticated_user_id: user._id,
      method: 'login',
      path: '/auth/login',
    })
      .then((finResult) => {
        if (finResult?.ok === false) {
          logger.warn('Invite attribution finalization failed after login', {
            user_id: String(user._id),
            code: finResult.code,
            message: finResult.message,
          });
        }
      })
      .catch((err) => {
        logger.warn('Invite attribution finalization failed after login', {
          user_id: String(user._id),
          error: err?.message,
        });
      });
  }

  return {
    status: 200,
    body: { success: true, token: signJwt({ id: user._id }, '30d') },
  };
};

export const profileService = async (user, { refreshFromStripe = false } = {}) => {
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: user._id })
    .select('-property_match_scoring')
    .lean();
  const hasIcpConfigured = Boolean(
    professionalProfile?.active_icp_profile_id
  );

  const subscription = await getSubscriptionPresentationForUser(user, {
    refreshFromStripe,
  });
  const isExpired = subscription.isExpired;

  const profileSetup =
    user.role === USER_ROLE.ADMIN
      ? {
          personal_complete: true,
          business_complete: true,
          is_complete: true,
          missing_fields: [],
        }
      : evaluateProfessionalProfileSetup(user, professionalProfile);

  return {
    status: 200,
    body: {
      success: true,
      // ICP is optional; gates use personal + business basics only (see requireCompleteProfessionalProfile).
      profile_setup: { ...profileSetup, icp_is_separate_from_workspace_basics: true },
      user: {
        id: String(user._id),
        _id: String(user._id),
        name: `${user.first_name} ${user.last_name}`,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        profile_image: user.profile_image || null,
        cover_image: user.cover_image || null,
        accountStatus: subscription.accountStatus,
        trialEndsAt: subscription.trialEndsAt,
        subscriptionPlan: subscription.subscriptionPlan,
        subscriptionStatus: subscription.subscriptionStatus,
        subscriptionEndsAt: subscription.subscriptionEndsAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        pendingPlanKey: subscription.pendingPlanKey,
        pendingPlanEffectiveAt: subscription.pendingPlanEffectiveAt,
        isExpired,
        ...(isExpired && { message: 'Account expired. Please upgrade.' }),
      },
      professionalProfile: professionalProfile
        ? {
            ...normalizeProfessionalProfile(professionalProfile),
            has_icp_configured: hasIcpConfigured,
          }
        : null,
    },
  };
};

export const publicProfileService = async (email) => {
  if (!email || !String(email).trim()) {
    return { status: 400, body: { success: false, message: 'Please provide a valid email' } };
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).lean();
  if (!user) {
    return { status: 404, body: { success: false, message: 'User not found' } };
  }

  const professionalProfile = await ProfessionalProfile.findOne({ user_id: user._id })
    .select('-property_match_scoring')
    .lean();

  return {
    status: 200,
    body: {
      success: true,
      user: {
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email,
        role: user.role,
      },
      professionalProfile: professionalProfile
        ? normalizeProfessionalProfile(professionalProfile)
        : null,
    },
  };
};

export const checkEmailService = async ({ email }) => {
  if (!email || !String(email).trim()) {
    return { status: 400, body: { success: false, message: 'Please provide a valid email' } };
  }
  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail }).select('_id is_verified').lean();
  return {
    status: 200,
    body: {
      success: true,
      exists: Boolean(existing),
      is_verified: Boolean(existing?.is_verified),
    },
  };
};

export const resendVerificationService = async ({ email, verification_token }) => {
  if (!email || !String(email).trim()) {
    return { status: 400, body: { success: false, message: 'Please provide a valid email' } };
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const alreadyVerified = await User.findOne({ email: normalizedEmail }).select('_id').lean();
  if (alreadyVerified) {
    return {
      status: 400,
      body: { success: false, message: 'Account already verified. Please login.' },
    };
  }

  if (!verification_token || !String(verification_token).trim()) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Verification session missing. Please sign up again.',
      },
    };
  }

  const verified = tryVerifyJwt(String(verification_token).trim());
  if (!verified.ok) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Verification session expired or invalid. Please sign up again.',
      },
    };
  }
  const decoded = verified.payload || {};
  if (String(decoded.email || '').toLowerCase().trim() !== normalizedEmail) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Verification session does not match this email. Please sign up again.',
      },
    };
  }

  const otp = randomOtp();
  queueSignupOtpEmail({
    email: normalizedEmail,
    first_name: decoded.first_name || '',
    otp,
  });

  const refreshedVerificationToken = signJwt(
    {
      email: normalizedEmail,
      password: decoded.password,
      first_name: decoded.first_name,
      last_name: decoded.last_name,
      role: decoded.role,
      invite_token: decoded.invite_token || '',
      otp,
    },
    '10m',
  );

  return {
    status: 200,
    body: {
      success: true,
      message: 'A new OTP has been sent to your email.',
      verificationToken: refreshedVerificationToken,
    },
  };
};

export const changePasswordService = async ({ userId, currentPassword, newPassword }) => {
  if (!currentPassword || !newPassword) {
    return {
      status: 400,
      body: { success: false, message: 'Please provide both current and new passwords' },
    };
  }

  const user = await User.findById(userId);
  if (!user || !(await user.matchPassword(currentPassword))) {
    return { status: 401, body: { success: false, message: 'Incorrect current password' } };
  }

  user.password = newPassword;
  await user.save();

  return { status: 200, body: { success: true, message: 'Password updated successfully' } };
};

export const forgotPasswordService = async ({ email }) => {
  if (!email) {
    return { status: 400, body: { success: false, message: 'Please provide an email address' } };
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    return {
      status: 404,
      body: { success: false, message: 'No account found with that email address' },
    };
  }

  const otp = randomOtp();
  user.reset_password_token = otp;
  user.reset_password_expires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  queuePasswordResetEmail(user.email, otp);

  return {
    status: 200,
    body: {
      success: true,
      message: 'A reset code has been sent to your email.',
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

  if (user.reset_password_token !== String(otp)) {
    return { status: 400, body: { success: false, message: 'Invalid OTP' } };
  }

  if (new Date() > new Date(user.reset_password_expires)) {
    return { status: 400, body: { success: false, message: 'OTP has expired' } };
  }

  const resetToken = signJwt({ id: user._id, email: user.email }, '15m');

  user.reset_password_token = undefined;
  user.reset_password_expires = undefined;
  await user.save();

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

  const verified = tryVerifyJwt(resetToken);
  if (!verified.ok) {
    return {
      status: 400,
      body: { success: false, message: 'Reset session expired or invalid. Please request a new OTP.' },
    };
  }
  const decoded = verified.payload;

  const user = await User.findById(decoded.id);
  if (!user) {
    return { status: 400, body: { success: false, message: 'User not found for this reset session' } };
  }

  user.password = newPassword;
  await user.save();

  return { status: 200, body: { success: true, message: 'Password reset successfully' } };
};
