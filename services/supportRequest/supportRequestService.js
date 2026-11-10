import mongoose from 'mongoose';
import User from '../../models/User.js';
import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import ProfessionalSupportRequest, { SUPPORT_REQUEST_STATUSES } from '../../models/ProfessionalSupportRequest.js';
import sendEmail, { isResendConfigured } from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { buildPaginationMeta, parsePageLimitPagination } from '../../utils/pagination.js';
import { emitNotification } from '../realtime/workspaceSocket.js';
import { renderBrandedEmailShell } from '../email/emailTheme.js';

const OPEN_STATUSES = ['new', 'open', 'in_progress'];

const AGENT_TOPICS = { buy: 'Buying a property', sell: 'Selling a property', invest: 'Investment property' };
const LAWYER_TOPICS = {
  purchase_closing: 'Purchase closing',
  sale_closing: 'Sale closing',
  refinance_or_title_transfer: 'Refinancing or title transfer',
  contract_or_document_review: 'Contract or document review',
  commercial_real_estate: 'Commercial real estate',
  property_dispute_or_other: 'Property dispute or another matter',
};
const BROKER_TOPICS = {
  primary_residence: 'Buying a home (primary residence)',
  investment: 'Investment property financing',
  vacation_home: 'Vacation / second home',
  refinance: 'Refinance an existing mortgage',
  renewal: 'Mortgage renewal',
  pre_approval: 'Pre-approval / rate check',
};

function clean(value, max = 400) {
  return String(value ?? '').trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function envTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function appBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** What the contact form visitor picked ("I am interested in" / "Legal service needed" / "I need help with"). */
export function supportTopicFromPayload(professionalType, payload = {}) {
  if (professionalType === 'lawyer') {
    const key = clean(payload.legal_services_needed, 80);
    return { topic_key: key, topic: LAWYER_TOPICS[key] || key.replace(/_/g, ' ') };
  }
  if (professionalType === 'mortgage_broker') {
    const key = clean(payload.purchase_purpose, 80);
    return { topic_key: key, topic: BROKER_TOPICS[key] || key.replace(/_/g, ' ') };
  }
  const key = String(payload.client_type || '').toLowerCase() === 'investor' ? 'invest' : clean(payload.intent, 20);
  return { topic_key: key, topic: AGENT_TOPICS[key] || '' };
}

function isOwnedId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ''));
}

/** Professional-facing shape. */
export function serializeSupportRequest(doc, { full = false } = {}) {
  if (!doc) return null;
  const base = {
    id: String(doc._id),
    full_name: doc.full_name || '',
    email: doc.email || '',
    phone: doc.phone || '',
    topic: doc.topic || '',
    topic_key: doc.topic_key || '',
    message: doc.message || '',
    page_source: doc.page_source || 'contact_page',
    status: doc.status || 'new',
    is_unread: !doc.read_at,
    submission_count: Number(doc.submission_count || 1),
    notes_count: Array.isArray(doc.notes) ? doc.notes.length : 0,
    replies_count: Array.isArray(doc.replies) ? doc.replies.length : 0,
    created_at: doc.createdAt || null,
    updated_at: doc.updatedAt || null,
    last_submitted_at: doc.last_submitted_at || doc.createdAt || null,
  };
  if (!full) return base;
  return {
    ...base,
    professional_type: doc.professional_type || '',
    preferred_contact_method: doc.preferred_contact_method || '',
    best_time_to_contact: doc.best_time_to_contact || '',
    location: doc.location || '',
    read_at: doc.read_at || null,
    notes: (doc.notes || []).map((n) => ({ id: String(n._id), body: n.body, created_at: n.created_at || null })),
    replies: (doc.replies || []).map((r) => ({
      id: String(r._id),
      subject: r.subject || '',
      body: r.body || '',
      to_email: r.to_email || '',
      status: r.status || 'sent',
      sent_at: r.sent_at || null,
    })),
  };
}

