import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { EMAIL_BRAND, renderBrandedEmailShell } from '../email/emailTheme.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function renderAccountSuspendedEmailHtml({ firstName = '', reason = '' } = {}) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const reasonBlock = reason
    ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:${EMAIL_BRAND.body};">Reason provided:</p>
       <p style="margin:8px 0 0;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid ${EMAIL_BRAND.border};font-size:14px;line-height:1.55;color:${EMAIL_BRAND.heading};">${escapeHtml(reason)}</p>`
    : '';
  const loginUrl = `${appBaseUrl()}/log-in`;
  const innerHtml = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${EMAIL_BRAND.heading};">${greeting}</p>
    <p style="margin:0;font-size:14px;line-height:1.55;color:${EMAIL_BRAND.body};">
      Your Nesti account has been suspended. You will not be able to sign in until an administrator restores access.
    </p>
    ${reasonBlock}
    <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:${EMAIL_BRAND.body};">
      If you believe this was a mistake, reply to this email or contact support.
    </p>
    <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:${EMAIL_BRAND.muted};">
      Sign-in page: <a href="${loginUrl}" style="color:${EMAIL_BRAND.link};font-weight:600;">${loginUrl}</a>
    </p>
  `;
  return renderBrandedEmailShell({
    kicker: 'Account status',
    title: 'Your account is suspended',
    innerHtml,
    maxWidth: 560,
  });
}

export function buildAccountSuspendedMail({ email, firstName = '', reason = '' } = {}) {
  const recipient = String(email || '').trim().toLowerCase();
  const cleanReason = String(reason || '').trim();
  const cleanName = String(firstName || '').trim();
  return {
    email: recipient,
    subject: 'Your Nesti account has been suspended',
    message: [
      cleanName ? `Hi ${cleanName},` : 'Hi,',
      'Your Nesti account has been suspended. You will not be able to sign in until an administrator restores access.',
      cleanReason ? `Reason provided: ${cleanReason}` : '',
      'If you believe this was a mistake, contact support.',
    ].filter(Boolean).join('\n\n'),
    htmlMessage: renderAccountSuspendedEmailHtml({ firstName: cleanName, reason: cleanReason }),
  };
}

export function renderAccountReinstatedEmailHtml({ firstName = '' } = {}) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const loginUrl = `${appBaseUrl()}/log-in`;
  const innerHtml = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${EMAIL_BRAND.heading};">${greeting}</p>
    <p style="margin:0;font-size:14px;line-height:1.55;color:${EMAIL_BRAND.body};">
      Your Nesti account has been reinstated. You can sign in again and continue using your workspace.
    </p>
    <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:${EMAIL_BRAND.muted};">
      Sign-in page: <a href="${loginUrl}" style="color:${EMAIL_BRAND.link};font-weight:600;">${loginUrl}</a>
    </p>
  `;
  return renderBrandedEmailShell({
    kicker: 'Account status',
    title: 'Your account has been reinstated',
    innerHtml,
    maxWidth: 560,
  });
}

export function buildAccountReinstatedMail({ email, firstName = '' } = {}) {
  const recipient = String(email || '').trim().toLowerCase();
  const cleanName = String(firstName || '').trim();
  return {
    email: recipient,
    subject: 'Your Nesti account has been reinstated',
    message: [
      cleanName ? `Hi ${cleanName},` : 'Hi,',
      'Your Nesti account has been reinstated. You can sign in again and continue using your workspace.',
    ].join('\n\n'),
    htmlMessage: renderAccountReinstatedEmailHtml({ firstName: cleanName }),
  };
}

async function sendAccountStatusMail(mail, label) {
  if (!mail.email) {
    logger.warn(`${label} skipped: missing recipient`);
    return { success: false, skipped: true };
  }

  logger.info(`Sending ${label}`, { email: mail.email });
  const result = await sendEmail({
    ...mail,
    timeoutMs: 10000,
    maxAttempts: 2,
  });
  if (!result?.success) {
    logger.error(`${label} failed`, {
      email: mail.email,
      error: result?.error?.message || 'unknown',
    });
  }
  return result;
}

export async function notifyUserAccountSuspended(user, { reason } = {}) {
  return sendAccountStatusMail(
    buildAccountSuspendedMail({
      email: user?.email,
      firstName: user?.first_name,
      reason: reason ?? user?.suspended_reason,
    }),
    'Account suspended email',
  );
}

export async function notifyUserAccountReinstated(user) {
  return sendAccountStatusMail(
    buildAccountReinstatedMail({
      email: user?.email,
      firstName: user?.first_name,
    }),
    'Account reinstated email',
  );
}
