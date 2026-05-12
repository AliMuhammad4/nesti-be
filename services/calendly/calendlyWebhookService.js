import crypto from 'crypto';
import mongoose from 'mongoose';
import ChatConversation from '../../models/ChatConversation.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import CalendarIntegration from '../../models/CalendarIntegration.js';
import NurtureLog from '../../models/NurtureLog.js';
import logger from '../../utils/logger.js';
import { runPostBookingAutomations } from './postBookingAutomations.js';
import { markRecentNurtureLogBooked, clearRecentNurtureLogMeetingBooked } from '../nurture/nurtureMeetingBookingSync.js';
import {
  upsertBookedAppointmentFromCalendly,
  markWorkspaceAppointmentCanceled,
} from '../calendar/workspaceAppointmentService.js';
import { extractScheduledEventStartDate } from './calendlyPayloadUtils.js';
import { buildWorkspaceLeadConversionPreview } from '../conversion/buildLeadConversionPack.js';
import { emitLeadLifecycleNotification } from '../realtime/leadCreatedNotify.js';
import { emitWorkspaceLeadEvent } from '../realtime/workspaceSocket.js';
import { urgencyWindowLabel, severityFromConversionPreview, primaryNextActionFromPreview } from '../lead/leadExperienceContract.js';
import { isTerminalMatchStatus } from '../../utils/leadMatchStatus.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

// ─── Signature verification ───────────────────────────────────────────────────

export function verifyCalendlySignature(rawBodyString, signatureHeader, signingKey) {
  if (!signingKey || !signatureHeader || rawBodyString == null) return false;
  try {
    const parts = {};
    for (const segment of String(signatureHeader).split(',')) {
      const eq = segment.indexOf('=');
      if (eq !== -1) parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
    }
    const { t, v1 } = parts;
    if (!t || !v1) return false;
    const hmac = crypto.createHmac('sha256', signingKey).update(`${t}.${rawBodyString}`).digest('hex');
    const a = Buffer.from(v1, 'utf8');
    const b = Buffer.from(hmac, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// ─── Payload extractors ───────────────────────────────────────────────────────

function normalizeEmail(e) {
  if (!e || typeof e !== 'string') return null;
  return e.trim().toLowerCase() || null;
}

function extractInviteeEmail(payload) {
  return normalizeEmail(payload?.email || payload?.invitee?.email);
}

function extractTrackingUtmContent(payload) {
  const pick = (t) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
    const v = String(t.utm_content ?? '').trim();
    return v || null;
  };
  /** Calendly sometimes sends `tracking` as an array of { name, value } pairs. */
  const pickFromArray = (t) => {
    if (!Array.isArray(t)) return null;
    for (const item of t) {
      if (!item || typeof item !== 'object') continue;
      const name = String(item.name || item.field || '').toLowerCase();
      const val = String(item.value ?? item.answer ?? item.response ?? '').trim();
      if (val && (name.includes('utm_content') || name === 'utm_content' || (name.includes('utm') && name.includes('content')))) {
        return val;
      }
    }
    return null;
  };
  const top = String(payload?.utm_content ?? '').trim() || null;
  if (top) return top;
  return (
    pick(payload?.tracking) ||
    pickFromArray(payload?.tracking) ||
    pick(payload?.scheduled_event?.tracking) ||
    pickFromArray(payload?.scheduled_event?.tracking) ||
    pick(typeof payload?.event === 'object' ? payload.event?.tracking : null) ||
    pickFromArray(typeof payload?.event === 'object' ? payload.event?.tracking : null) ||
    pick(payload?.invitee?.tracking) ||
    pickFromArray(payload?.invitee?.tracking) ||
    null
  );
}

function extractTrackingUtmCampaign(payload) {
  const pick = (t) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
    const v = String(t.utm_campaign ?? '').trim();
    return v || null;
  };
  /** Calendly sometimes sends `tracking` as an array of { name, value } pairs. */
  const pickFromArray = (t) => {
    if (!Array.isArray(t)) return null;
    for (const item of t) {
      if (!item || typeof item !== 'object') continue;
      const name = String(item.name || item.field || '').toLowerCase();
      const val = String(item.value ?? item.answer ?? item.response ?? '').trim();
      if (val && (name.includes('utm_campaign') || name === 'utm_campaign' || (name.includes('utm') && name.includes('campaign')))) {
        return val;
      }
    }
    return null;
  };
  const top = String(payload?.utm_campaign ?? '').trim() || null;
  if (top) return top;
  return (
    pick(payload?.tracking) ||
    pickFromArray(payload?.tracking) ||
    pick(payload?.scheduled_event?.tracking) ||
    pickFromArray(payload?.scheduled_event?.tracking) ||
    pick(typeof payload?.event === 'object' ? payload.event?.tracking : null) ||
    pickFromArray(typeof payload?.event === 'object' ? payload.event?.tracking : null) ||
    pick(payload?.invitee?.tracking) ||
    pickFromArray(payload?.invitee?.tracking) ||
    null
  );
}

function extractTrackingUtmSource(payload) {
  const pick = (t) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
    const v = String(t.utm_source ?? '').trim();
    return v || null;
  };
  /** Calendly sometimes sends `tracking` as an array of { name, value } pairs. */
  const pickFromArray = (t) => {
    if (!Array.isArray(t)) return null;
    for (const item of t) {
      if (!item || typeof item !== 'object') continue;
      const name = String(item.name || item.field || '').toLowerCase();
      const val = String(item.value ?? item.answer ?? item.response ?? '').trim();
      if (val && (name.includes('utm_source') || name === 'utm_source' || (name.includes('utm') && name.includes('source')))) {
        return val;
      }
    }
    return null;
  };
  const top = String(payload?.utm_source ?? '').trim() || null;
  if (top) return top;
  return (
    pick(payload?.tracking) ||
    pickFromArray(payload?.tracking) ||
    pick(payload?.scheduled_event?.tracking) ||
    pickFromArray(payload?.scheduled_event?.tracking) ||
    pick(typeof payload?.event === 'object' ? payload.event?.tracking : null) ||
    pickFromArray(typeof payload?.event === 'object' ? payload.event?.tracking : null) ||
    pick(payload?.invitee?.tracking) ||
    pickFromArray(payload?.invitee?.tracking) ||
    null
  );
}

