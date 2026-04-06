import mongoose from 'mongoose';
import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import { parseOffsetLimitPagination, buildPaginationMeta, PAGINATION_PRESETS } from '../../utils/pagination.js';

function severityFromConversionPreview(preview) {
  const lvl = preview?.alert?.level;
  if (lvl === 'critical') return 'critical';
  if (lvl === 'high') return 'high';
  return 'info';
}
function bodyFromConversionPreview(conversion_preview) {
  return (
    conversion_preview?.why_match_one_liner ||
    conversion_preview?.why_one_liner ||
    conversion_preview?.headline ||
    'A new lead was captured from chat.'
  );
}
export async function createLeadCreatedNotification(ownerUserId, ctx) {
  const {
    newLeadMatch,
    conversationId,
    sessionId,
    persistedGrade,
    finalScore,
    socketIntent,
    appointment_status,
    conversion_preview,
  } = ctx;

  const body = bodyFromConversionPreview(conversion_preview);
  const title = `New ${String(persistedGrade || 'lead')} lead`;
  return ProfessionalNotification.create({
    user_id: ownerUserId,
    notification_type: 'lead_created',
    title,
    body,
    severity: severityFromConversionPreview(conversion_preview),
    action: { type: 'open_lead', lead_match_id: String(newLeadMatch._id) },
    lead_match_id: newLeadMatch._id,
    lead_profile_id: newLeadMatch.lead_profile_id || null,
    conversation_id: conversationId || null,
    session_id: sessionId || null,
    grade: persistedGrade ?? null,
    score: Number(newLeadMatch.match_score ?? finalScore),
    intent: socketIntent ?? null,
    appointment_status: appointment_status ?? null,
  });
}

function toDto(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    notification_type: o.notification_type,
    title: o.title,
    body: o.body,
    severity: o.severity,
    read_at: o.read_at ? o.read_at.toISOString() : null,
    action: o.action ?? null,
    lead_match_id: o.lead_match_id ? String(o.lead_match_id) : null,
    lead_profile_id: o.lead_profile_id ? String(o.lead_profile_id) : null,
    conversation_id: o.conversation_id ? String(o.conversation_id) : null,
    session_id: o.session_id ?? null,
    grade: o.grade ?? null,
    score: o.score ?? null,
    intent: o.intent ?? null,
    appointment_status: o.appointment_status ?? null,
    created_at: o.created_at ? o.created_at.toISOString() : null,
    updated_at: o.updated_at ? o.updated_at.toISOString() : null,
  };
}

export async function getNotificationsForUser(userId, { limit = 20, offset = 0, unread_only = false } = {}) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const q = { user_id: uid };
  if (unread_only) q.read_at = null;
  const { limit: lim, offset: off, page } = parseOffsetLimitPagination(
    { limit, offset },
    PAGINATION_PRESETS.leadList,
  );
  const [items, total] = await Promise.all([
    ProfessionalNotification.find(q).sort({ created_at: -1 }).skip(off).limit(lim).lean(),
    ProfessionalNotification.countDocuments(q),
  ]);
  const meta = buildPaginationMeta({ page, limit: lim, total });
  return {
    items: items.map((row) => toDto(row)),
    total: meta.total,
    limit: meta.limit,
    offset: off,
    page: meta.page,
    current_page: meta.current_page,
    total_pages: meta.total_pages,
    has_next_page: meta.has_next_page,
    has_prev_page: meta.has_prev_page,
    has_more: meta.has_more,
  };
}

export async function getUnreadNotificationCount(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  return ProfessionalNotification.countDocuments({ user_id: uid, read_at: null });
}

export async function markNotificationRead(userId, notificationId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const nid = new mongoose.Types.ObjectId(String(notificationId));
  const doc = await ProfessionalNotification.findOneAndUpdate(
    { _id: nid, user_id: uid },
    { $set: { read_at: new Date() } },
    { returnDocument: 'after' }
  ).lean();
  return toDto(doc);
}

export async function markAllNotificationsRead(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const res = await ProfessionalNotification.updateMany(
    { user_id: uid, read_at: null },
    { $set: { read_at: new Date() } }
  );
  return { modified: res.modifiedCount ?? 0 };
}
