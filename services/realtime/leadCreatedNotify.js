import User from '../../models/User.js';
import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { emitNotification } from './workspaceSocket.js';
import {
  createLeadCreatedNotification,
  createLeadLifecycleNotification,
} from '../notifications/notificationService.js';
import { recordLeadKpiEvent } from '../analytics/leadKpiService.js';
import {
  urgencyWindowLabel,
  buildSpeedToLeadTip,
  severityFromConversionPreview,
  conversionPreviewBody,
  primaryNextActionFromPreview,
} from '../lead/leadExperienceContract.js';

function envTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

const KPI_LIFECYCLE_TYPE_MAP = {
  lead_lifecycle: 'lead_updated',
  lead_updated: 'lead_updated',
  appointment_booked: 'appointment_booked',
  appointment_canceled: 'appointment_canceled',
  nurture_appointment_booked: 'appointment_booked',
};

export async function emitNewLeadCreatedNotification(ownerUserId, ctx) {
  let notification_id = null;
  try {
    const doc = await createLeadCreatedNotification(ownerUserId, ctx);
    notification_id = doc?._id ? String(doc._id) : null;
  } catch (e) {
    logger.warn('Lead-created notification persist failed', { error: e.message, user_id: String(ownerUserId) });
  }

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

  emitNotification(ownerUserId, {
    notification_id,
    notification_type: 'lead_created',
    title: `New ${String(persistedGrade || 'lead')} lead`,
    body: conversionPreviewBody(conversion_preview),
    severity: severityFromConversionPreview(conversion_preview),
    lead_match_id: String(newLeadMatch._id),
    lead_profile_id: newLeadMatch.lead_profile_id ? String(newLeadMatch.lead_profile_id) : null,
    conversation_id: String(conversationId),
    session_id: sessionId || null,
    grade: persistedGrade,
    score: Number(newLeadMatch.match_score ?? finalScore),
    intent: socketIntent,
    appointment_status,
    urgency: conversion_preview?.urgency ?? null,
    urgency_window: urgencyWindowLabel(conversion_preview),
    speed_to_lead_tip: buildSpeedToLeadTip(persistedGrade, conversion_preview),
    outcomes_headline: conversion_preview?.outcomes_headline ?? null,
    booking_cta: conversion_preview?.booking_cta ?? null,
    primary_next_action: primaryNextActionFromPreview(conversion_preview),
    action: { type: 'open_lead', lead_match_id: String(newLeadMatch._id) },
  });

  try {
    await recordLeadKpiEvent({
      user_id: ownerUserId,
      lead_match_id: newLeadMatch._id,
      conversation_id: conversationId || null,
      event_type: 'lead_created',
      grade: persistedGrade || null,
      appointment_status: appointment_status || null,
      urgency: conversion_preview?.urgency ?? null,
      metadata: {
        score: Number(newLeadMatch.match_score ?? finalScore),
        intent: socketIntent || null,
      },
    });
  } catch (e) {
    logger.warn('Lead KPI event write failed (lead_created)', { error: e.message });
  }
}

export async function emitLeadLifecycleNotification(ownerUserId, payload) {
  let notification_id = null;
  try {
    const doc = await createLeadLifecycleNotification(ownerUserId, payload);
    notification_id = doc?._id ? String(doc._id) : null;
  } catch (e) {
    logger.warn('Lead-lifecycle notification persist failed', {
      error: e.message,
      user_id: String(ownerUserId),
    });
  }

  emitNotification(ownerUserId, { notification_id, ...payload });

  try {
    await recordLeadKpiEvent({
      user_id: ownerUserId,
      lead_match_id: payload?.lead_match_id || null,
      conversation_id: payload?.conversation_id || null,
      event_type: KPI_LIFECYCLE_TYPE_MAP[payload?.notification_type] || payload?.notification_type || 'lead_updated',
      grade: payload?.grade || null,
      appointment_status: payload?.appointment_status || null,
      urgency: payload?.urgency || null,
      metadata: {
        severity: payload?.severity || null,
        title: payload?.title || null,
        booked_via_nurture: payload?.booked_via_nurture ?? false,
      },
    });
  } catch (e) {
    logger.warn('Lead KPI event write failed (lifecycle)', { error: e.message });
  }
}

export async function sendNewLeadCreatedEmailIfEnabled(ownerUserId, ctx) {
  if (!envTruthy(process.env.NEW_LEAD_EMAIL_NOTIFICATIONS)) return;
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    logger.debug('NEW_LEAD_EMAIL_NOTIFICATIONS enabled but email transport is not configured');
    return;
  }

  const { newLeadMatch, persistedGrade, conversion_preview } = ctx;
  const summary = conversionPreviewBody(conversion_preview);

  try {
    const user = await User.findById(ownerUserId).select('email first_name').lean();
    if (!user?.email) return;

    const result = await sendEmail({
      email: user.email,
      subject: `New ${persistedGrade} lead — Nesti`,
      message: `${summary}\n\nOpen your dashboard to follow up.\nLead ID: ${String(newLeadMatch._id)}`,
    });
    if (!result.success) {
      logger.warn('New lead email notification send failed', { lead_match_id: String(newLeadMatch._id) });
    }
  } catch (e) {
    logger.warn('New lead email notification error', { error: e.message });
  }
}
