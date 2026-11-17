import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { renderAccountReinstatedEmail, renderAccountSuspendedEmail } from '../email/userLifecycleEmails.js';
import { supportEmail } from '../../constants/support.js';

/** Same Nesti account layout as the other account emails; copy lives in userLifecycleEmails.js. */
export function renderAccountSuspendedEmailHtml({ firstName = '', reason = '', role = '' } = {}) {
  return renderAccountSuspendedEmail({ firstName, reason, role }).html;
}

export function buildAccountSuspendedMail({ email, firstName = '', reason = '', role = '' } = {}) {
  const recipient = String(email || '').trim().toLowerCase();
  const rendered = renderAccountSuspendedEmail({
    firstName: String(firstName || '').trim(),
    reason: String(reason || '').trim(),
    role,
  });
  return {
    email: recipient,
    subject: rendered.subject,
    message: rendered.text,
    htmlMessage: rendered.html,
  };
}

export function renderAccountReinstatedEmailHtml({ firstName = '', role = '' } = {}) {
  return renderAccountReinstatedEmail({ firstName, role }).html;
}

export function buildAccountReinstatedMail({ email, firstName = '', role = '' } = {}) {
  const recipient = String(email || '').trim().toLowerCase();
  const rendered = renderAccountReinstatedEmail({ firstName: String(firstName || '').trim(), role });
  return {
    email: recipient,
    subject: rendered.subject,
    message: rendered.text,
    htmlMessage: rendered.html,
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
    replyTo: supportEmail(),
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
      role: user?.role,
    }),
    'Account suspended email',
  );
}

export async function notifyUserAccountReinstated(user) {
  return sendAccountStatusMail(
    buildAccountReinstatedMail({
      email: user?.email,
      firstName: user?.first_name,
      role: user?.role,
    }),
    'Account reinstated email',
  );
}
