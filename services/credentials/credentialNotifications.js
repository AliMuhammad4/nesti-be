import User from '../../models/User.js';
import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import { USER_ROLE } from '../../constants/roles.js';
import { emitNotification } from '../realtime/workspaceSocket.js';
import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { FREE_TRIAL_DAYS } from '../billing/subscriptionLocalService.js';
import { displayNameOrFallback } from '../../utils/placeholderName.js';
import { CREDENTIAL_DOC_LABELS } from '../../constants/credentialDocuments.js';
import { renderCredentialsApprovedEmail, renderCredentialsNeedUpdatesEmail } from '../email/userLifecycleEmails.js';
import { BILLING_PLANS } from '../billing/plans.js';
import { FEATURES, hasFeature } from '../billing/entitlements.js';
import PublicProfile from '../../models/PublicProfile.js';
import { supportEmail } from '../../constants/support.js';
import { listStorefrontTemplateTiers } from '../billing/storefrontTemplates/tiers.js';

/** Web Page templates offered to this role: total and free (from the template catalog). */
function templateCountsForRole(role) {
  try {
    const list = (listStorefrontTemplateTiers() || []).filter((t) => t?.professional_type === role);
    return { total: list.length, free: list.filter((t) => t?.tier === 'free').length };
  } catch {
    return null;
  }
}

function appBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

async function persistAndEmit(userId, payload) {
  const doc = await ProfessionalNotification.create({
    user_id: userId,
    notification_type: payload.notification_type,
    title: payload.title,
    body: payload.body,
    severity: payload.severity || 'info',
    action: payload.action || null,
    details: payload.details || null,
  });
  emitNotification(userId, {
    id: String(doc._id),
    notification_type: doc.notification_type,
    title: doc.title,
    body: doc.body,
    severity: doc.severity,
    action: doc.action,
    createdAt: doc.createdAt,
  });
  return doc;
}

/** Returns { email_status, provider_id?, error? } for audit meta. */
async function safeEmail({ to, subject, html, text = '', replyTo = '' }) {
  const email = String(to || '').trim();
  if (!email) {
    logger.warn('Credential notification email skipped: missing recipient');
    return { email_status: 'skipped', error: 'missing_recipient' };
  }
  try {
    const result = await sendEmail({
      email,
      subject,
      message: String(text || '').trim() || String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      htmlMessage: html,
      ...(replyTo ? { replyTo } : {}),
    });
    if (result && result.success === false) {
      const error = result.error?.message || 'unknown';
      logger.warn('Credential notification email failed', { to: email, error });
      return { email_status: 'failed', error };
    }
    return {
      email_status: 'sent',
      provider_id: result?.id || null,
    };
  } catch (error) {
    logger.warn('Credential notification email failed', { to: email, error: error?.message });
    return { email_status: 'failed', error: error?.message || 'send_failed' };
  }
}

async function getAdminUsers() {
  return User.find({ role: USER_ROLE.ADMIN, is_active: { $ne: false } })
    .select('_id email first_name last_name')
    .lean();
}

export async function notifyAdminsProfessionalSignup({ user }) {
  const admins = await getAdminUsers();
  const name = displayNameOrFallback(user, user.email);
  const title = 'New professional awaiting credentials';
  const body = `${name} (${user.role}) signed up and needs to upload verification documents.`;
  const link = `${appBaseUrl()}/admin/verifications`;
  const emailResults = [];

  await Promise.all(
    admins.map(async (admin) => {
      await persistAndEmit(admin._id, {
        notification_type: 'pro_signup_pending_docs',
        title,
        body,
        severity: 'info',
        action: { type: 'open_url', url: '/admin/verifications' },
        details: { user_id: String(user._id), role: user.role },
      });
      if (admin.email) {
        const emailMeta = await safeEmail({
          to: admin.email,
          subject: title,
          html: `<p>${body}</p><p><a href="${link}">Open verifications</a></p>`,
        });
        emailResults.push({ admin_id: String(admin._id), ...emailMeta });
      }
    }),
  );

  return { email_results: emailResults };
}

