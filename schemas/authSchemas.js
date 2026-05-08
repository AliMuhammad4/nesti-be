import { Joi, passthrough } from './common.js';

export const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  first_name: Joi.string().min(1).required(),
  last_name: Joi.string().min(1).required(),
  role: Joi.string().optional(),
  invite_token: Joi.string().min(12).optional(),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
  invite_token: Joi.string().min(12).optional(),
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resetPasswordSchema = Joi.object({
  newPassword: Joi.string().min(6).required(),
});

export const otpWithEmailSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.alternatives(Joi.string(), Joi.number()).required(),
});

export const verifyEmailSchema = Joi.object({
  otp: Joi.alternatives(Joi.string(), Joi.number()).required(),
  invite_token: Joi.string().min(12).optional(),
});

export const googleAuthSchema = passthrough;

export const emailOnlySchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resendVerificationSchema = Joi.object({
  email: Joi.string().email().required(),
  verification_token: Joi.string().optional(),
});