async function notifyProfessionalOfSupportRequest(request) {
  try {
    const doc = await ProfessionalNotification.create({
      user_id: request.user_id,
      notification_type: 'support_request_created',
      title: 'New support request',
      body: [request.full_name, request.topic].filter(Boolean).join(' - ') || 'A visitor sent a request from your contact page.',
      severity: 'info',
      action: { type: 'open_url', url: `/support-requests/${String(request._id)}` },
      details: { support_request_id: String(request._id), page_source: request.page_source },
    });
    emitNotification(request.user_id, {
      id: String(doc._id),
      notification_id: String(doc._id),
      notification_type: doc.notification_type,
      title: doc.title,
      body: doc.body,
      severity: doc.severity,
      action: doc.action,
      createdAt: doc.created_at,
    });
  } catch (e) {
    logger.warn('Support request notification failed', { error: e.message });
  }
}

/** Same gates as the new-lead email: NEW_LEAD_EMAIL_NOTIFICATIONS, the assistant email setting, Resend configured. */
async function emailProfessionalOfSupportRequest(request) {
  if (!envTruthy(process.env.NEW_LEAD_EMAIL_NOTIFICATIONS)) return;
  const { assistantAllowsLeadEmail } = await import('../professionalAssistant/professionalAssistantService.js');
  if (!(await assistantAllowsLeadEmail(request.user_id))) return;
  if (!isResendConfigured()) return;
  const user = await User.findById(request.user_id).select('email').lean();
  if (!user?.email) return;
  const rows = [
    ['Name', request.full_name],
    ['Email', request.email],
    ['Phone', request.phone],
    ['Topic', request.topic],
    ['Message', request.message],
  ].filter(([, v]) => v);
  const link = `${appBaseUrl()}/support-requests/${String(request._id)}`;
  const result = await sendEmail({
    email: user.email,
    subject: `New support request${request.full_name ? ` from ${request.full_name}` : ''}`,
    message: `A visitor sent a support request from the contact page on your web page.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nOpen it: ${link}`,
    ...(request.email ? { replyTo: request.email } : {}),
    htmlMessage: renderBrandedEmailShell({
      kicker: 'Nesti Workspace',
      title: 'New support request',
      maxWidth: 560,
      innerHtml: `
        <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4A5568;">A visitor sent a support request from the contact page on your web page.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 14px;font-size:13px;color:#2D3748;">
          ${rows.map(([k, v]) => `<tr><td style="padding:6px 8px;font-weight:600;vertical-align:top;width:90px;">${escapeHtml(k)}</td><td style="padding:6px 8px;white-space:pre-wrap;">${escapeHtml(v)}</td></tr>`).join('')}
        </table>
        <p style="margin:0;font-size:13px;"><a href="${escapeHtml(link)}">Open the support request</a></p>`,
    }),
  });
  if (!result?.success) logger.warn('Support request email failed', { support_request_id: String(request._id) });
}

/**
 * Contact page submission -> support request (no lead, lead profile, score, matches or follow-ups).
 * The same visitor sending the same message again while the request is still open updates that request.
 */