function extractCalendlyOwnerUri(payload) {
  const candidates = [
    payload?.scheduled_event?.created_by,
    payload?.scheduled_event?.creator,
    payload?.created_by,
    payload?.event_memberships?.[0]?.user,
    payload?.scheduled_event?.event_memberships?.[0]?.user,
  ];
  for (const c of candidates) {
    const v = c != null ? String(c).trim().toLowerCase() : null;
    if (v) return v;
  }
  return null;
}

function calendlyMeta(eventName, payload) {
  const startDate = extractScheduledEventStartDate(payload);
  return {
    calendly_event:       eventName,
    calendly_updated_at:  new Date().toISOString(),
    calendly_invitee_uri: payload?.uri || null,
    calendly_event_uri:   typeof payload?.event === 'string' ? payload.event : payload?.event?.uri || null,
    ...(startDate ? { calendly_event_start: startDate.toISOString() } : {}),
  };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function resolveOwnerUserId(payload) {
  const uri = extractCalendlyOwnerUri(payload);
  if (!uri) return null;
  const doc = await CalendarIntegration.findOne({ provider: 'calendly', calendly_user_uri: uri }).select('user_id').lean();
  return doc?.user_id || null;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveNurtureSenderUserIdFromLogs({ conversationId, leadMatchId, inviteeEmail }) {
  const or = [];
  if (leadMatchId && mongoose.Types.ObjectId.isValid(String(leadMatchId))) {
    or.push({ lead_match_id: new mongoose.Types.ObjectId(String(leadMatchId)) });
  }
  if (conversationId && mongoose.Types.ObjectId.isValid(String(conversationId))) {
    or.push({ conversation_id: new mongoose.Types.ObjectId(String(conversationId)) });
  }
  const em = inviteeEmail && String(inviteeEmail).trim().toLowerCase();
  if (em) {
    or.push({ to_email: new RegExp(`^${escapeRegex(em)}$`, 'i') });
  }
  if (!or.length) return null;

  const doc = await NurtureLog.findOne({ status: 'sent', $or: or })
    .sort({ sent_at: -1, createdAt: -1 })
    .select('user_id')
    .lean();
  return doc?.user_id || null;
}

function ownerFilter(userId) {
  return userId && mongoose.Types.ObjectId.isValid(String(userId))
    ? { user_id: new mongoose.Types.ObjectId(String(userId)) }
    : {};
}

async function findLeadForBooking(email, trackingUtm, ownerUserId = null) {
  const filter = ownerFilter(ownerUserId);

  if (trackingUtm && mongoose.Types.ObjectId.isValid(trackingUtm)) {
    const lead = await LeadMatch.findOne({ conversation_id: new mongoose.Types.ObjectId(trackingUtm), ...filter });
    if (lead) return { lead, matchedVia: 'utm_conversation' };
  }

  if (!email) return { lead: null, matchedVia: null };

  const emailRe = new RegExp(`^${String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

  const byContact = await LeadMatch.findOne({ 'compatibility_factors.contact.email': { $regex: emailRe }, ...filter }).sort({ last_contact_at: -1 });
  if (byContact) return { lead: byContact, matchedVia: 'leadmatch_contact_email' };

  const profile = await LeadProfile.findOne({
    $or: [{ 'identity.canonical_email': { $regex: emailRe } }, { 'identity.email': { $regex: emailRe } }],
  }).sort({ updatedAt: -1 });
  if (profile?._id) {
    const lm = await LeadMatch.findOne({ lead_profile_id: profile._id, ...filter }).sort({ last_contact_at: -1 });
    if (lm) return { lead: lm, matchedVia: 'leadprofile_email' };
  }

  return { lead: null, matchedVia: null };
}

function resolveConversationId(lead, trackingUtm) {
  if (lead?.conversation_id) return lead.conversation_id;
  if (trackingUtm && mongoose.Types.ObjectId.isValid(trackingUtm)) return new mongoose.Types.ObjectId(trackingUtm);
  return null;
}

/** Shared invitee resolution for created + canceled webhooks. */
async function resolveInviteeMatchContext(email, trackingUtm, ownerUserIdFromCalendly) {
  let { lead: match, matchedVia } = await findLeadForBooking(email, trackingUtm, ownerUserIdFromCalendly);
  const trackingConversationId =
    trackingUtm && mongoose.Types.ObjectId.isValid(String(trackingUtm))
      ? new mongoose.Types.ObjectId(String(trackingUtm))
      : null;

  /**
   * If Calendly owner lookup is wrong (common for lawyer/broker embeds), the email fallback can
   * resolve a different lead. When we have tracked conversation_id from utm_content, force the
   * match back to that conversation to keep list-row status and CRM history aligned.
   */
  if (
    match &&
    trackingConversationId &&
    String(match.conversation_id || '') !== String(trackingConversationId)
  ) {
    const conv = await ChatConversation.findById(trackingConversationId).select('user_id').lean();
    if (conv?.user_id) {
      const byTrackedConversation = await LeadMatch.findOne({
        conversation_id: trackingConversationId,
        user_id: conv.user_id,
      }).sort({ last_contact_at: -1 });
      if (byTrackedConversation) {
        match = byTrackedConversation;
        matchedVia = 'utm_conversation_override';
      }
    }
  }
  if (!match && ownerUserIdFromCalendly && trackingConversationId) {
    const byConvo = await LeadMatch.findOne({
      conversation_id: trackingConversationId,
      ...ownerFilter(ownerUserIdFromCalendly),
    });
    if (byConvo) {
      match = byConvo;
      matchedVia = 'conversation_id_utm';
    }
  }
  /**
   * Lawyer / broker embed threads: Calendly’s “owner” URI may not match CalendarIntegration.user_id,
   * so the filtered lookup above misses. The chat conversation’s user_id is the professional who owns
   * the embed — use it to resolve LeadMatch for booking + notifications.
   */
  if (!match && trackingConversationId) {
    const conv = await ChatConversation.findById(trackingConversationId).select('user_id').lean();
    if (conv?.user_id) {
      const byEmbedOwner = await LeadMatch.findOne({
        conversation_id: trackingConversationId,
        user_id: conv.user_id,
      }).sort({
        last_contact_at: -1,
      });
      if (byEmbedOwner) {
        match = byEmbedOwner;
        matchedVia = matchedVia || 'nesti_embed_conversation_owner';
      }
    }
  }
  return {
    match,
    matchedVia,
    conversationId: resolveConversationId(match, trackingUtm),
  };
}

async function resolveOwnerUserIdForNurture(lead, conversationId) {
  if (lead?.user_id) return lead.user_id;
  if (!conversationId) return null;
  const conv = await ChatConversation.findById(conversationId).select('user_id').lean();
  return conv?.user_id || null;
}

async function syncConversationCalendly(conversationId, status, setBookedAt = false) {
  if (!conversationId) return;
  const $set = { calendly_booking_status: status };
  if (setBookedAt) $set.calendly_booking_at = new Date();
  await ChatConversation.findByIdAndUpdate(conversationId, { $set });
}

function leadProfessionalType(lead) {
  return String(lead?.compatibility_factors?.professional_type || '').trim().toLowerCase();
}

/**
 * Keep pipeline stage manual for lawyer/broker; only agent pipeline auto-advances via booking webhooks.
 */
function shouldAutoUpdatePipelineFromCalendly(lead) {
  return leadProfessionalType(lead) === PROFESSIONAL_TYPE.AGENT;
}

// ─── Notification helpers ─────────────────────────────────────────────────────

function buildNotificationBase(lead, conversationId, preview) {
  return {
    lead_match_id:     lead._id,
    lead_profile_id:   lead.lead_profile_id || null,
    conversation_id:   conversationId || null,
    session_id:        lead.compatibility_factors?.session_id || null,
    grade:             String(lead.lead_type || '').split('_')[0] || null,
    score:             lead.match_score ?? null,
    urgency:           preview?.urgency ?? null,
    urgency_window:    urgencyWindowLabel(preview),
    outcomes_headline: preview?.outcomes_headline ?? null,
    action:            { type: 'open_lead', lead_match_id: String(lead._id) },
  };
}

async function fetchConvForPreview(conversationId) {
  if (!conversationId) return null;
  return ChatConversation.findById(conversationId)
    .select('calendly_booking_status lead_reasons last_interaction_at intent')
    .lean();
}

async function emitBookingNotification(lead, conversationId, bookedViaNurture) {
  if (!lead?.user_id || !lead?._id) return;
  const conv = await fetchConvForPreview(conversationId);
  const preview = buildWorkspaceLeadConversionPreview({ leadMatch: lead, conversation: conv, intent: conv?.intent || null });
  await emitLeadLifecycleNotification(lead.user_id, {
    ...buildNotificationBase(lead, conversationId, preview),
    notification_type:  'appointment_booked',
    title:              bookedViaNurture ? 'Consultation booked via nurture email' : 'Appointment booked',
    body:               bookedViaNurture
      ? `Your nurture email converted — ${preview.why_match_one_liner || 'lead booked a consultation.'}`
      : preview.why_match_one_liner || 'Lead booked an appointment.',
    severity:           severityFromConversionPreview(preview?.alert ? { alert: preview.alert } : null),
    intent:             conv?.intent || null,
    appointment_status: 'booked',
    booked_via_nurture: bookedViaNurture,
    speed_to_lead_tip:  preview?.urgency === 'immediate' ? 'Confirm appointment details now to reduce no-shows.' : null,
    booking_cta:        preview?.booking_cta ?? null,
    primary_next_action: primaryNextActionFromPreview(preview),
  });
}

async function emitCancelNotification(lead, conversationId) {
  if (!lead?.user_id || !lead?._id) return;
  const conv = await fetchConvForPreview(conversationId);
  const preview = buildWorkspaceLeadConversionPreview({ leadMatch: lead, conversation: conv, intent: conv?.intent || null });
  await emitLeadLifecycleNotification(lead.user_id, {
    ...buildNotificationBase(lead, conversationId, preview),
    notification_type:  'appointment_canceled',
    title:              'Appointment canceled',
    body:               'Booked appointment was canceled. Re-engage quickly to recover this opportunity.',
    severity:           'high',
    intent:             conv?.intent || null,
    appointment_status: 'canceled',
    urgency:            'same_day',
    urgency_window:     '24 hr',
    speed_to_lead_tip:  'Follow up within the same day to recover booking momentum.',
    booking_cta:        'Offer 2-3 new time slots now.',
    primary_next_action: {
      id:                  'offer_meeting_slots',
      title:               'Offer 2-3 specific times to rebook',
      follow_up_template:  preview?.primary_follow_up_template ?? null,
    },
  });
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleInviteeCreated({
  email,
  trackingUtm,
  trackingSource,
  ownerUserIdFromCalendly,
  ownerUserIdFromTracking,
  payload,
  emailDomain,
}) {
  const { match, matchedVia, conversationId } = await resolveInviteeMatchContext(
    email,
    trackingUtm,
    ownerUserIdFromTracking || ownerUserIdFromCalendly,
  );

  const meta = calendlyMeta('invitee.created', payload);
  const scheduledStart = extractScheduledEventStartDate(payload);

  if (match) {
    if (shouldAutoUpdatePipelineFromCalendly(match) && !isTerminalMatchStatus(match.match_status)) {
      match.match_status = 'consult_booked';
    }
    match.compatibility_factors = { ...match.compatibility_factors, calendly: meta };
    match.markModified('compatibility_factors');
    await match.save();
    emitWorkspaceLeadEvent(match.user_id, {
      kind: 'lead_updated',
      lead_match_id: String(match._id),
      match_status: match.match_status,
      source: 'calendly.invitee.created',
    });
    logger.info('Calendly invitee.created: updated LeadMatch', { op: 'calendly.booking', leadMatchId: String(match._id), matched_via: matchedVia, email_domain: emailDomain });
  } else {
    logger.info('Calendly invitee.created: no LeadMatch', { op: 'calendly.booking', email_domain: emailDomain, utm_content: trackingUtm || null });
  }

  const effectiveConversationId =
    (match?._id
      ? (await LeadMatch.findById(match._id).select('conversation_id').lean())?.conversation_id
      : null) ||
    conversationId ||
    (trackingUtm && mongoose.Types.ObjectId.isValid(String(trackingUtm))
      ? new mongoose.Types.ObjectId(String(trackingUtm))
      : null);

  if (effectiveConversationId) {
    await syncConversationCalendly(effectiveConversationId, 'booked', true);
  }

  const nurtureUserId =
    ownerUserIdFromTracking ||
    ownerUserIdFromCalendly ||
    (await resolveOwnerUserIdForNurture(match, effectiveConversationId)) ||
    (await resolveNurtureSenderUserIdFromLogs({
      conversationId: effectiveConversationId,
      leadMatchId: match?._id || null,
      inviteeEmail: email,
    }));
  let leadForOps = match;
  let matchedViaEffective = matchedVia;
  if (effectiveConversationId && nurtureUserId) {
    try {
      const ownerMatch = await LeadMatch.findOne({
        user_id: nurtureUserId,
        conversation_id: effectiveConversationId,
      });
      if (ownerMatch && (!leadForOps || String(ownerMatch._id) !== String(leadForOps._id))) {
        if (shouldAutoUpdatePipelineFromCalendly(ownerMatch) && !isTerminalMatchStatus(ownerMatch.match_status)) {
          ownerMatch.match_status = 'consult_booked';
        }
        ownerMatch.compatibility_factors = { ...ownerMatch.compatibility_factors, calendly: meta };
        ownerMatch.markModified('compatibility_factors');
        await ownerMatch.save();
        emitWorkspaceLeadEvent(ownerMatch.user_id, {
          kind: 'lead_updated',
          lead_match_id: String(ownerMatch._id),
          match_status: ownerMatch.match_status,
          source: 'calendly.invitee.created',
        });
        leadForOps = ownerMatch;
        matchedViaEffective = matchedViaEffective || 'nurture_owner_conversation';
      }
    } catch (e) {
      logger.error(`Calendly invitee.created: failed to align owner LeadMatch: ${e.message}`);
    }
  }
  let bookedViaNurture = false;
  let nurtureLogId = null;
  const utmSourceNorm = String(trackingSource || '').trim().toLowerCase();
  const isNurtureTracking = utmSourceNorm === 'nesti_nurture' || utmSourceNorm.startsWith('nesti_nurture_');
  if (isNurtureTracking && nurtureUserId && (email || effectiveConversationId || match?._id)) {
    try {
      const r = await markRecentNurtureLogBooked({
        userId: nurtureUserId,
        leadMatchId: leadForOps?._id || match?._id || null,
        leadProfileId: leadForOps?.lead_profile_id || match?.lead_profile_id || null,
        conversationId: effectiveConversationId,
        inviteeEmail: email,
        calendlyScheduledStartIso: scheduledStart ? scheduledStart.toISOString() : null,
      });
      bookedViaNurture = r.updated === true;
      nurtureLogId = r.nurture_log_id || null;
    } catch (e) { logger.error(`nurture meeting_booked sync: ${e.message}`); }
  }

  /** Book workspace row whenever we know the professional + thread, even if LeadMatch was not resolved yet (e.g. booked before CRM lead existed). */
  const appointmentUserId = leadForOps?.user_id || match?.user_id || ownerUserIdFromTracking || nurtureUserId;
  if (appointmentUserId && effectiveConversationId) {
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
      });
    } catch (e) {
      logger.error(`workspace appointment upsert: ${e.message}`);
    }
  }

  await emitBookingNotification(leadForOps, effectiveConversationId, bookedViaNurture);

  const ownerUserId = leadForOps?.user_id || match?.user_id || ownerUserIdFromTracking || nurtureUserId;
  if (effectiveConversationId && ownerUserId && email) {
    setImmediate(() =>
      runPostBookingAutomations({
        conversationId: effectiveConversationId,
        userId: ownerUserId,
        inviteeEmail: email,
        inviteeUri: payload?.uri || null,
        leadMatchId: leadForOps?._id || match?._id || null,
      }).catch((e) => logger.error(`postBooking automations: ${e.message}`))
    );
  }

  return {
    processed: true,
    matched: Boolean(leadForOps),
    matched_via: matchedViaEffective,
    lead_match_id: leadForOps ? String(leadForOps._id) : null,
    conversation_id: effectiveConversationId ? String(effectiveConversationId) : null,
    calendly_booking_status: effectiveConversationId ? 'booked' : null,
    reason: leadForOps ? undefined : 'lead_not_found',
  };
}

async function handleInviteeCanceled({
  email,
  trackingUtm,
  trackingSource,
  ownerUserIdFromCalendly,
  ownerUserIdFromTracking,
  payload,
  emailDomain,
}) {
  const { match, matchedVia, conversationId } = await resolveInviteeMatchContext(
    email,
    trackingUtm,
    ownerUserIdFromTracking || ownerUserIdFromCalendly,
  );

  if (conversationId) {
    const conv = await ChatConversation.findById(conversationId).select('calendly_booking_status').lean();
    if (conv?.calendly_booking_status === 'canceled') {
      logger.info('Calendly invitee.canceled: idempotent skip (already canceled)', {
        op: 'calendly.booking',
        conversation_id: String(conversationId),
      });
      return {
        processed: true,
        matched: Boolean(match),
        matched_via: matchedVia,
        lead_match_id: match ? String(match._id) : null,
        conversation_id: String(conversationId),
        calendly_booking_status: 'canceled',
        reason: 'already_canceled',
      };
    }
  }

  if (match) {
    const skipStatus =
      isTerminalMatchStatus(match.match_status) || !shouldAutoUpdatePipelineFromCalendly(match);
    if (!skipStatus) {
      match.match_status = 'nurturing';
    }
    match.compatibility_factors = { ...match.compatibility_factors, calendly: { ...calendlyMeta('invitee.canceled', payload), calendly_canceled: true } };
    match.markModified('compatibility_factors');
    await match.save();
    emitWorkspaceLeadEvent(match.user_id, {
      kind: 'lead_updated',
      lead_match_id: String(match._id),
      match_status: match.match_status,
      source: 'calendly.invitee.canceled',
    });
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

  const nurtureUserId =
    ownerUserIdFromTracking ||
    ownerUserIdFromCalendly ||
    (await resolveOwnerUserIdForNurture(match, conversationId)) ||
    (await resolveNurtureSenderUserIdFromLogs({
      conversationId,
      leadMatchId: match?._id || null,
      inviteeEmail: email,
    }));
  let leadForOps = match;
  let matchedViaEffective = matchedVia;
  if (conversationId && nurtureUserId) {
    try {
      const ownerMatch = await LeadMatch.findOne({
        user_id: nurtureUserId,
        conversation_id: conversationId,
      });
      if (ownerMatch && (!leadForOps || String(ownerMatch._id) !== String(leadForOps._id))) {
        ownerMatch.compatibility_factors = {
          ...ownerMatch.compatibility_factors,
          calendly: { ...calendlyMeta('invitee.canceled', payload), calendly_canceled: true },
        };
        ownerMatch.markModified('compatibility_factors');
        await ownerMatch.save();
        emitWorkspaceLeadEvent(ownerMatch.user_id, {
          kind: 'lead_updated',
          lead_match_id: String(ownerMatch._id),
          match_status: ownerMatch.match_status,
          source: 'calendly.invitee.canceled',
        });
        leadForOps = ownerMatch;
        matchedViaEffective = matchedViaEffective || 'nurture_owner_conversation';
      }
    } catch (e) {
      logger.error(`Calendly invitee.canceled: failed to align owner LeadMatch: ${e.message}`);
    }
  }
  const cancelUserId = leadForOps?.user_id || match?.user_id || ownerUserIdFromTracking || nurtureUserId;

  const utmSourceNorm = String(trackingSource || '').trim().toLowerCase();
  const isNurtureTracking = utmSourceNorm === 'nesti_nurture' || utmSourceNorm.startsWith('nesti_nurture_');
  if (isNurtureTracking && nurtureUserId && (email || conversationId || match?._id)) {
    try {
      await clearRecentNurtureLogMeetingBooked({
        userId: nurtureUserId,
        leadMatchId: leadForOps?._id || match?._id || null,
        leadProfileId: leadForOps?.lead_profile_id || match?.lead_profile_id || null,
        conversationId,
        inviteeEmail: email,
      });
    } catch (e) { logger.error(`nurture meeting_booked clear: ${e.message}`); }
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
    } catch (e) {
      logger.error(`workspace appointment cancel: ${e.message}`);
    }
  }

  await emitCancelNotification(leadForOps, conversationId);

  return {
    processed: true,
    matched: Boolean(leadForOps),
    matched_via: matchedViaEffective,
    lead_match_id: leadForOps ? String(leadForOps._id) : null,
    conversation_id: conversationId ? String(conversationId) : null,
    calendly_booking_status: conversationId ? 'canceled' : null,
    reason: !leadForOps && !conversationId ? 'lead_not_found' : undefined,
  };
}

/**
 * After a successful Calendly API cancellation, align LeadMatch + ChatConversation + notifications.
 * Also used when Nesti initiates cancel (webhook may arrive later and will no-op via idempotent guard).
 */
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
  } catch (e) {
    logger.error(`workspace appointment cancel (api): ${e.message}`);
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
    } catch (e) {
      logger.error(`nurture meeting_booked clear: ${e.message}`);
    }
  }

  await emitCancelNotification(lead, conversationId);
  return { ok: true };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function processCalendlyWebhook(body) {
  const eventName = body?.event;
  const payload   = body?.payload ?? body?.resource;

  if (!eventName || !payload) {
    logger.warn('Calendly webhook: missing event or payload', { op: 'calendly.webhook' });
    return { processed: false, reason: 'missing_fields' };
  }

  const email    = extractInviteeEmail(payload);
  const trackingUtm =
    extractTrackingUtmContent(payload) ||
    extractTrackingUtmContent(body?.payload) ||
    extractTrackingUtmContent(body?.resource) ||
    extractTrackingUtmContent(typeof body === 'object' ? body : null);
  const trackingCampaign =
    extractTrackingUtmCampaign(payload) ||
    extractTrackingUtmCampaign(body?.payload) ||
    extractTrackingUtmCampaign(body?.resource) ||
    extractTrackingUtmCampaign(typeof body === 'object' ? body : null);
  const trackingSource =
    extractTrackingUtmSource(payload) ||
    extractTrackingUtmSource(body?.payload) ||
    extractTrackingUtmSource(body?.resource) ||
    extractTrackingUtmSource(typeof body === 'object' ? body : null);
  const ownerUserIdFromCalendly = await resolveOwnerUserId(payload);
  const ownerUserIdFromTracking =
    trackingCampaign && mongoose.Types.ObjectId.isValid(String(trackingCampaign))
      ? new mongoose.Types.ObjectId(String(trackingCampaign))
      : null;
  const emailDomain = email?.includes('@') ? email.split('@').pop() : null;

  logger.info('Calendly webhook: received', {
    op:                 'calendly.webhook',
    event:              eventName,
    utm_content:        trackingUtm || null,
    utm_campaign:       trackingCampaign || null,
    utm_source:         trackingSource || null,
    has_invitee_email:  Boolean(email),
    owner_user_id_hint: ownerUserIdFromCalendly ? String(ownerUserIdFromCalendly) : null,
    owner_user_id_utm:  ownerUserIdFromTracking ? String(ownerUserIdFromTracking) : null,
    email_domain:       emailDomain,
  });

  const utmConversationId = trackingUtm && mongoose.Types.ObjectId.isValid(trackingUtm) ? new mongoose.Types.ObjectId(trackingUtm) : null;
  if (!email && eventName.startsWith('invitee.') && !utmConversationId) {
    logger.warn('Calendly webhook: no invitee email and no utm conversation id', { op: 'calendly.webhook', event: eventName });
    return { processed: true, matched: false, reason: 'no_email_or_utm' };
  }

  const ctx = {
    email,
    trackingUtm,
    trackingSource,
    ownerUserIdFromCalendly,
    ownerUserIdFromTracking,
    payload,
    emailDomain,
  };

  if (eventName === 'invitee.created')  return handleInviteeCreated(ctx);
  if (eventName === 'invitee.canceled') return handleInviteeCanceled(ctx);

  logger.debug('Calendly webhook: ignored event', { op: 'calendly.webhook', event: eventName });
  return { processed: true, matched: false, reason: 'event_not_handled' };
}
