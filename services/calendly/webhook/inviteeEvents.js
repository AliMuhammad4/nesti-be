import mongoose from 'mongoose';
import ChatConversation from '../../../models/ChatConversation.js';
import LeadMatch from '../../../models/LeadMatch.js';
import logger from '../../../utils/logger.js';
import { runPostBookingAutomations } from '../postBookingAutomations.js';
import { markRecentNurtureLogBooked, clearRecentNurtureLogMeetingBooked } from '../../nurture/nurtureMeetingBookingSync.js';
import {
  upsertBookedAppointmentFromCalendly,
  markWorkspaceAppointmentCanceled,
} from '../../calendar/workspaceAppointmentService.js';
import { extractScheduledEventStartDate } from '../calendlyPayloadUtils.js';
import { emitWorkspaceLeadEvent } from '../../realtime/workspaceSocket.js';
import { isTerminalMatchStatus } from '../../../utils/leadMatchStatus.js';
import {
  calendlyMeta,
  extractInviteeEmail,
  isNurtureTrackingSource,
  isPublicProfileBookingTracking,
  normalizeEmail,
} from './tracking.js';
import {
  resolveBookingNurtureUserId,
  resolveConversationId,
  resolveInviteeMatchContext,
  resolveOwnerUserIdForNurture,
  shouldAutoUpdatePipelineFromCalendly,
  syncConversationCalendly,
} from './leadLookup.js';
import {
  emitBookingNotification,
  emitCancelNotification,
  emitOwnerBookingNotification,
} from './notifications.js';

function bookingResult({ lead, matchedVia, conversationId, status, reason }) {
  return {
    processed: true,
    matched: Boolean(lead),
    matched_via: matchedVia,
    lead_match_id: lead ? String(lead._id) : null,
    conversation_id: conversationId ? String(conversationId) : null,
    calendly_booking_status: conversationId ? status : null,
    reason,
  };
}

async function loadInviteeContext(ctx) {
  const isPublicProfileBooking = isPublicProfileBookingTracking({
    trackingSource: ctx.trackingSource,
    trackingUtm: ctx.trackingUtm,
    ownerUserIdFromTracking: ctx.ownerUserIdFromTracking,
  });
  const matchContext = isPublicProfileBooking
    ? { match: null, matchedVia: 'public_profile_booking', conversationId: null }
    : await resolveInviteeMatchContext(
        ctx.email,
        ctx.trackingUtm,
        ctx.ownerUserIdFromTracking || ctx.ownerUserIdFromCalendly,
      );
  return { isPublicProfileBooking, ...matchContext };
}

async function alignOwnerLeadMatch({
  conversationId,
  nurtureUserId,
  lead,
  calendlyFactors,
  source,
  updatePipeline,
}) {
  if (!conversationId || !nurtureUserId) return { lead, aligned: false };
  try {
    const ownerMatch = await LeadMatch.findOne({
      user_id: nurtureUserId,
      conversation_id: conversationId,
    });
    if (!ownerMatch || (lead && String(ownerMatch._id) === String(lead._id))) {
      return { lead, aligned: false };
    }
    if (updatePipeline) {
      const isOwnerMatchSeller = /seller/i.test(String(ownerMatch.lead_type || ''));
      if (!isOwnerMatchSeller && shouldAutoUpdatePipelineFromCalendly(ownerMatch) && !isTerminalMatchStatus(ownerMatch.match_status)) {
        ownerMatch.match_status = 'consult_booked';
      }
    }
    ownerMatch.compatibility_factors = { ...ownerMatch.compatibility_factors, calendly: calendlyFactors };
    ownerMatch.markModified('compatibility_factors');
    await ownerMatch.save();
    emitWorkspaceLeadEvent(ownerMatch.user_id, {
      kind: 'lead_updated',
      lead_match_id: String(ownerMatch._id),
      match_status: ownerMatch.match_status,
      source,
    });
    return { lead: ownerMatch, aligned: true };
  } catch (error) {
    logger.error(`Calendly ${source.replace('calendly.', '')}: failed to align owner LeadMatch: ${error.message}`);
    return { lead, aligned: false };
  }
}