export async function notifyAdminsCredentialSubmitted({ user, profile }) {
  const admins = await getAdminUsers();
  const name = displayNameOrFallback(user, user.email);
  const title = 'Credentials submitted for review';
  const body = `${name} (${profile.professional_type || user.role}) submitted verification documents (${profile.country || 'n/a'} / ${profile.jurisdiction || 'n/a'}).`;
  const link = `${appBaseUrl()}/admin/verifications/${String(user._id)}`;
  const emailResults = [];

  await Promise.all(
    admins.map(async (admin) => {
      await persistAndEmit(admin._id, {
        notification_type: 'credential_submitted',
        title,
        body,
        severity: 'info',
        action: { type: 'open_url', url: `/admin/verifications/${String(user._id)}` },
        details: { user_id: String(user._id) },
      });
      if (admin.email) {
        const emailMeta = await safeEmail({
          to: admin.email,
          subject: title,
          html: `<p>${body}</p><p><a href="${link}">Review submission</a></p>`,
        });
        emailResults.push({ admin_id: String(admin._id), ...emailMeta });
      }
    }),
  );

  return { email_results: emailResults };
}

export async function notifyProfessionalCredentialApproved({ user, subscription }) {
  const trialEnd = subscription?.trial_end
    ? new Date(subscription.trial_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : '';
  const title = 'Credentials approved';
  const body = `Your license and credentials were approved. Your ${FREE_TRIAL_DAYS}-day free trial has started${trialEnd ? ` (ends ${trialEnd})` : ''}.`;
  await persistAndEmit(user._id, {
    notification_type: 'credential_approved',
    title,
    body,
    severity: 'info',
    action: { type: 'open_url', url: '/dashboard' },
  });
  let emailMeta = { email_status: 'skipped' };
  if (user.email) {
    let publicUrl = '';
    try {
      const page = await PublicProfile.findOne({ user_id: user._id }).select('slug').lean();
      if (page?.slug) publicUrl = `${appBaseUrl()}/p/${encodeURIComponent(page.slug)}`;
    } catch {
      /* the email still goes out without the page link */
    }
    const email = renderCredentialsApprovedEmail({
      firstName: user.first_name,
      role: user.role,
      templates: templateCountsForRole(user.role),
      trialDays: FREE_TRIAL_DAYS,
      trialEnd: subscription?.trial_end || null,
      trialStart: subscription?.trial_start || null,
      planKey: subscription?.plan_key || 'basic',
      status: subscription?.status || 'free_trial',
      publicUrl,
      features: {
        chatbot: hasFeature(subscription, FEATURES.CHATBOT_BASIC),
        assistant: hasFeature(subscription, FEATURES.ASSISTANT_PROFESSIONAL),
        leads: hasFeature(subscription, FEATURES.LEADS_CAPTURE),
        referrals: hasFeature(subscription, FEATURES.REFERRALS_MANUAL),
        propertyMatches: hasFeature(subscription, FEATURES.LEADS_INSIGHTS_ADVANCED),
        calendar: hasFeature(subscription, FEATURES.CALENDAR_INTEGRATION),
        voice: hasFeature(subscription, FEATURES.VOICE_AGENT),
      },
      plans: Object.values(BILLING_PLANS),
    });
    emailMeta = await safeEmail({ to: user.email, subject: email.subject, html: email.html, text: email.text, replyTo: supportEmail() });
  }
  return { email_meta: emailMeta };
}

export async function notifyProfessionalCredentialRejected({ user, reason, documentTypes = [] }) {
  const title = 'Credentials need updates';
  const fileLabels = [...new Set((documentTypes || []).map((type) => CREDENTIAL_DOC_LABELS[type] || String(type || '')))].filter(Boolean);
  const filesText = fileLabels.length ? ` Upload again: ${fileLabels.join(', ')}.` : ' Upload your documents again.';
  const body = `Your license and credentials need updates. Reviewer's note: ${reason || 'none'}.${filesText} Then resubmit from License & Credentials.`;
  await persistAndEmit(user._id, {
    notification_type: 'credential_rejected',
    title,
    body,
    severity: 'high',
    action: { type: 'open_url', url: '/settings?tab=verification' },
    details: { reason, ...(fileLabels.length ? { needs_update: fileLabels } : {}) },
  });
  let emailMeta = { email_status: 'skipped' };
  if (user.email) {
    const email = renderCredentialsNeedUpdatesEmail({ firstName: user.first_name, reason, fileLabels, role: user.role });
    emailMeta = await safeEmail({ to: user.email, subject: email.subject, html: email.html, text: email.text, replyTo: supportEmail() });
  }
  return { email_meta: emailMeta };
}
