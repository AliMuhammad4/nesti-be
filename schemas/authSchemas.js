import { Joi } from './common.js';
import { SIGNUP_ROLE_VALUES } from '../constants/roles.js';
import { PASSWORD_POLICY_MESSAGE, isStrongPassword } from '../utils/passwordPolicy.js';
import { PHONE_INVALID_MESSAGE, normalizePhoneE164 } from '../utils/phone.js';

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

const personName = Joi.string()
  .trim()
  .max(60)
  .pattern(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u)
  .allow('')
  .optional()
  .messages({ 'string.pattern.base': 'Names can only use letters, spaces, apostrophes, hyphens and periods' });

export const signupSchema = Joi.object({
  email: emailField.required(),
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
