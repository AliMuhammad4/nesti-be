import User from '../../../models/User.js';
import ProfessionalNotification from '../../../models/ProfessionalNotification.js';
import EnterpriseInquiry from '../../../models/EnterpriseInquiry.js';
import NurtureLog from '../../../models/NurtureLog.js';
import { emitAdminPlatformLead, emitNotification } from '../../realtime/workspaceSocket.js';
import sendEmail from '../../../utils/sendEmail.js';
import logger from '../../../utils/logger.js';
import { loadLandingChatSettings } from './landingChatConfig.js';

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

export async function notifyAdminsOfAdminLead({ inquiry, body: bodyOverride = '' }) {
  if (!inquiry?._id) return { notified: 0 };
  const name = text(inquiry.full_name) || 'New visitor';
  const audience = roleLabel(inquiry.interest_role);
  const href = adminLeadHref(inquiry._id);
  const title = 'New admin lead';
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
  });
}

export async function syncLandingChatsOntoDesk() {
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

export async function maybeLandingSideEffects({ leadMatch, contactInfo }) {
  const settings = await loadLandingChatSettings().catch(() => null);
  if (!leadMatch?._id) return;
  await placeLandingChatOnSubscriptionDesk({ leadMatch, contactInfo });
  const email = text(contactInfo?.email || leadMatch.compatibility_factors?.contact?.email).toLowerCase();
  const name = text(contactInfo?.name || leadMatch.compatibility_factors?.contact?.name);
  if (!settings?.auto_welcome_followup || !email) return;
  const already = await NurtureLog.exists({
    lead_match_id: leadMatch._id,
    automation_type: 'landing_welcome',
    status: 'sent',
  });
  if (already) return;
  const subject = 'Thanks for talking with Nesti';
  const message = `Hi ${name || 'there'}, thanks for chatting with Nesti. A specialist can walk you through the plan that fits your work. Reply to this email if you want a follow-up.`;
  const result = await sendEmail({ email, subject, message });
  await NurtureLog.create({
    user_id: leadMatch.user_id,
    lead_match_id: leadMatch._id,
    lead_profile_id: leadMatch.lead_profile_id || null,
    conversation_id: leadMatch.conversation_id || null,
    to_email: email,
    subject,
    body: message,
    status: result?.success ? 'sent' : 'failed',
    automation_type: 'landing_welcome',
    idempotency_key: `landing_welcome:${String(leadMatch._id)}`,
  });
  if (!result?.success) {
    logger.warn('Landing welcome email was not sent', { lead_match_id: String(leadMatch._id) });
  }
}
