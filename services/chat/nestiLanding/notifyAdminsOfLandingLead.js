import User from '../../../models/User.js';
import ProfessionalNotification from '../../../models/ProfessionalNotification.js';
import EnterpriseInquiry from '../../../models/EnterpriseInquiry.js';
import NurtureLog from '../../../models/NurtureLog.js';
import { emitAdminPlatformLead, emitNotification } from '../../realtime/workspaceSocket.js';
import { sendIdempotentEmail } from '../../email/emailDeliveryService.js';
import logger from '../../../utils/logger.js';
import { EMAIL_FONT, renderBrandedEmailShell } from '../../email/emailTheme.js';
import { landingWelcomeCopy, loadLandingChatSettings } from './landingChatConfig.js';

function text(value) {
  return String(value || '').trim();
}

function contactName(leadMatch) {
  return text(leadMatch?.compatibility_factors?.contact?.name) || 'New visitor';
}

function roleLabel(value) {
  return text(value).replaceAll('_', ' ') || 'visitor';
}

function adminLeadHref(inquiryId) {
  return inquiryId ? `/admin/leads/detail/${inquiryId}` : '/admin/leads';
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function landingWelcomeHtml({ subject, message, joinUrl, botName }) {
  const paragraphs = text(message)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Join Nesti:'))
    .map((line) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#334155;font-family:${EMAIL_FONT.body};">${escapeHtml(line)}</p>`)
    .join('');
  const innerHtml = `
    ${paragraphs}
    <p style="margin:22px 0 0;">
      <a href="${escapeHtml(joinUrl)}" style="display:inline-block;background:#0a6b3a;color:#ffffff !important;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;font-family:${EMAIL_FONT.body};">Join Nesti</a>
    </p>
    <p style="margin:14px 0 0;font-size:13px;line-height:1.55;color:#64748b;font-family:${EMAIL_FONT.body};">
      Or open this link: <a href="${escapeHtml(joinUrl)}" style="color:#0a6b3a;font-weight:600;">${escapeHtml(joinUrl)}</a>
    </p>`;
  return renderBrandedEmailShell({
    kicker: escapeHtml(botName || 'Nesti'),
    title: escapeHtml(subject),
    innerHtml,
    headerFrom: '#0a6b3a',
    headerTo: '#004b25',
    maxWidth: 600,
  });
}

async function inquiryIdForLandingLead(leadMatch, sessionId) {
  const email = text(leadMatch?.compatibility_factors?.contact?.email).toLowerCase();
  const sid = text(sessionId);
  if (sid) {
    const bySession = await EnterpriseInquiry.findOne({ session_id: sid, source: 'landing_chat' }).select('_id').lean();
    if (bySession?._id) return String(bySession._id);
  }
  if (email) {
    const byEmail = await EnterpriseInquiry.findOne({ email, source: 'landing_chat' }).select('_id').lean();
    if (byEmail?._id) return String(byEmail._id);
  }
  return '';
}

export async function listLandingLeadAdmins() {
  return User.find({ role: 'admin' }).select('_id role admin_permissions').lean();
}

export async function notifyAdminsOfLandingLead({ leadMatch, conversationId, sessionId }) {
  if (!leadMatch?._id) return { notified: 0 };
  const name = contactName(leadMatch);
  const audience = roleLabel(leadMatch.compatibility_factors?.audience_role);
  const inquiryId = await inquiryIdForLandingLead(leadMatch, sessionId);
  const href = adminLeadHref(inquiryId);
  const title = 'New admin lead';
  const body = `${name} (${audience}) started a homepage chat and is on the admin lead list.`;
  const admins = await listLandingLeadAdmins();
  emitAdminPlatformLead({
    schema: 1,
    kind: 'landing_lead_created',
    lead_match_id: String(leadMatch._id),
    inquiry_id: inquiryId,
    name,
    audience_role: audience,
    href,
  });

  for (const admin of admins) {
    const doc = await ProfessionalNotification.create({
      user_id: admin._id,
      notification_type: 'lead_created',
      title,
      body,
      severity: 'info',
      action: { type: 'open_lead', lead_match_id: String(leadMatch._id), href },
      lead_match_id: leadMatch._id,
      conversation_id: conversationId || null,
      session_id: sessionId || null,
      intent: 'unspecified',
    });
    emitNotification(admin._id, {
      notification_id: doc?._id ? String(doc._id) : null,
      notification_type: 'lead_created',
      title,
      body,
      severity: 'info',
      action: { type: 'open_lead', lead_match_id: String(leadMatch._id), href },
      lead_match_id: String(leadMatch._id),
    });
  }
  return { notified: admins.length };
}

export async function notifyAdminsOfAdminLead({ inquiry, body: bodyOverride = '', title: titleOverride = '' }) {
  if (!inquiry?._id) return { notified: 0 };
  const name = text(inquiry.full_name) || 'New visitor';
  const audience = roleLabel(inquiry.interest_role);
  const href = adminLeadHref(inquiry._id);
  const title = text(titleOverride) || 'New admin lead';
  const body = text(bodyOverride) || `${name} (${audience}) started a homepage chat and is on the admin lead list.`;
  const admins = await listLandingLeadAdmins();
  emitAdminPlatformLead({
    schema: 1,
    kind: 'landing_lead_created',
    inquiry_id: String(inquiry._id),
    name,
    audience_role: audience,
    href,
  });
  let notified = 0;
  for (const admin of admins) {
    try {
      const doc = await ProfessionalNotification.create({
        user_id: admin._id,
        notification_type: 'lead_created',
        title,
        body,
        severity: 'info',
        action: { type: 'open_lead', href, inquiry_id: String(inquiry._id) },
        intent: 'unspecified',
      });
      emitNotification(admin._id, {
        notification_id: doc?._id ? String(doc._id) : null,
        notification_type: 'lead_created',
        title,
        body,
        severity: 'info',
        action: { type: 'open_lead', href, inquiry_id: String(inquiry._id) },
      });
      notified += 1;
    } catch (error) {
      logger.warn('Admin lead notification was not saved', { error: error?.message, admin_id: String(admin._id) });
    }
  }
  if (!notified) {
    logger.warn('Admin lead was created with no admin notification', { inquiry_id: String(inquiry._id), admins: admins.length });
  }
  return { notified };
}

export async function placeLandingChatOnSubscriptionDesk({ leadMatch, contactInfo }) {
  const factors = leadMatch?.compatibility_factors || {};
  const contact = contactInfo || factors.contact || {};
  const email = text(contact.email).toLowerCase();
  const phone = text(contact.phone);
  const name = text(contact.name);
  if (!email && !phone) return null;
  const existing = email
    ? await EnterpriseInquiry.findOne({ email, source: 'landing_chat' }).select('_id').lean()
    : await EnterpriseInquiry.findOne({ phone, source: 'landing_chat' }).select('_id').lean();
  if (existing) return existing;
  return EnterpriseInquiry.create({
    email,
    phone,
    full_name: name,
    company_name: name || 'Homepage chat',
    interest_role: text(factors.audience_role) || 'client',
    source: 'landing_chat',
    message: text(factors.message_snippet),
    status: 'pending',
    pipeline_stage: 'new',
  });
}

let lastDeskSyncAt = 0;
const DESK_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

export async function syncLandingChatsOntoDesk(force = false) {
  const settings = await loadLandingChatSettings().catch(() => null);
  if (!settings?.dual_write_inquiry) return;
  const now = Date.now();
  if (!force && now - lastDeskSyncAt < DESK_SYNC_COOLDOWN_MS) {
    return;
  }
  lastDeskSyncAt = now;
  const LeadMatch = (await import('../../../models/LeadMatch.js')).default;
  const leads = await LeadMatch.find({ 'compatibility_factors.source': 'landing_chat' })
    .sort({ createdAt: -1 })
    .limit(40)
    .select('compatibility_factors')
    .lean();
  for (const lead of leads) {
    await placeLandingChatOnSubscriptionDesk({ leadMatch: lead });
  }
}

export async function sendLandingThanksEmail({ email, name, idempotencyKey }) {
  const to = text(email).toLowerCase();
  if (!to) return { sent: false };
  const settings = await loadLandingChatSettings().catch(() => null);
  if (!settings?.auto_welcome_followup) return { sent: false };
  const { subject, message, joinUrl, botName } = landingWelcomeCopy(settings, name);
  const result = await sendIdempotentEmail({
    email: to,
    subject,
    message,
    htmlMessage: landingWelcomeHtml({ subject, message, joinUrl, botName }),
    idempotencyKey: idempotencyKey || `landing_welcome:${to}`,
    source: 'landing_welcome',
  });
  return { sent: Boolean(result?.success), duplicate: Boolean(result?.duplicate), subject, message, to };
}

export async function recordLandingWelcomeOnAdminLead({ leadMatchId, email, sent }) {
  if (!sent?.sent || !leadMatchId) return false;
  const recipient = text(sent.to || email).toLowerCase();
  if (!recipient) return false;
  const inquiry = await EnterpriseInquiry.findOne({ email: recipient, source: 'landing_chat' })
    .sort({ createdAt: -1 })
    .select('_id')
    .lean();
  if (!inquiry?._id) return false;
  const idempotencyKey = `landing_welcome:${String(leadMatchId)}`;
  await EnterpriseInquiry.updateOne(
    { _id: inquiry._id, 'guide_emails.idempotency_key': { $ne: idempotencyKey } },
    {
      $push: {
        guide_emails: {
          to_email: recipient,
          subject: sent.subject || '',
          body: sent.message || '',
          type: 'automatic',
          status: 'sent',
          idempotency_key: idempotencyKey,
          sent_at: new Date(),
        },
      },
    },
  );
  return true;
}

export async function maybeLandingSideEffects({ leadMatch, contactInfo }) {
  const settings = await loadLandingChatSettings().catch(() => null);
  if (!leadMatch?._id) return;
  if (settings?.dual_write_inquiry) {
    await placeLandingChatOnSubscriptionDesk({ leadMatch, contactInfo });
  }
  const email = text(contactInfo?.email || leadMatch.compatibility_factors?.contact?.email).toLowerCase();
  const name = text(contactInfo?.name || leadMatch.compatibility_factors?.contact?.name);
  if (!email) return;
  const already = await NurtureLog.exists({
    lead_match_id: leadMatch._id,
    automation_type: 'landing_welcome',
    status: 'sent',
  });
  if (already) return;
  const sent = await sendLandingThanksEmail({
    email,
    name,
    idempotencyKey: `landing_welcome:${String(leadMatch._id)}`,
  });
  if (sent.sent) {
    await recordLandingWelcomeOnAdminLead({ leadMatchId: leadMatch._id, email, sent }).catch((error) => {
      logger.warn('Landing welcome email was not added to the admin lead history', {
        error: error?.message,
        lead_match_id: String(leadMatch._id),
      });
    });
  }
  if (!sent.sent && !sent.subject) return;
  const { subject, message, to } = sent;
  await NurtureLog.create({
    user_id: leadMatch.user_id,
    lead_match_id: leadMatch._id,
    lead_profile_id: leadMatch.lead_profile_id || null,
    conversation_id: leadMatch.conversation_id || null,
    to_email: to || email,
    subject,
    body: message,
    status: sent.sent ? 'sent' : 'failed',
    automation_type: 'landing_welcome',
    idempotency_key: `landing_welcome:${String(leadMatch._id)}`,
  });
  if (!sent.sent) {
    logger.warn('Landing welcome email was not sent', { lead_match_id: String(leadMatch._id) });
  }
}