export async function createSupportRequestFromContactPage({ publicProfile, professionalProfile, professionalType, payload = {}, requestMeta = {} }) {
  const email = clean(payload.email, 200).toLowerCase();
  const phone = clean(payload.phone, 40);
  const message = clean(payload.message, 4000);
  const { topic_key: topicKey, topic } = supportTopicFromPayload(professionalType, payload);
  const contactMatch = [email ? { email } : null, phone ? { phone } : null].filter(Boolean);

  const existing = contactMatch.length
    ? await ProfessionalSupportRequest.findOne({
      user_id: publicProfile.user_id,
      status: { $in: OPEN_STATUSES },
      message,
      $or: contactMatch,
    }).sort({ createdAt: -1 })
    : null;
  if (existing) {
    await ProfessionalSupportRequest.updateOne(
      { _id: existing._id },
      { $set: { last_submitted_at: new Date() }, $inc: { submission_count: 1 } },
    );
    return {
      status: 200,
      body: {
        success: true,
        message: 'Your request was sent successfully.',
        updated_existing: true,
        support_request_id: String(existing._id),
      },
    };
  }

  const request = await ProfessionalSupportRequest.create({
    user_id: publicProfile.user_id,
    professional_profile_id: professionalProfile?._id || null,
    public_profile_id: publicProfile._id || null,
    professional_type: professionalType,
    full_name: clean(payload.full_name, 120),
    email,
    phone,
    topic_key: topicKey,
    topic,
    message,
    preferred_contact_method: clean(payload.preferred_contact_method, 40),
    best_time_to_contact: clean(payload.best_time_to_contact, 80),
    location: clean(payload.location || payload.address, 400),
    page_source: 'contact_page',
    session_id: clean(payload.session_id, 120),
    visitor_id: clean(payload.visitor_id, 120),
    referrer: clean(requestMeta.referrer, 500),
  });
  await notifyProfessionalOfSupportRequest(request);
  void emailProfessionalOfSupportRequest(request).catch((e) => logger.warn('Support request email error', { error: e.message }));
  return {
    status: 201,
    body: { success: true, message: 'Your request was sent successfully.', support_request_id: String(request._id) },
  };
}

function notFound() {
  return { status: 404, body: { success: false, message: 'Support request not found' } };
}

