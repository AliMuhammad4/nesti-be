import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { USER_ROLE, USER_ROLE_VALUES } from '../../constants/roles.js';
import jwt from 'jsonwebtoken';
import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';

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

const queueSignupOtpEmail = ({ email, first_name, otp }) => {
  sendEmail({
    email,
    subject: 'Nesti AI - Verify Your Email',
    message: `Welcome to Nesti AI! Your email verification OTP is: ${otp}. It will expire in 10 minutes.`,
    htmlMessage: `
      <h1>Welcome to Nesti AI, ${first_name}!</h1>
      <p>Thank you for signing up. Please use the following One-Time Password (OTP) to verify your email address:</p>
      <h2 style="background: #f4f4f4; padding: 10px; display: inline-block; letter-spacing: 5px;">${otp}</h2>
      <p>This code will expire in 10 minutes.</p>
    `,
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
    htmlMessage: `
      <h1>Password Reset Request</h1>
      <p>Use the following One-Time Password (OTP) to reset your password:</p>
      <h2 style="background: #f4f4f4; padding: 10px; display: inline-block; letter-spacing: 5px;">${otp}</h2>
      <p>This code will expire in 10 minutes. If you did not request this, you can safely ignore this email.</p>
    `,
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
  const { email, password, first_name, last_name, role } = payload;

  if (!email || !password || !first_name || !last_name) {
    return { status: 400, body: { success: false, message: 'Please provide all required fields' } };
  }

  const assignedRole = role && USER_ROLE_VALUES.includes(role) ? role : USER_ROLE.AGENT;

  if (await User.findOne({ email })) {
    return { status: 400, body: { success: false, message: 'User already exists' } };
  }

  const otp = randomOtp();
  queueSignupOtpEmail({ email, first_name, otp });

  const verificationToken = signJwt(
    { email, password, first_name, last_name, role: assignedRole, otp },
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

export const verifyEmailService = async ({ verificationToken, otp }) => {
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

  const user = await User.create({
    email: decoded.email,
    password: decoded.password,
    first_name: decoded.first_name,
    last_name: decoded.last_name,
    role: decoded.role,
    is_verified: true,
    account_status: 'free_trial',
    trial_ends_at: trialEndsAt,
  });

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

  return {
    status: 200,
    body: {
      success: true,
      message: 'Email verified successfully and account created',
      token: signJwt({ id: user._id }, '30d'),
    },
  };
};

export const loginService = async ({ email, password }) => {
  const user = await User.findOne({ email });

  if (!user || !(await user.matchPassword(password))) {
    return { status: 401, body: { success: false, message: 'Invalid email or password' } };
  }

  if (!user.is_verified) {
    return { status: 403, body: { success: false, message: 'Email not verified' } };
  }

  if (user.account_status === 'free_trial' && user.trial_ends_at && new Date() > new Date(user.trial_ends_at)) {
    user.account_status = 'expired';
    await user.save();
  }

  return {
    status: 200,
    body: { success: true, token: signJwt({ id: user._id }, '30d') },
  };
};

export const profileService = async (user) => {
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: user._id })
    .select('-property_match_scoring')
    .lean();
  const hasIcpConfigured = Boolean(
    professionalProfile?.active_icp_profile_id
  );

  const trialExpired =
    user.account_status === 'free_trial' &&
    user.trial_ends_at &&
    new Date() > new Date(user.trial_ends_at);
  const isExpired = user.account_status === 'expired' || trialExpired;

  return {
    status: 200,
    body: {
      success: true,
      user: {
        name: `${user.first_name} ${user.last_name}`,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        accountStatus: user.account_status,
        trialEndsAt: user.trial_ends_at,
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

  const user = await User.findOne({ email });
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

  const user = await User.findOne({ email });
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
