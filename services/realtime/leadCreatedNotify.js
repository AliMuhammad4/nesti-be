import User from '../../models/User.js';
import sendEmail from '../../utils/sendEmail.js';
import logger from '../../utils/logger.js';
import { emitNotification } from './workspaceSocket.js';
import { createLeadCreatedNotification } from '../notifications/notificationService.js';

function envTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function severityFromConversionPreview(preview) {
  const lvl = preview?.alert?.level;
  if (lvl === 'critical') return 'critical';
  if (lvl === 'high') return 'high';
  return 'info';
}

function buildSpeedToLeadTip(grade, preview) {
  const mins = preview?.recommended_response_within_minutes;
  const urgency = preview?.urgency;
  if (urgency === 'immediate') return `Hot lead — respond within ${mins ?? 5} min to maximise conversion.`;
  if (urgency === 'same_day') return `Warm lead — follow up within ${mins ?? 30} min while interest is high.`;
  if (mins) return `Reach out within ${mins} min for best results.`;
  return null;
}

function urgencyWindowLabel(preview) {
  const mins = preview?.recommended_response_within_minutes;
  if (!mins) return null;
  if (mins < 60) return `${mins} min`;
  return `${Math.round(mins / 60)} hr`;
}

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

  const body =
    conversion_preview?.why_match_one_liner ||
    conversion_preview?.why_one_liner ||
    conversion_preview?.headline ||
    'A new lead was captured from chat.';

  emitNotification(ownerUserId, {
    notification_id,
    notification_type: 'lead_created',
    title: `New ${String(persistedGrade || 'lead')} lead`,
    body,
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
    primary_next_action: conversion_preview?.primary_next_action_id
      ? {
          id: conversion_preview.primary_next_action_id,
          title: conversion_preview.primary_next_action_title,
          follow_up_template: conversion_preview.primary_follow_up_template ?? null,
        }
      : null,
    action: { type: 'open_lead', lead_match_id: String(newLeadMatch._id) },
  });
}

export async function sendNewLeadCreatedEmailIfEnabled(ownerUserId, ctx) {
  if (!envTruthy(process.env.NEW_LEAD_EMAIL_NOTIFICATIONS)) return;
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    logger.debug('NEW_LEAD_EMAIL_NOTIFICATIONS enabled but email transport is not configured');
    return;
  }

  const { newLeadMatch, persistedGrade, conversion_preview } = ctx;
  const summary =
    conversion_preview?.why_match_one_liner ||
    conversion_preview?.why_one_liner ||
    conversion_preview?.headline ||
    'A new lead was captured from chat.';

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