export async function listSupportRequestsService(userId, query = {}) {
  const { page, limit, skip } = parsePageLimitPagination(query, { defaultLimit: 20, maxLimit: 100 });
  const owner = new mongoose.Types.ObjectId(String(userId));
  const filter = { user_id: owner };
  const status = String(query.status || '').trim().toLowerCase();
  if (SUPPORT_REQUEST_STATUSES.includes(status)) filter.status = status;
  const q = String(query.q || query.search || '').trim().slice(0, 120);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ full_name: rx }, { email: rx }, { phone: rx }, { topic: rx }, { message: rx }];
  }
  const [rows, total, statusCounts, unread] = await Promise.all([
    ProfessionalSupportRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .select('-notes.body -replies.body -session_id -visitor_id -referrer').lean(),
    ProfessionalSupportRequest.countDocuments(filter),
    ProfessionalSupportRequest.aggregate([{ $match: { user_id: owner } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ProfessionalSupportRequest.countDocuments({ user_id: owner, read_at: null }),
  ]);
  const counts = Object.fromEntries(SUPPORT_REQUEST_STATUSES.map((s) => [s, 0]));
  let all = 0;
  for (const row of statusCounts) {
    if (row._id in counts) counts[row._id] = row.n;
    all += row.n;
  }
  return {
    status: 200,
    body: {
      success: true,
      items: rows.map((doc) => serializeSupportRequest(doc)),
      pagination: buildPaginationMeta({ page, limit, total }),
      counts: { all, ...counts, unread },
    },
  };
}

export async function supportRequestSummaryService(userId) {
  const owner = new mongoose.Types.ObjectId(String(userId));
  const [unread, newCount] = await Promise.all([
    ProfessionalSupportRequest.countDocuments({ user_id: owner, read_at: null }),
    ProfessionalSupportRequest.countDocuments({ user_id: owner, status: 'new' }),
  ]);
  return { status: 200, body: { success: true, unread, new: newCount } };
}

async function findOwned(userId, id) {
  if (!isOwnedId(id)) return null;
  return ProfessionalSupportRequest.findOne({ _id: id, user_id: userId });
}

export async function getSupportRequestService(userId, id) {
  const doc = await findOwned(userId, id);
  if (!doc) return notFound();
  if (!doc.read_at) {
    doc.read_at = new Date();
    await doc.save();
  }
  return { status: 200, body: { success: true, item: serializeSupportRequest(doc.toObject(), { full: true }) } };
}

export async function updateSupportRequestService(userId, id, body = {}) {
  const doc = await findOwned(userId, id);
  if (!doc) return notFound();
  if (body.status !== undefined) doc.status = body.status;
  if (body.is_unread === true) doc.read_at = null;
  if (body.is_unread === false && !doc.read_at) doc.read_at = new Date();
  await doc.save();
  return { status: 200, body: { success: true, item: serializeSupportRequest(doc.toObject(), { full: true }) } };
}

export async function addSupportRequestNoteService(userId, id, body = {}) {
  const doc = await findOwned(userId, id);
  if (!doc) return notFound();
  doc.notes.push({ body: clean(body.body, 4000), author_id: userId });
  if (doc.status === 'new') doc.status = 'open';
  await doc.save();
  return { status: 201, body: { success: true, item: serializeSupportRequest(doc.toObject(), { full: true }) } };
}

export async function deleteSupportRequestNoteService(userId, id, noteId) {
  const doc = await findOwned(userId, id);
  if (!doc) return notFound();
  const note = doc.notes.id(noteId);
  if (!note) return { status: 404, body: { success: false, message: 'Note not found' } };
  note.deleteOne();
  await doc.save();
  return { status: 200, body: { success: true, item: serializeSupportRequest(doc.toObject(), { full: true }) } };
}

/** Email the requester from the platform address; replies go to the professional's own email. */
export async function replySupportRequestService(user, id, body = {}) {
  const doc = await findOwned(user._id, id);
  if (!doc) return notFound();
  if (!doc.email) {
    return { status: 400, body: { success: false, message: 'This request has no email address to reply to.' } };
  }
  if (!isResendConfigured()) {
    return { status: 503, body: { success: false, message: 'Email sending is not configured.' } };
  }
  const owner = await User.findById(user._id).select('email first_name last_name').lean();
  const senderName = [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim();
  const subject = clean(body.subject, 200) || `Re: ${doc.topic || 'your request'}`;
  const text = clean(body.message, 10000);
  const replyId = new mongoose.Types.ObjectId();
  const result = await sendEmail({
    email: doc.email,
    subject,
    message: text,
    idempotencyKey: `support-reply-${String(doc._id)}-${String(replyId)}`,
    ...(owner?.email ? { replyTo: owner.email } : {}),
    htmlMessage: renderBrandedEmailShell({
      kicker: senderName || 'Nesti',
      title: subject,
      maxWidth: 560,
      innerHtml: `<div style="font-size:14px;line-height:1.6;color:#2D3748;white-space:pre-wrap;">${escapeHtml(text)}</div>`,
    }),
  });
  const sent = Boolean(result?.success);
  doc.replies.push({
    _id: replyId,
    subject,
    body: text,
    to_email: doc.email,
    status: sent ? 'sent' : 'failed',
    provider_message_id: sent ? String(result?.id || '') : '',
    error: sent ? '' : clean(result?.error?.message || result?.error || 'send failed', 300),
    author_id: user._id,
  });
  if (sent && (doc.status === 'new' || doc.status === 'open')) doc.status = 'in_progress';
  await doc.save();
  if (!sent) {
    return {
      status: 502,
      body: { success: false, message: 'The reply could not be sent. Please try again.', item: serializeSupportRequest(doc.toObject(), { full: true }) },
    };
  }
  return { status: 200, body: { success: true, message: 'Reply sent', item: serializeSupportRequest(doc.toObject(), { full: true }) } };
}

export async function deleteSupportRequestService(userId, id) {
  if (!isOwnedId(id)) return notFound();
  const result = await ProfessionalSupportRequest.deleteOne({ _id: id, user_id: userId });
  if (!result.deletedCount) return notFound();
  return { status: 200, body: { success: true, message: 'Support request deleted' } };
}
