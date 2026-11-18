import sendEmail, { isResendConfigured } from '../../../utils/sendEmail.js';
import logger from '../../../utils/logger.js';
import { EMAIL_BRAND, EMAIL_GREEN_CTA_STYLE, EMAIL_LINK_STYLE, renderBrandedEmailShell } from '../../email/emailTheme.js';
import { supportContactUrl, supportEmail } from '../../../constants/support.js';
import { isPlaceholderName } from '../../../utils/placeholderName.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** Support line for account emails; the sending inbox is not monitored. */
function supportNoteHtml() {
  const url = escapeHtml(supportContactUrl());
  const email = escapeHtml(supportEmail());
  return `<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#718096;">Need help? Contact Nesti support through the <a href="${url}" style="${EMAIL_LINK_STYLE}">support form</a> or at <a href="mailto:${email}" style="${EMAIL_LINK_STYLE}">${email}</a>.</p>`;
}

function supportNoteText() {
  return `Need help? Contact Nesti support at ${supportEmail()} or through the support form: ${supportContactUrl()}`;
}

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
    </p>
    ${supportNoteHtml()}`;
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
    message: `Welcome to Nesti AI! Your email verification code is: ${otp}. It will expire in 10 minutes.\n\n${supportNoteText()}`,
    htmlMessage: brandOtpEmailHtml({
      title: `Welcome to Nesti AI${greetingName ? `, ${greetingName}` : ''}!`,
      subtitle: 'Use this code to verify your email address and complete your signup.',
      otp,
    }),
    // Signup waits on this send, so keep it short; the user can resend if it times out.
    timeoutMs: 5000,
    maxAttempts: 2,
  });
  if (!result?.success) {
    logger.error(`Signup code email failed to send to ${email}`);
    return false;
  }
  return true;
};

function frontendOrigin() {
  const raw = String(process.env.FRONTEND_URL || process.env.CLIENT_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : '';
}

/** Account-security notice: a title, short paragraphs and an optional button. */
function brandNoticeEmailHtml({ title, paragraphs = [], ctaLabel = '', ctaUrl = '' }) {
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4A5568;">${escapeHtml(text)}</p>`)
    .join('');
  const cta = ctaLabel && ctaUrl
    ? `<p style="margin:6px 0 0;"><a href="${escapeHtml(ctaUrl)}" style="${EMAIL_GREEN_CTA_STYLE}">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  return renderBrandedEmailShell({
    kicker: 'Nesti AI',
    title: 'Account security',
    innerHtml: `<h1 style="margin:0 0 12px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:22px;line-height:1.3;color:#2D3748;">${escapeHtml(title)}</h1>${body}${cta}${supportNoteHtml()}`,
    maxWidth: 560,
  });
}

/** Sends a notice in the background; skipped (logged) when email isn't set up outside production. */
function queueNoticeEmail({ email, subject, message, htmlMessage, label }) {
  if (process.env.NODE_ENV !== 'production' && !isResendConfigured()) {
    logger.warn(`Email is not configured; skipped ${label} email to ${email}`);
    return;
  }
  sendEmail({ email, subject, message, htmlMessage })
    .then((result) => {
      if (!result?.success) logger.error(`${label} email failed to send to ${email}`);
    })
    .catch((error) => logger.error(`${label} email failed to send to ${email}: ${error?.message || error}`));
}

/** Forgot password on a Google sign-in account: there is no password, so point to Google. */
export const queueGoogleSignInReminderEmail = (email) => {
  const origin = frontendOrigin();
  const loginUrl = origin ? `${origin}/log-in` : '';
  const paragraphs = [
    'Someone asked to reset the password for this email address.',
    'This account signs in with Google, so it has no Nesti AI password to reset. Use "Continue with Google" on the login page instead.',
    'If you did not ask for this, you can ignore this email.',
  ];
  queueNoticeEmail({
    email,
    label: 'Google sign-in reminder',
    subject: 'Nesti AI - Sign in with Google',
    message: `${paragraphs.join(' ')}${loginUrl ? ` Log in: ${loginUrl}` : ''}\n\n${supportNoteText()}`,
    htmlMessage: brandNoticeEmailHtml({ title: 'Sign in with Google', paragraphs, ctaLabel: 'Go to login', ctaUrl: loginUrl }),
  });
};

/** Sent to the account owner after a password reset or change, so an unexpected change is noticed. */
export const queuePasswordChangedEmail = (email, { via = 'change', at = new Date() } = {}) => {
  const origin = frontendOrigin();
  const resetUrl = origin ? `${origin}/forgot-password` : '';
  const when = `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const paragraphs = [
    `The password for your Nesti AI account (${email}) was ${via === 'reset' ? 'reset with an emailed code' : 'changed from account settings'} on ${when}.`,
    'Other devices that were signed in have been signed out.',
    'If you made this change, no action is needed. If you did not, reset your password right away and contact support.',
  ];
  queueNoticeEmail({
    email,
    label: 'Password changed notice',
    subject: 'Nesti AI - Your password was changed',
    message: `${paragraphs.join(' ')}${resetUrl ? ` Reset your password: ${resetUrl}` : ''}\n\n${supportNoteText()}`,
    htmlMessage: brandNoticeEmailHtml({ title: 'Your password was changed', paragraphs, ctaLabel: 'Reset password', ctaUrl: resetUrl }),
  });
};

export const queuePasswordResetEmail = (email, otp) => {
  sendEmail({
    email,
    subject: 'Nesti AI - Password Reset Code',
    message: `You requested a password reset. Your code is: ${otp}. It will expire in 10 minutes.\n\n${supportNoteText()}`,
    htmlMessage: brandOtpEmailHtml({
      title: 'Password reset request',
      subtitle: 'Use this code to continue resetting your password.',
      otp,
      footerNote: 'If you did not request this, you can safely ignore this email.',
    }),
  }).then((result) => {
    if (!result.success) {
      logger.error(`Password reset email failed to send to ${email}`);
    }
  });
};
