import express from 'express';
const router = express.Router();
import { validateBody } from '../middleware/validate.js';
import {
  signupSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  otpWithEmailSchema,
  verifyEmailSchema,
  googleLoginSchema,
  googleSignupSchema,
  emailOnlySchema,
  resendVerificationSchema,
} from '../schemas/authSchemas.js';
import {
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
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';
import {
  authGlobalLimiter,
  authSensitiveLimiter,
  authOtpVerifyLimiter,
  authUserLimiter,
} from '../middleware/rateLimit.js';

router.post('/signup', authGlobalLimiter, authSensitiveLimiter, validateBody(signupSchema), signup);
router.post('/verify-email', authGlobalLimiter, authOtpVerifyLimiter, validateBody(verifyEmailSchema), verifyEmail);
router.post('/login', authGlobalLimiter, authSensitiveLimiter, validateBody(loginSchema), login);
router.post('/google', authGlobalLimiter, authSensitiveLimiter, validateBody(googleLoginSchema), google);
router.post('/google-signup', authGlobalLimiter, authSensitiveLimiter, validateBody(googleSignupSchema), googleSignup);
router.get('/profile', protect, authUserLimiter, profile);
router.get('/public-profile', authGlobalLimiter, publicProfile);
router.post('/change-password', protect, authUserLimiter, validateBody(changePasswordSchema), changePassword);
router.post('/forgot-password', authGlobalLimiter, authSensitiveLimiter, validateBody(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authGlobalLimiter, authSensitiveLimiter, validateBody(resetPasswordSchema), resetPassword);
router.post('/verify-reset-otp', authGlobalLimiter, authSensitiveLimiter, validateBody(otpWithEmailSchema), verifyResetOtp);
router.post('/check-email', authGlobalLimiter, authOtpVerifyLimiter, validateBody(emailOnlySchema), checkEmail);
router.post('/resend-verification', authGlobalLimiter, authSensitiveLimiter, validateBody(resendVerificationSchema), resendVerification);

export default router;
