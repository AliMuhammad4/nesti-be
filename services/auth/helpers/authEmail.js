import sendEmail, { isResendConfigured } from '../../../utils/sendEmail.js';
import logger from '../../../utils/logger.js';
import { EMAIL_BRAND, renderBrandedEmailShell } from '../../email/emailTheme.js';
import { isPlaceholderName } from '../../../utils/placeholderName.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function brandOtpEmailHtml({ title, subtitle, otp, footerNote = '' }) {
  const safeTitle = escapeHtml(String(title || '').trim());
  const safeSubtitle = escapeHtml(String(subtitle || '').trim());
  const safeOtp = escapeHtml(String(otp || '').trim());
  const safeFooter = escapeHtml(String(footerNote || '').trim());
  const content = `
    <h1 style="margin:0 0 8px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:22px;line-height:1.3;color:#2D3748;">${safeTitle}</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#4A5568;">${safeSubtitle}</p>
    <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #bdecc8;border-radius:10px;background:#f2fff6;text-align:center;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_BRAND.primaryDark};margin-bottom:6px;">One-time password</div>
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif;font-size:34px;font-weight:800;letter-spacing:0.18em;color:#1f8b3d;">${safeOtp}</div>
    </div>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#718096;">
      This code expires in <strong style="color:#2D3748;">10 minutes</strong>. ${safeFooter}
    </p>`;
  return renderBrandedEmailShell({
    kicker: 'Nesti AI',
    title: 'Account security',
    innerHtml: content,
    maxWidth: 560,
  });
}

export const sendSignupOtpEmail = async ({ email, first_name, last_name, otp }) => {
  if (process.env.NODE_ENV !== 'production' && !isResendConfigured()) {
    logger.warn(`Email is not configured; signup code for ${email} is ${otp}`);
    return true;
  }
  const greetingName = isPlaceholderName(first_name, last_name) ? '' : String(first_name || '').trim();
  const result = await sendEmail({
    email,
    subject: 'Nesti AI - Verify Your Email',
    message: `Welcome to Nesti AI! Your email verification code is: ${otp}. It will expire in 10 minutes.`,
    htmlMessage: brandOtpEmailHtml({
      title: `Welcome to Nesti AI${greetingName ? `, ${greetingName}` : ''}!`,
      subtitle: 'Use this code to verify your email address and complete your signup.',
      otp,
    }),
    timeoutMs: 8000,
    maxAttempts: 2,
  });
  if (!result?.success) {
    logger.error(`Signup code email failed to send to ${email}`);
    return false;
  }
  return true;
};

export const queuePasswordResetEmail = (email, otp) => {
  sendEmail({
    email,
    subject: 'Nesti AI - Password Reset OTP',
    message: `You requested a password reset. Your OTP is: ${otp}. It will expire in 10 minutes.`,
    htmlMessage: brandOtpEmailHtml({
      title: 'Password reset request',
      subtitle: 'Use this OTP to continue resetting your password.',
      otp,
      footerNote: 'If you did not request this, you can safely ignore this email.',
    }),
  }).then((result) => {
    if (!result.success) {
      logger.error(`Password reset email failed to send to ${email}`);
    }
  });
};
