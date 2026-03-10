import {
  signupService,
  verifyEmailService,
  loginService,
  profileService,
  changePasswordService,
  forgotPasswordService,
  verifyResetOtpService,
  resetPasswordService,
} from '../services/authService.js';

const signup = async (req, res, next) => {
  try {
    const result = await signupService(req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const { otp } = req.body;
    const verificationToken = req.headers.authorization || req.headers.token;

    const result = await verifyEmailService({ verificationToken, otp });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const result = await loginService(req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

const profile = async (req, res, next) => {
  try {
    const result = await profileService(req.user);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

// other controller methods: google, publicProfile, changePassword, etc.
const stub = (req, res) => res.json({ success: true, message: 'Not implemented yet' });

const changePassword = async (req, res, next) => {
  try {
    const result = await changePasswordService({
      userId: req.user._id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const result = await forgotPasswordService(req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

const verifyResetOtp = async (req, res, next) => {
  try {
    const result = await verifyResetOtpService(req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const resetToken =
      req.headers.authorization || req.headers['reset-token'] || req.headers.token;

    const result = await resetPasswordService({
      resetToken,
      newPassword: req.body.newPassword,
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
};

const google = stub;
const googleSignup = stub;
const publicProfile = stub;
const checkEmail = stub;
const resendVerification = stub;

export {
  signup, verifyEmail, login, profile,
  google, googleSignup, publicProfile,
  changePassword, forgotPassword, resetPassword,
  verifyResetOtp, checkEmail, resendVerification,
};
