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
  googleAuthSchema,
  emailOnlySchema,
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

router.post('/signup', validateBody(signupSchema), signup);
router.post('/verify-email', validateBody(verifyEmailSchema), verifyEmail);
router.post('/login', validateBody(loginSchema), login);
router.post('/google', validateBody(googleAuthSchema), google);
router.post('/google-signup', validateBody(googleAuthSchema), googleSignup);
router.get('/profile', protect, profile);
router.get('/public-profile', publicProfile);
router.post('/change-password', protect, validateBody(changePasswordSchema), changePassword);
router.post('/forgot-password', validateBody(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validateBody(resetPasswordSchema), resetPassword);
router.post('/verify-reset-otp', validateBody(otpWithEmailSchema), verifyResetOtp);
router.post('/check-email', validateBody(emailOnlySchema), checkEmail);
router.post('/resend-verification', validateBody(emailOnlySchema), resendVerification);

export default router;
