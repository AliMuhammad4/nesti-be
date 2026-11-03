import sendEmail, { isResendConfigured } from '../../utils/sendEmail.js';
import NewsletterSubscriber from '../../models/NewsletterSubscriber.js';

function frontendBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.CLIENT_URL || '')
    .replace(/\/+$/, '');
}

export function newsletterUnsubscribePath(token) {
  const key = String(token || '').trim();
  if (!key) return '';
  return `/newsletter/unsubscribe?token=${encodeURIComponent(key)}`;
}

export function newsletterUnsubscribeUrl(token) {
  const base = frontendBaseUrl();
  const path = newsletterUnsubscribePath(token);
  if (!base || !path) return path;
  return `${base}${path}`;
}

export function newsletterEmailFooter({ unsubscribeUrl, listName = 'The Ravinna Report' }) {
  const list = String(listName || 'The Ravinna Report').trim() || 'The Ravinna Report';
  const link = String(unsubscribeUrl || '').trim();
  const text = link
    ? `You are receiving ${list}. Unsubscribe anytime: ${link}`
    : `You are receiving ${list}. Reply to this email if you want to unsubscribe.`;
  const html = link
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">You are receiving <strong>${list}</strong>. <a href="${link}" style="color:#1F6F4A;">Unsubscribe</a> anytime.</p>`
    : `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">You are receiving <strong>${list}</strong>.</p>`;
  return { text, html, listUnsubscribe: link || '' };
}

export async function ensureNewsletterSubscriber(email, listName = 'The Ravinna Report') {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return null;
  let row = await NewsletterSubscriber.findOne({ email: address });
  if (row) {
    row.list_name = String(listName || row.list_name || 'The Ravinna Report');
    row.consent = true;
    row.unsubscribed_at = null;
    if (!row.unsubscribe_token) row.unsubscribe_token = NewsletterSubscriber.token();
    await row.save();
    return row;
  }
  return NewsletterSubscriber.create({
    email: address,
    list_name: String(listName || 'The Ravinna Report'),
    consent: true,
    unsubscribe_token: NewsletterSubscriber.token(),
  });
}

/**
 * Every outbound Ravinna Report / list email must go through here so the
 * unsubscribe footer is always present (welcome and future campaigns).
 */
export async function sendNewsletterCampaignEmail({
  subscriber,
  subject,
  text,
  html,
  idempotencyKey,
}) {
  if (!subscriber?.email) return { sent: false, reason: 'missing_subscriber' };
  if (subscriber.unsubscribed_at) return { sent: false, reason: 'unsubscribed' };
  if (!isResendConfigured()) return { sent: false, reason: 'not_configured' };

  const unsubscribeUrl = newsletterUnsubscribeUrl(subscriber.unsubscribe_token);
  const footer = newsletterEmailFooter({
    unsubscribeUrl,
    listName: subscriber.list_name || 'The Ravinna Report',
  });
  const bodyText = [String(text || '').trim(), footer.text].filter(Boolean).join('\n\n');
  const bodyHtml = `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
      ${String(html || '').trim() || `<p>${String(text || '').replace(/</g, '&lt;')}</p>`}
      ${footer.html}
    </div>
  `;

  const result = await sendEmail({
    email: subscriber.email,
    subject: String(subject || 'The Ravinna Report').trim() || 'The Ravinna Report',
    message: bodyText,
    htmlMessage: bodyHtml,
    idempotencyKey:
      String(idempotencyKey || '').trim()
      || `newsletter:${subscriber.email}:${Date.now()}`,
  });
  if (!result?.success) {
    return { sent: false, reason: 'send_failed', error: result?.error, unsubscribeUrl };
  }
  return { sent: true, unsubscribeUrl };
}

export async function sendNewsletterWelcomeEmail(subscriber) {
  return sendNewsletterCampaignEmail({
    subscriber,
    subject: 'You are on The Ravinna Report',
    text: [
      'Thanks for joining The Ravinna Report.',
      'We will send market notes and product updates to this address.',
    ].join('\n\n'),
    html: `
      <p>Thanks for joining <strong>The Ravinna Report</strong>.</p>
      <p>We will send market notes and product updates to this address.</p>
    `,
    idempotencyKey: `newsletter-welcome:${subscriber.email}:${subscriber.unsubscribe_token}`,
  });
}