function emitLeadUpdated(lead, source) {
  emitWorkspaceLeadEvent(lead.user_id, {
    kind: 'lead_updated',
    lead_match_id: String(lead._id),
    match_status: lead.match_status,
    source,
  });
}

export async function handleInviteeCreated({
  email,
  trackingUtm,
  trackingSource,
  ownerUserIdFromCalendly,
  ownerUserIdFromTracking,
  payload,
  emailDomain,
}) {
  const { isPublicProfileBooking, match, matchedVia, conversationId } = await loadInviteeContext({
    email,
    trackingUtm,
    trackingSource,
    ownerUserIdFromCalendly,
    ownerUserIdFromTracking,
  });

  const meta = calendlyMeta('invitee.created', payload);
  const scheduledStart = extractScheduledEventStartDate(payload);

  if (match) {
    const isSellerLead = /seller/i.test(String(match.lead_type || ''));
    if (!isSellerLead) {
      if (shouldAutoUpdatePipelineFromCalendly(match) && !isTerminalMatchStatus(match.match_status)) {
        match.match_status = 'consult_booked';
      }
    }
    match.compatibility_factors = { ...match.compatibility_factors, calendly: meta };
    match.markModified('compatibility_factors');
    await match.save();
    emitLeadUpdated(match, 'calendly.invitee.created');
    logger.info('Calendly invitee.created: updated LeadMatch', { op: 'calendly.booking', leadMatchId: String(match._id), matched_via: matchedVia, email_domain: emailDomain });
  } else {
    logger.info('Calendly invitee.created: no LeadMatch', { op: 'calendly.booking', email_domain: emailDomain, utm_content: trackingUtm || null });
  }

  const effectiveConversationId =
    (match?._id
      ? (await LeadMatch.findById(match._id).select('conversation_id').lean())?.conversation_id
      : null) ||
    conversationId ||
    (!match && trackingUtm && mongoose.Types.ObjectId.isValid(String(trackingUtm))
      ? new mongoose.Types.ObjectId(String(trackingUtm))
      : null);

  if (effectiveConversationId) {
    await syncConversationCalendly(effectiveConversationId, 'booked', true);
  }

  const nurtureUserId = await resolveBookingNurtureUserId({
    ownerUserIdFromTracking,
    ownerUserIdFromCalendly,
    match,
    conversationId: effectiveConversationId,
    isPublicProfileBooking,
    email,
  });
  let leadForOps = match;
  let matchedViaEffective = matchedVia;
  const aligned = await alignOwnerLeadMatch({
    conversationId: effectiveConversationId,
    nurtureUserId,
    lead: leadForOps,
    calendlyFactors: meta,
    source: 'calendly.invitee.created',
    updatePipeline: true,
  });
  if (aligned.aligned) {
    leadForOps = aligned.lead;
    matchedViaEffective = matchedViaEffective || 'nurture_owner_conversation';
  } else {
    leadForOps = aligned.lead;
  }
  let bookedViaNurture = false;
  let nurtureLogId = null;
  if (isNurtureTrackingSource(trackingSource) && nurtureUserId && (email || effectiveConversationId || match?._id)) {
    try {
      const result = await markRecentNurtureLogBooked({
        userId: nurtureUserId,
        leadMatchId: leadForOps?._id || match?._id || null,
        leadProfileId: leadForOps?.lead_profile_id || match?.lead_profile_id || null,
        conversationId: effectiveConversationId,
        inviteeEmail: email,
        calendlyScheduledStartIso: scheduledStart ? scheduledStart.toISOString() : null,
      });
      bookedViaNurture = result.updated === true;
      nurtureLogId = result.nurture_log_id || null;
    } catch (error) { logger.error(`nurture meeting_booked sync: ${error.message}`); }
  }

  const appointmentUserId =
    leadForOps?.user_id ||
    match?.user_id ||
    ownerUserIdFromTracking ||
    ownerUserIdFromCalendly ||
    nurtureUserId;
  if (appointmentUserId) {
    try {
      await upsertBookedAppointmentFromCalendly({
        userId: appointmentUserId,
        leadMatchId: leadForOps?._id || match?._id || null,
        leadProfileId: leadForOps?.lead_profile_id || match?.lead_profile_id || null,
        conversationId: effectiveConversationId,
        payloadCalendlyMeta: meta,
        bookedViaNurture,
        nurtureLogId,
        inviteeEmail: email,
        scheduledStart,
        bookingOrigin: isPublicProfileBooking ? 'public_profile_consultation' : null,
      });
    } catch (error) {
      logger.error(`workspace appointment upsert: ${error.message}`);
    }
  }

  if (leadForOps) {
    await emitBookingNotification(leadForOps, effectiveConversationId, bookedViaNurture);
  } else if (appointmentUserId || ownerUserIdFromCalendly || ownerUserIdFromTracking) {
    await emitOwnerBookingNotification({
      userId: appointmentUserId || ownerUserIdFromCalendly || ownerUserIdFromTracking,
      email,
      payload,
    });
  }

  const ownerUserId = leadForOps?.user_id || match?.user_id || ownerUserIdFromTracking || nurtureUserId;
  if (effectiveConversationId && ownerUserId && email) {
    setImmediate(() =>
      runPostBookingAutomations({
        conversationId: effectiveConversationId,
        userId: ownerUserId,
        inviteeEmail: email,
        inviteeUri: payload?.uri || null,
        leadMatchId: leadForOps?._id || match?._id || null,
      }).catch((error) => logger.error(`postBooking automations: ${error.message}`))
    );
  }

  return bookingResult({
    lead: leadForOps,
    matchedVia: matchedViaEffective,
    conversationId: effectiveConversationId,
    status: 'booked',
    reason: leadForOps ? undefined : 'lead_not_found',
  });
}

