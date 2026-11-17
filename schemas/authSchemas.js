import { Joi } from './common.js';
import { SIGNUP_ROLE_VALUES } from '../constants/roles.js';
import { PASSWORD_POLICY_MESSAGE, isStrongPassword } from '../utils/passwordPolicy.js';
import { PHONE_INVALID_MESSAGE, normalizePhoneE164 } from '../utils/phone.js';
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from '../services/auth/disposableEmailGuard.js';
import { PERSON_NAME_MAX, PERSON_NAME_MESSAGE, PERSON_NAME_PATTERN } from '../utils/personName.js';

const strongPassword = Joi.string()
  .max(128)
  .custom((value, helpers) => (isStrongPassword(value) ? value : helpers.message(PASSWORD_POLICY_MESSAGE)));

const mobilePhone = Joi.string()
  .trim()
  .max(40)
  .custom((value, helpers) => {
    const normalized = normalizePhoneE164(value);
    return normalized || helpers.message(PHONE_INVALID_MESSAGE);
  });

const emailField = Joi.string().trim().lowercase().email();

/** New accounts only: a disposable address is reported as an email error, like a bad format. */
const signupEmailField = emailField
  .messages({ 'string.email': 'Please enter a valid email address' })
  .custom((value, helpers) => (isDisposableEmail(value) ? helpers.message(DISPOSABLE_EMAIL_MESSAGE) : value));

const personName = Joi.string()
  .trim()
  .max(PERSON_NAME_MAX)
  .pattern(PERSON_NAME_PATTERN)
  .allow('')
  .optional()
  .messages({ 'string.pattern.base': PERSON_NAME_MESSAGE });

export const signupSchema = Joi.object({
  email: signupEmailField.required(),
  password: strongPassword.required(),
  first_name: personName,
  last_name: personName,
  phone: mobilePhone.required(),
  role: Joi.string().valid(...SIGNUP_ROLE_VALUES).required(),
  invite_token: Joi.string().min(12).optional(),
});

export const loginSchema = Joi.object({
  email: emailField.required(),
  password: Joi.string().required(),
  invite_token: Joi.string().min(12).optional(),
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: strongPassword.required(),
});

export const forgotPasswordSchema = Joi.object({
  email: emailField.required(),
});

export const resetPasswordSchema = Joi.object({
  newPassword: strongPassword.required(),
});

export const otpWithEmailSchema = Joi.object({
  email: emailField.required(),
  otp: Joi.alternatives(Joi.string(), Joi.number()).required(),
});

export const verifyEmailSchema = Joi.object({
  otp: Joi.alternatives(Joi.string(), Joi.number()).required(),
  invite_token: Joi.string().min(12).optional(),
});

export const googleLoginSchema = Joi.object({
  token: Joi.string().required(),
  token_type: Joi.string().valid('access_token', 'id_token').required(),
  invite_token: Joi.string().min(12).optional(),
});

export const googleSignupSchema = Joi.object({
  token: Joi.string().required(),
  token_type: Joi.string().valid('access_token', 'id_token').required(),
  role: Joi.string()
    .valid(...SIGNUP_ROLE_VALUES)
    .required(),
  phone: mobilePhone.required(),
  invite_token: Joi.string().min(12).optional(),
});

export const resendVerificationSchema = Joi.object({
  email: emailField.required(),
  verification_token: Joi.string().optional(),
});
