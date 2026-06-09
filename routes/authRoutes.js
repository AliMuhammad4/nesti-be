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
} from '../middleware/rateLimit.js';

router.use(authGlobalLimiter);

router.post('/signup', authSensitiveLimiter, validateBody(signupSchema), signup);
router.post('/verify-email', authOtpVerifyLimiter, validateBody(verifyEmailSchema), verifyEmail);
router.post('/login', authSensitiveLimiter, validateBody(loginSchema), login);
router.post('/google', authSensitiveLimiter, validateBody(googleLoginSchema), google);
router.post('/google-signup', authSensitiveLimiter, validateBody(googleSignupSchema), googleSignup);
router.get('/profile', protect, profile);
router.get('/public-profile', publicProfile);
router.post('/change-password', protect, validateBody(changePasswordSchema), changePassword);
router.post('/forgot-password', authSensitiveLimiter, validateBody(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authSensitiveLimiter, validateBody(resetPasswordSchema), resetPassword);
router.post('/verify-reset-otp', authSensitiveLimiter, validateBody(otpWithEmailSchema), verifyResetOtp);
router.post('/check-email', authOtpVerifyLimiter, validateBody(emailOnlySchema), checkEmail);
router.post('/resend-verification', authSensitiveLimiter, validateBody(resendVerificationSchema), resendVerification);

export default router;
