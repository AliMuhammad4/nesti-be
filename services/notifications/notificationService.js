import mongoose from 'mongoose';
import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import { parseOffsetLimitPagination, buildPaginationMeta, PAGINATION_PRESETS } from '../../utils/pagination.js';
import {
  urgencyWindowLabel,
  buildSpeedToLeadTip,
  severityFromConversionPreview,
  conversionPreviewBody,
  primaryNextActionFromPreview,
  buildCollectionEmptyState,
} from '../lead/leadExperienceContract.js';

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

  return ProfessionalNotification.create({
    user_id: ownerUserId,
    notification_type: 'lead_created',
    title: `New ${String(persistedGrade || 'lead')} lead`,
    body: conversionPreviewBody(conversion_preview),
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
    urgency: conversion_preview?.urgency ?? null,
    urgency_window: urgencyWindowLabel(conversion_preview),
    speed_to_lead_tip: buildSpeedToLeadTip(conversion_preview),
    outcomes_headline: conversion_preview?.outcomes_headline ?? null,
    booking_cta: conversion_preview?.booking_cta ?? null,
    primary_next_action: primaryNextActionFromPreview(conversion_preview),
  });
}

export async function createLeadLifecycleNotification(ownerUserId, payload = {}) {
  const {
    notification_type = 'lead_lifecycle',
    title = 'Lead update',
    body = 'A lead status changed.',
    severity = 'info',
    lead_match_id = null,
    lead_profile_id = null,
    conversation_id = null,
    session_id = null,
    grade = null,
    score = null,
    intent = null,
    appointment_status = null,
    urgency = null,
    urgency_window = null,
    speed_to_lead_tip = null,
    outcomes_headline = null,
    booking_cta = null,
    primary_next_action = null,
    action = null,
  } = payload;

  return ProfessionalNotification.create({
    user_id: ownerUserId,
    notification_type,
    title,
    body,
    severity,
    action,
    lead_match_id,
    lead_profile_id,
    conversation_id,
    session_id,
    grade,
    score: score != null ? Number(score) : null,
    intent,
    appointment_status,
    urgency,
    urgency_window,
    speed_to_lead_tip,
    outcomes_headline,
    booking_cta,
    primary_next_action,
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
    urgency: o.urgency ?? null,
    urgency_window: o.urgency_window ?? null,
    speed_to_lead_tip: o.speed_to_lead_tip ?? null,
    outcomes_headline: o.outcomes_headline ?? null,
    booking_cta: o.booking_cta ?? null,
    primary_next_action: o.primary_next_action ?? null,
    decision_support: {
      why_this_match: o.body || null,
      do_this_now: o.primary_next_action || null,
      urgency: {
        level: o.severity || null,
        hot_lead: (o.grade || '').toLowerCase() === 'hot' || o.urgency === 'immediate',
        response_window: o.urgency_window || null,
        speed_to_lead_tip: o.speed_to_lead_tip || null,
      },
    },
    conversion_funnel: {
      stage: o.notification_type || null,
      appointment_status: o.appointment_status || null,
      urgency: o.urgency || null,
      response_window_minutes: null,
      sla_at_risk: null,
    },
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
    items: items.map(toDto),
    empty_state: items.length ? null : buildCollectionEmptyState('notifications'),
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

export async function getNotificationById(userId, notificationId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const nid = new mongoose.Types.ObjectId(String(notificationId));
  const doc = await ProfessionalNotification.findOne({ _id: nid, user_id: uid }).lean();
  return toDto(doc);
}

export async function markNotificationRead(userId, notificationId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const nid = new mongoose.Types.ObjectId(String(notificationId));
  const doc = await ProfessionalNotification.findOneAndUpdate(
    { _id: nid, user_id: uid },
    { $set: { read_at: new Date() } },
    { returnDocument: 'after' },
  ).lean();
  return toDto(doc);
}

export async function markAllNotificationsRead(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const res = await ProfessionalNotification.updateMany(
    { user_id: uid, read_at: null },
    { $set: { read_at: new Date() } },
  );
  return { modified: res.modifiedCount ?? 0 };
}
