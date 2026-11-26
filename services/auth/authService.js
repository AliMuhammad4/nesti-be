/**
 * Auth service barrel — re-exports every public API from the focused modules.
 *
 * Consumer imports (`from '../services/auth/authService.js'`) stay unchanged.
 */

// Signup, verify-email, resend
export { signupService, verifyEmailService, resendVerificationService } from './signupService.js';

// Login
export { loginService } from './loginService.js';

// Google signup / login
export { googleSignupService, googleLoginService } from './googleAuthService.js';

// Profile & public profile
export { profileService, publicProfileService } from './profileService.js';

// Password flows
export {
  changePasswordService,
  forgotPasswordService,
  verifyResetOtpService,
  resetPasswordService,
} from './passwordService.js';

// Token helpers used by middleware
export { signSessionToken, SIGNUP_TOKEN_PURPOSE, PASSWORD_RESET_TOKEN_PURPOSE } from './helpers/authTokens.js';
