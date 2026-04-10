import crypto from 'crypto';
import mongoose from 'mongoose';
import ChatConversation from '../../models/ChatConversation.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import logger from '../../utils/logger.js';
import { runPostBookingAutomations } from './postBookingAutomations.js';
import {
  markRecentNurtureLogBooked,
  clearRecentNurtureLogMeetingBooked,
} from '../nurture/nurtureMeetingBookingSync.js';
import { buildWorkspaceLeadConversionPreview } from '../conversion/buildLeadConversionPack.js';
import { emitLeadLifecycleNotification } from '../realtime/leadCreatedNotify.js';
import {
  urgencyWindowLabel,
  severityFromConversionPreview,
  primaryNextActionFromPreview,
} from '../lead/leadExperienceContract.js';

export function verifyCalendlySignature(rawBodyString, signatureHeader, signingKey) {
  if (!signingKey || !signatureHeader || rawBodyString == null) return false;
  try {
    const parts = {};
    for (const segment of String(signatureHeader).split(',')) {
      const eq = segment.indexOf('=');
      if (eq === -1) continue;
      parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
    }
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return false;
    const signedPayload = `${t}.${rawBodyString}`;
    const hmac = crypto.createHmac('sha256', signingKey).update(signedPayload).digest('hex');
    const a = Buffer.from(v1, 'utf8');
    const b = Buffer.from(hmac, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEmail(e) {
  if (!e || typeof e !== 'string') return null;
  const t = e.trim().toLowerCase();
  return t || null;
}

function extractInviteeEmail(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return normalizeEmail(payload.email || payload.invitee?.email);
}

function extractTrackingUtmContent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const pick = (tracking) => {
    const v = tracking?.utm_content;
    if (v == null) return null;
    const t = String(v).trim();
    return t || null;
  };
  let u = pick(payload.tracking);
  if (u) return u;
  const ev = payload.scheduled_event;
  if (ev && typeof ev === 'object') {
    u = pick(ev.tracking);
    if (u) return u;
  }
  return null;
}

function calendlyMeta(eventName, payload) {
  return {
    calendly_event:       eventName,
    calendly_updated_at:  new Date().toISOString(),
    calendly_invitee_uri: payload?.uri || null,
    calendly_event_uri:
      typeof payload?.event === 'string'
        ? payload.event
        : payload?.event?.uri || null,
  };
}

/** @returns {{ lead: object | null, matchedVia: 'utm_conversation' | 'leadmatch_contact_email' | 'leadprofile_email' | null }} */
async function findLeadForBooking(email, trackingUtmContent) {
  if (trackingUtmContent && mongoose.Types.ObjectId.isValid(trackingUtmContent)) {
    const byConversation = await LeadMatch.findOne({
      conversation_id: new mongoose.Types.ObjectId(trackingUtmContent),
    });
    if (byConversation) return { lead: byConversation, matchedVia: 'utm_conversation' };
  }

  if (!email) return { lead: null, matchedVia: null };

  const emailRe = new RegExp(`^${escapeRegex(email)}$`, 'i');

  const byContact = await LeadMatch.findOne({
    'compatibility_factors.contact.email': { $regex: emailRe },
  }).sort({ last_contact_at: -1 });
  if (byContact) return { lead: byContact, matchedVia: 'leadmatch_contact_email' };

  // Same email as chat-created LeadProfile (your agent flow always sets both).
  const profile = await LeadProfile.findOne({
    $or: [{ 'identity.canonical_email': { $regex: emailRe } }, { 'identity.email': { $regex: emailRe } }],
  }).sort({ updatedAt: -1 });
  if (profile?._id) {
    const lm = await LeadMatch.findOne({ lead_profile_id: profile._id }).sort({ last_contact_at: -1 });
    if (lm) return { lead: lm, matchedVia: 'leadprofile_email' };
  }

  return { lead: null, matchedVia: null };
}

function resolveConversationObjectId(lead, trackingUtmContent) {
  if (lead?.conversation_id) return lead.conversation_id;
  if (trackingUtmContent && mongoose.Types.ObjectId.isValid(trackingUtmContent)) {
    return new mongoose.Types.ObjectId(trackingUtmContent);
  }
  return null;
}

async function syncChatConversationCalendly(conversationObjectId, { status, setBookedAt }) {
  if (!conversationObjectId) return;
  const $set = { calendly_booking_status: status };
  if (setBookedAt) $set.calendly_booking_at = new Date();
  await ChatConversation.findByIdAndUpdate(conversationObjectId, { $set });
}

async function resolveAgentUserIdForNurture(lead, conversationId) {
  if (lead?.user_id) return lead.user_id;
  if (!conversationId) return null;
  const conv = await ChatConversation.findById(conversationId).select('user_id').lean();
  return conv?.user_id || null;
}

function buildLeadNotificationBase(lead, conversationId, preview) {
  return {
    lead_match_id: lead._id,
    lead_profile_id: lead.lead_profile_id || null,
    conversation_id: conversationId || null,
    session_id: lead.compatibility_factors?.session_id || null,
    grade: String(lead.lead_type || '').split('_')[0] || null,
    score: lead.match_score ?? null,
    urgency: preview?.urgency ?? null,
    urgency_window: urgencyWindowLabel(preview),
    outcomes_headline: preview?.outcomes_headline ?? null,
    action: { type: 'open_lead', lead_match_id: String(lead._id) },
  };
}

export async function processCalendlyWebhook(body) {
  const eventName = body?.event;
  const payload = body?.payload ?? body?.resource;

  if (!eventName || !payload) {
    logger.warn('Calendly webhook: missing event or payload', { op: 'calendly.webhook' });
    return { processed: false, reason: 'missing_fields' };
  }

  const email = extractInviteeEmail(payload);
  const trackingUtm = extractTrackingUtmContent(payload);
  const emailDomain = email && email.includes('@') ? email.split('@').pop() : null;

  logger.info('Calendly webhook: received', {
    op:               'calendly.webhook',
    event:            eventName,
    utm_content:      trackingUtm || null,
    utm_source:
      payload?.tracking?.utm_source?.trim?.() ||
      (typeof payload?.scheduled_event === 'object'
        ? payload.scheduled_event?.tracking?.utm_source?.trim?.()
        : null) ||
      null,
    has_invitee_email: Boolean(email),
    email_domain:     emailDomain,
  });

  const utmConversationId =
    trackingUtm && mongoose.Types.ObjectId.isValid(trackingUtm)
      ? new mongoose.Types.ObjectId(trackingUtm)
      : null;

  if (!email && eventName.startsWith('invitee.') && !utmConversationId) {
    logger.warn('Calendly webhook: no invitee email and no utm conversation id', {
      op:    'calendly.webhook',
      event: eventName,
    });
    return { processed: true, matched: false, reason: 'no_email_or_utm' };
  }

  if (eventName === 'invitee.created') {
    const { lead, matchedVia } = await findLeadForBooking(email, trackingUtm);
    const conversationId = resolveConversationObjectId(lead, trackingUtm);

    if (lead) {
      lead.match_status = 'consult_booked';
      lead.compatibility_factors = {
        ...lead.compatibility_factors,
        calendly: calendlyMeta(eventName, payload),
      };
      await lead.save();
      logger.info('Calendly invitee.created: updated LeadMatch', {
        op:              'calendly.booking',
        leadMatchId:     String(lead._id),
        conversation_id: conversationId ? String(conversationId) : null,
        matched_via:     matchedVia,
        email_domain:    emailDomain,
      });
    } else {
      logger.info('Calendly invitee.created: no LeadMatch', {
        op:           'calendly.booking',
        matched_via:  null,
        email_domain: emailDomain,
        utm_content:  trackingUtm || null,
      });
    }

    if (conversationId) {
      await syncChatConversationCalendly(conversationId, { status: 'booked', setBookedAt: true });
      logger.info('Calendly invitee.created: conversation marked booked', {
        op:              'calendly.booking',
        conversation_id: String(conversationId),
      });
    }

    const nurtureAgentUserId = await resolveAgentUserIdForNurture(lead, conversationId);
    let bookedViaNurture = false;
    if (nurtureAgentUserId && (email || conversationId || lead?._id)) {
      try {
        const syncResult = await markRecentNurtureLogBooked({
          userId: nurtureAgentUserId,
          leadMatchId: lead?._id || null,
          conversationId,
          inviteeEmail: email,
        });
        bookedViaNurture = syncResult.updated === true;
      } catch (e) {
        logger.error(`nurture meeting_booked sync: ${e.message}`);
      }
    }

    if (lead?.user_id && lead?._id) {
      const convForPreview = conversationId
        ? await ChatConversation.findById(conversationId)
            .select('calendly_booking_status lead_reasons last_interaction_at intent')
            .lean()
        : null;
      const preview = buildWorkspaceLeadConversionPreview({
        leadMatch: lead,
        conversation: convForPreview,
        intent: convForPreview?.intent || null,
      });
      await emitLeadLifecycleNotification(lead.user_id, {
        ...buildLeadNotificationBase(lead, conversationId, preview),
        notification_type: 'appointment_booked',
        title: bookedViaNurture ? 'Consultation booked via nurture email' : 'Appointment booked',
        body: bookedViaNurture
          ? `Your nurture email converted — ${preview.why_match_one_liner || 'lead booked a consultation.'}`
          : preview.why_match_one_liner || 'Lead booked an appointment.',
        severity: severityFromConversionPreview(preview?.alert ? { alert: preview.alert } : null),
        intent: convForPreview?.intent || null,
        appointment_status: 'booked',
        booked_via_nurture: bookedViaNurture,
        speed_to_lead_tip: preview?.urgency === 'immediate' ? 'Confirm appointment details now to reduce no-shows.' : null,
        booking_cta: preview?.booking_cta ?? null,
        primary_next_action: primaryNextActionFromPreview(preview),
      });
    }

    let ownerUserId = lead?.user_id || null;
    if (conversationId && !ownerUserId) {
      const convOwner = await ChatConversation.findById(conversationId).select('user_id').lean();
      ownerUserId = convOwner?.user_id || null;
    }
    if (conversationId && ownerUserId && email) {
      const inviteeUri = payload?.uri || null;
      logger.info('Calendly invitee.created: scheduling post-booking automations', {
        op:              'calendly.booking',
        conversation_id: String(conversationId),
        user_id:         String(ownerUserId),
        lead_match_id:   lead?._id ? String(lead._id) : null,
      });
      setImmediate(() => {
        runPostBookingAutomations({
          conversationId,
          userId:       ownerUserId,
          inviteeEmail: email,
          inviteeUri,
          leadMatchId:  lead?._id || null,
        }).catch((e) => logger.error(`postBooking automations: ${e.message}`));
      });
    }

    return {
      processed: true,
      matched: Boolean(lead),
      matched_via: matchedVia,
      lead_match_id: lead ? String(lead._id) : null,
      conversation_id: conversationId ? String(conversationId) : null,
      calendly_booking_status: conversationId ? 'booked' : null,
      reason: lead ? undefined : 'lead_not_found',
    };
  }

  if (eventName === 'invitee.canceled') {
    const { lead, matchedVia } = await findLeadForBooking(email, trackingUtm);
    const conversationId = resolveConversationObjectId(lead, trackingUtm);

    if (lead) {
      lead.match_status = 'nurturing';
      lead.compatibility_factors = {
        ...lead.compatibility_factors,
        calendly: {
          ...calendlyMeta(eventName, payload),
          calendly_canceled: true,
        },
      };
      await lead.save();
      logger.info('Calendly invitee.canceled: set nurturing', {
        op:              'calendly.booking',
        leadMatchId:     String(lead._id),
        conversation_id: conversationId ? String(conversationId) : null,
        matched_via:     matchedVia,
        email_domain:    emailDomain,
      });
    }

    if (conversationId) {
      await syncChatConversationCalendly(conversationId, { status: 'canceled', setBookedAt: false });
      logger.info('Calendly invitee.canceled: conversation marked canceled', {
        op:              'calendly.booking',
        conversation_id: String(conversationId),
      });
    }

    const nurtureAgentUserIdCanceled = await resolveAgentUserIdForNurture(lead, conversationId);
    if (nurtureAgentUserIdCanceled && (email || conversationId || lead?._id)) {
      try {
        await clearRecentNurtureLogMeetingBooked({
          userId: nurtureAgentUserIdCanceled,
          leadMatchId: lead?._id || null,
          conversationId,
          inviteeEmail: email,
        });
      } catch (e) {
        logger.error(`nurture meeting_booked clear: ${e.message}`);
      }
    }

    if (lead?.user_id && lead?._id) {
      const convForPreview = conversationId
        ? await ChatConversation.findById(conversationId)
            .select('calendly_booking_status lead_reasons last_interaction_at intent')
            .lean()
        : null;
      const preview = buildWorkspaceLeadConversionPreview({
        leadMatch: lead,
        conversation: convForPreview,
        intent: convForPreview?.intent || null,
      });
      await emitLeadLifecycleNotification(lead.user_id, {
        ...buildLeadNotificationBase(lead, conversationId, preview),
        notification_type: 'appointment_canceled',
        title: 'Appointment canceled',
        body: 'Booked appointment was canceled. Re-engage quickly to recover this opportunity.',
        severity: 'high',
        intent: convForPreview?.intent || null,
        appointment_status: 'canceled',
        urgency: 'same_day',
        urgency_window: '24 hr',
        speed_to_lead_tip: 'Follow up within the same day to recover booking momentum.',
        booking_cta: 'Offer 2-3 new time slots now.',
        primary_next_action: {
          id: 'offer_meeting_slots',
          title: 'Offer 2-3 specific times to rebook',
          follow_up_template: preview?.primary_follow_up_template ?? null,
        },
      });
    }

    return {
      processed: true,
      matched: Boolean(lead),
      matched_via: matchedVia,
      lead_match_id: lead ? String(lead._id) : null,
      conversation_id: conversationId ? String(conversationId) : null,
      calendly_booking_status: conversationId ? 'canceled' : null,
      reason: !lead && !conversationId ? 'lead_not_found' : undefined,
    };
  }

  logger.debug('Calendly webhook: ignored event', { op: 'calendly.webhook', event: eventName });
  return { processed: true, matched: false, reason: 'event_not_handled' };
}