export async function handleInviteeCanceled({
  email,
  trackingUtm,
  trackingSource,
  ownerUserIdFromCalendly,
  ownerUserIdFromTracking,
  payload,
  emailDomain,
}) {
  const { isPublicProfileBooking, match, matchedVia, conversationId } = await loadInviteeContext({
    email,
    trackingUtm,
    trackingSource,
    ownerUserIdFromCalendly,
    ownerUserIdFromTracking,
  });

  if (conversationId) {
    const conv = await ChatConversation.findById(conversationId).select('calendly_booking_status').lean();
    if (conv?.calendly_booking_status === 'canceled') {
      logger.info('Calendly invitee.canceled: idempotent skip (already canceled)', {
        op: 'calendly.booking',
        conversation_id: String(conversationId),
      });
      return bookingResult({
        lead: match,
        matchedVia,
        conversationId,
        status: 'canceled',
        reason: 'already_canceled',
      });
    }
  }

  const canceledMeta = { ...calendlyMeta('invitee.canceled', payload), calendly_canceled: true };

  if (match) {
    const skipStatus =
      isTerminalMatchStatus(match.match_status) || !shouldAutoUpdatePipelineFromCalendly(match);
    if (!skipStatus) {
      match.match_status = 'nurturing';
    }
    match.compatibility_factors = { ...match.compatibility_factors, calendly: canceledMeta };
    match.markModified('compatibility_factors');
    await match.save();
    emitLeadUpdated(match, 'calendly.invitee.canceled');
    logger.info('Calendly invitee.canceled: updated LeadMatch', {
      op: 'calendly.booking',
      leadMatchId: String(match._id),
      conversation_id: conversationId ? String(conversationId) : null,
      matched_via: matchedVia,
      email_domain: emailDomain,
      preserved_terminal_status: skipStatus,
    });
  }

  if (conversationId) {
    await syncConversationCalendly(conversationId, 'canceled', false);
    logger.info('Calendly invitee.canceled: conversation marked canceled', { op: 'calendly.booking', conversation_id: String(conversationId) });
  }

  const nurtureUserId = await resolveBookingNurtureUserId({
    ownerUserIdFromTracking,
    ownerUserIdFromCalendly,
    match,
    conversationId,
    isPublicProfileBooking,
    email,
  });
  let leadForOps = match;
  let matchedViaEffective = matchedVia;
  const aligned = await alignOwnerLeadMatch({
    conversationId,
    nurtureUserId,
    lead: leadForOps,
    calendlyFactors: canceledMeta,
    source: 'calendly.invitee.canceled',
    updatePipeline: false,
  });
  if (aligned.aligned) {
    leadForOps = aligned.lead;
    matchedViaEffective = matchedViaEffective || 'nurture_owner_conversation';
  }

  const cancelUserId = leadForOps?.user_id || match?.user_id || ownerUserIdFromTracking || nurtureUserId;

  if (isNurtureTrackingSource(trackingSource) && nurtureUserId && (email || conversationId || match?._id)) {
    try {
      await clearRecentNurtureLogMeetingBooked({
        userId: nurtureUserId,
        leadMatchId: leadForOps?._id || match?._id || null,
        leadProfileId: leadForOps?.lead_profile_id || match?.lead_profile_id || null,
        conversationId,
        inviteeEmail: email,
      });
    } catch (error) { logger.error(`nurture meeting_booked clear: ${error.message}`); }
  }

  if (cancelUserId) {
    try {
      await markWorkspaceAppointmentCanceled({
        userId: cancelUserId,
        inviteeUri: payload?.uri || null,
        leadMatchId: leadForOps?._id || match?._id || null,
        conversationId,
        inviteeEmail: email,
      });
    } catch (error) {
      logger.error(`workspace appointment cancel: ${error.message}`);
    }
  }

  await emitCancelNotification(leadForOps, conversationId);

  return bookingResult({
    lead: leadForOps,
    matchedVia: matchedViaEffective,
    conversationId,
    status: 'canceled',
    reason: !leadForOps && !conversationId ? 'lead_not_found' : undefined,
  });
}

