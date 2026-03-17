import express from 'express';
const router = express.Router();
import { signup, verifyEmail, login, profile, google, googleSignup, publicProfile, changePassword, forgotPassword, resetPassword, verifyResetOtp, checkEmail, resendVerification } from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

router.post('/signup', signup);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.post('/google', google);
router.post('/google-signup', googleSignup);
router.get('/profile', protect, profile);
router.get('/public-profile', publicProfile);
router.post('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-reset-otp', verifyResetOtp);
router.post('/check-email', checkEmail);
router.post('/resend-verification', resendVerification);

export default router;
