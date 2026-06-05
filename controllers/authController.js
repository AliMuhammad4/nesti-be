import {
  signupService,
  verifyEmailService,
  loginService,
  profileService,
  publicProfileService,
  changePasswordService,
  forgotPasswordService,
  verifyResetOtpService,
  resetPasswordService,
  checkEmailService,
  resendVerificationService,
} from '../services/auth/authService.js';

const send = (res, result) => {
  res.status(result.status).json(result.body);
};

const signup = async (req, res, next) => {
  try {
    send(res, await signupService(req.body));
  } catch (error) {
    next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    send(
      res,
      await verifyEmailService({
        verificationToken: req.headers.authorization || req.headers.token,
        otp: req.body.otp,
        invite_token: req.body.invite_token,
      })
    );
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    send(res, await loginService(req.body));
  } catch (error) {
    next(error);
  }
};

const profile = async (req, res, next) => {
  try {
    const refreshFromStripe = ['1', 'true', 'yes'].includes(
      String(req.query?.refresh_subscription || '').trim().toLowerCase(),
    );
    send(res, await profileService(req.user, { refreshFromStripe }));
  } catch (error) {
    next(error);
  }
};

const stub = (req, res) => res.json({ success: true, message: 'Not implemented yet' });

const changePassword = async (req, res, next) => {
  try {
    send(
      res,
      await changePasswordService({
        userId: req.user._id,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
      })
    );
  } catch (error) {
    next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    send(res, await forgotPasswordService(req.body));
  } catch (error) {
    next(error);
  }
};

const verifyResetOtp = async (req, res, next) => {
  try {
    send(res, await verifyResetOtpService(req.body));
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    send(
      res,
      await resetPasswordService({
        resetToken: req.headers.authorization || req.headers['reset-token'] || req.headers.token,
        newPassword: req.body.newPassword,
      })
    );
  } catch (error) {
    next(error);
  }
};

const google = stub;
const googleSignup = stub;
const publicProfile = async (req, res, next) => {
  try {
    send(res, await publicProfileService(req.query.email));
  } catch (error) {
    next(error);
  }
};
const checkEmail = async (req, res, next) => {
  try {
    send(res, await checkEmailService(req.body));
  } catch (error) {
    next(error);
  }
};

const resendVerification = async (req, res, next) => {
  try {
    send(
      res,
      await resendVerificationService({
        email: req.body?.email,
        verification_token: req.body?.verification_token,
      })
    );
  } catch (error) {
    next(error);
  }
};

export {
  signup,
  verifyEmail,
  login,
  profile,
  google,
  googleSignup,
  publicProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyResetOtp,
  checkEmail,
  resendVerification,
};
