
import logger from '../../../utils/logger.js';
import sendEmail from '../../../utils/sendEmail.js';

function smtpConfigured() {
  return Boolean(
    process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS
  );
}

function normEmail(e) {
  if (!e || typeof e !== 'string') return '';
  return e.trim().toLowerCase();
}

function agentEmailCopyEnabled() {
  const v = String(process.env.POST_BOOKING_AGENT_EMAIL_COPY ?? 'true').toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

export async function sendVisitorAndAgentCopy(ctx, { visitorSubject, html, text }) {
  if (!ctx.inviteeEmail) {
    return { status: 'skipped', detail: 'no_invitee_email' };
  }
  if (!smtpConfigured()) {
    return { status: 'skipped', detail: 'smtp_not_configured' };
  }

  const visitorSend = await sendEmail({
    email:       ctx.inviteeEmail,
    subject:     visitorSubject,
    message:     text,
    htmlMessage: html,
  });
  if (!visitorSend.success) {
    return { status: 'failed', detail: String(visitorSend.error?.message || 'send_failed') };
  }

  const inviteeNorm = normEmail(ctx.inviteeEmail);
  const agentNorm = normEmail(ctx.agentUser?.email);
  const sameInbox = Boolean(inviteeNorm && agentNorm && inviteeNorm === agentNorm);

  if (ctx.agentUser?.email && agentEmailCopyEnabled() && !sameInbox) {
    const agentCopy = await sendEmail({
      email:       ctx.agentUser.email,
      subject:     `[Nesti] Copy: ${visitorSubject}`,
      message:     `Copy of materials sent to the client at ${ctx.inviteeEmail}. Open the HTML version for the full message.`,
      htmlMessage: html,
    });
    if (!agentCopy.success) {
      logger.warn('postBooking: agent copy failed', {
        err:     agentCopy.error?.message,
        subject: visitorSubject,
      });
    }
  } else if (sameInbox) {
    logger.debug('postBooking: skipping agent copy (same address as invitee)', {
      email_domain: inviteeNorm.split('@')[1] || null,
    });
  }

  return { status: 'completed' };
}
