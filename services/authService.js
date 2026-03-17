import User from '../models/User.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import jwt from 'jsonwebtoken';
import sendEmail from '../utils/sendEmail.js';
import logger from '../utils/logger.js';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'secret', {
    expiresIn: '30d',
  });
};

const generateVerificationToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'secret', {
    expiresIn: '10m',
  });
};

const generateResetToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'secret', {
    expiresIn: '15m',
  });
};

export const signupService = async (payload) => {
  const { email, password, first_name, last_name, role } = payload;

  if (!email || !password || !first_name || !last_name) {
    return { status: 400, body: { success: false, message: 'Please provide all required fields' } };
  }

  const validRoles = ['agent', 'lawyer', 'mortgage_broker', 'admin'];
  const assignedRole = role && validRoles.includes(role) ? role : 'agent';

  const userExists = await User.findOne({ email });
  if (userExists) {
    return { status: 400, body: { success: false, message: 'User already exists' } };
  }

  const otp = Math.floor(10000 + Math.random() * 90000).toString();

  const message = `Welcome to Nesti AI! Your email verification OTP is: ${otp}. It will expire in 10 minutes.`;
  const htmlMessage = `
      <h1>Welcome to Nesti AI, ${first_name}!</h1>
      <p>Thank you for signing up. Please use the following One-Time Password (OTP) to verify your email address:</p>
      <h2 style="background: #f4f4f4; padding: 10px; display: inline-block; letter-spacing: 5px;">${otp}</h2>
      <p>This code will expire in 10 minutes.</p>
    `;

  // fire-and-forget
  sendEmail({
    email,
    subject: 'Nesti AI - Verify Your Email',
    message,
    htmlMessage,
  }).then((result) => {
    if (!result.success) {
      logger.error(`Background OTP email failed to send to ${email}`);
    }
  });

  const verificationToken = generateVerificationToken({
    email,
    password,
    first_name,
    last_name,
    role: assignedRole,
    otp,
  });

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

  let decoded;
  try {
    decoded = jwt.verify(verificationToken, process.env.JWT_SECRET || 'secret');
  } catch (err) {
    return {
      status: 400,
      body: { success: false, message: 'Verification session expired or invalid. Please sign up again.' },
    };
  }

  if (decoded.otp !== String(otp)) {
    return { status: 400, body: { success: false, message: 'Invalid OTP' } };
  }

  const trial_ends_at = new Date();
  trial_ends_at.setDate(trial_ends_at.getDate() + 3);

  const userExists = await User.findOne({ email: decoded.email });
  if (userExists) {
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
    trial_ends_at,
  });

  if (user.role !== 'admin') {
    await ProfessionalProfile.create({
      user_id: user._id,
      professional_type: user.role,
      full_name: `${user.first_name} ${user.last_name}`,
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      message: 'Email verified successfully and account created',
      token: generateToken(user._id),
    },
  };
};

export const loginService = async ({ email, password }) => {
  const user = await User.findOne({ email });

  if (user && (await user.matchPassword(password))) {
    if (!user.is_verified) {
      return { status: 403, body: { success: false, message: 'Email not verified' } };
    }

    if (user.account_status === 'free_trial' && user.trial_ends_at) {
      if (new Date() > new Date(user.trial_ends_at)) {
        user.account_status = 'expired';
        await user.save();
      }
    }

    return {
      status: 200,
      body: { success: true, token: generateToken(user._id) },
    };
  }

  return { status: 401, body: { success: false, message: 'Invalid email or password' } };
};

export const profileService = async (user) => {
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: user._id });

  const isExpired = user.account_status === 'expired' ||
    (user.account_status === 'free_trial' && user.trial_ends_at && new Date() > new Date(user.trial_ends_at));

  return {
    status: 200,
    body: {
      success: true,
      user: {
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        role: user.role,
        accountStatus: user.account_status,
        trialEndsAt: user.trial_ends_at,
        isExpired,
        ...(isExpired && { message: 'Account expired. Please upgrade.' }),
      },
      professionalProfile: professionalProfile || null,
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
      body: {
        success: false,
        message: 'No account found with that email address',
      },
    };
  }

  const otp = Math.floor(10000 + Math.random() * 90000).toString();

  user.reset_password_token = otp;
  user.reset_password_expires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  const message = `You requested a password reset. Your OTP is: ${otp}. It will expire in 10 minutes.`;
  const htmlMessage = `
      <h1>Password Reset Request</h1>
      <p>Use the following One-Time Password (OTP) to reset your password:</p>
      <h2 style="background: #f4f4f4; padding: 10px; display: inline-block; letter-spacing: 5px;">${otp}</h2>
      <p>This code will expire in 10 minutes. If you did not request this, you can safely ignore this email.</p>
    `;

  sendEmail({
    email: user.email,
    subject: 'Nesti AI - Password Reset OTP',
    message,
    htmlMessage,
  }).then((result) => {
    if (!result.success) {
      logger.error(`Password reset email failed to send to ${user.email}`);
    }
  });

  return {
    status: 200,
    body: {
      success: true,
      message: 'If an account with that email exists, a reset OTP has been sent',
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

  // OTP is valid; generate a short-lived reset token and clear OTP fields
  const resetToken = generateResetToken({ id: user._id, email: user.email });

  user.reset_password_token = undefined;
  user.reset_password_expires = undefined;
  await user.save();

  return {
    status: 200,
    body: {
      success: true,
      message: 'OTP verified successfully',
      resetToken,
    },
  };
};

export const resetPasswordService = async ({ resetToken, newPassword }) => {
  if (!resetToken || !newPassword) {
    return {
      status: 400,
      body: { success: false, message: 'Please provide reset token and new password' },
    };
  }

  let decoded;
  try {
    decoded = jwt.verify(resetToken, process.env.JWT_SECRET || 'secret');
  } catch (err) {
    return {
      status: 400,
      body: { success: false, message: 'Reset session expired or invalid. Please request a new OTP.' },
    };
  }

  const user = await User.findById(decoded.id);
  if (!user) {
    return { status: 400, body: { success: false, message: 'User not found for this reset session' } };
  }

  user.password = newPassword;
  await user.save();

  return { status: 200, body: { success: true, message: 'Password reset successfully' } };
};