export async function applyCalendlyCancellationToLeadForUser(leadMatchId, userId, options = {}) {
  const lead = await LeadMatch.findOne({ _id: leadMatchId, user_id: userId });
  if (!lead) return { ok: false, message: 'Lead not found' };

  const conversationId = resolveConversationId(lead, null);
  const payload =
    options.payload && typeof options.payload === 'object'
      ? options.payload
      : (lead.compatibility_factors?.calendly || {});

  let email = extractInviteeEmail(payload);
  if (!email) email = normalizeEmail(lead.compatibility_factors?.contact?.email);

  if (shouldAutoUpdatePipelineFromCalendly(lead) && !isTerminalMatchStatus(lead.match_status)) {
    lead.match_status = 'nurturing';
  }
  lead.compatibility_factors = {
    ...lead.compatibility_factors,
    calendly: {
      ...calendlyMeta('invitee.canceled', payload),
      calendly_canceled: true,
      calendly_canceled_via: 'nesti_api',
    },
  };
  lead.markModified('compatibility_factors');
  await lead.save();
  emitWorkspaceLeadEvent(userId, {
    kind: 'lead_updated',
    lead_match_id: String(lead._id),
    match_status: lead.match_status,
    source: 'calendly.cancel_api',
  });
  logger.info('Calendly: local state after cancel API', {
    op: 'calendly.cancel_api',
    lead_match_id: String(lead._id),
    conversation_id: conversationId ? String(conversationId) : null,
  });

  if (conversationId) {
    await syncConversationCalendly(conversationId, 'canceled', false);
  }

  const inviteeUri = payload?.uri || payload?.calendly_invitee_uri || null;
  try {
    await markWorkspaceAppointmentCanceled({
      userId,
      inviteeUri,
      leadMatchId: lead._id,
      conversationId,
      inviteeEmail: email,
    });
  } catch (error) {
    logger.error(`workspace appointment cancel (api): ${error.message}`);
  }

  const nurtureUserId = await resolveOwnerUserIdForNurture(lead, conversationId);
  if (nurtureUserId && (email || conversationId || lead?._id)) {
    try {
      await clearRecentNurtureLogMeetingBooked({
        userId: nurtureUserId,
        leadMatchId: lead?._id || null,
        leadProfileId: lead?.lead_profile_id || null,
        conversationId,
        inviteeEmail: email,
      });
    } catch (error) {
      logger.error(`nurture meeting_booked clear: ${error.message}`);
    }
  }

  await emitCancelNotification(lead, conversationId);
  return { ok: true };
}
