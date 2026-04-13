import crypto from 'crypto';
import mongoose from 'mongoose';
import ChatConversation from '../../models/ChatConversation.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import CalendarIntegration from '../../models/CalendarIntegration.js';
import logger from '../../utils/logger.js';
import { runPostBookingAutomations } from './postBookingAutomations.js';
import { markRecentNurtureLogBooked, clearRecentNurtureLogMeetingBooked } from '../nurture/nurtureMeetingBookingSync.js';
import { buildWorkspaceLeadConversionPreview } from '../conversion/buildLeadConversionPack.js';
import { emitLeadLifecycleNotification } from '../realtime/leadCreatedNotify.js';
import { urgencyWindowLabel, severityFromConversionPreview, primaryNextActionFromPreview } from '../lead/leadExperienceContract.js';

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
  const pick = (t) => { const v = String(t?.utm_content ?? '').trim(); return v || null; };
  return pick(payload?.tracking) || pick(payload?.scheduled_event?.tracking) || null;
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
  return {
    calendly_event:       eventName,
    calendly_updated_at:  new Date().toISOString(),
    calendly_invitee_uri: payload?.uri || null,
    calendly_event_uri:   typeof payload?.event === 'string' ? payload.event : payload?.event?.uri || null,
  };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function resolveOwnerUserId(payload) {
  const uri = extractCalendlyOwnerUri(payload);
  if (!uri) return null;
  const doc = await CalendarIntegration.findOne({ provider: 'calendly', calendly_user_uri: uri }).select('user_id').lean();
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

async function handleInviteeCreated({ email, trackingUtm, ownerUserIdFromCalendly, payload, emailDomain }) {
  const { lead, matchedVia } = await findLeadForBooking(email, trackingUtm, ownerUserIdFromCalendly);
  const conversationId = resolveConversationId(lead, trackingUtm);

  if (lead) {
    lead.match_status = 'consult_booked';
    lead.compatibility_factors = { ...lead.compatibility_factors, calendly: calendlyMeta('invitee.created', payload) };
    await lead.save();
    logger.info('Calendly invitee.created: updated LeadMatch', { op: 'calendly.booking', leadMatchId: String(lead._id), conversation_id: conversationId ? String(conversationId) : null, matched_via: matchedVia, email_domain: emailDomain });
  } else {
    logger.info('Calendly invitee.created: no LeadMatch', { op: 'calendly.booking', email_domain: emailDomain, utm_content: trackingUtm || null });
  }

  if (conversationId) {
    await syncConversationCalendly(conversationId, 'booked', true);
    logger.info('Calendly invitee.created: conversation marked booked', { op: 'calendly.booking', conversation_id: String(conversationId) });
  }

  const nurtureUserId = await resolveOwnerUserIdForNurture(lead, conversationId);
  let bookedViaNurture = false;
  if (nurtureUserId && (email || conversationId || lead?._id)) {
    try {
      const r = await markRecentNurtureLogBooked({ userId: nurtureUserId, leadMatchId: lead?._id || null, conversationId, inviteeEmail: email });
      bookedViaNurture = r.updated === true;
    } catch (e) { logger.error(`nurture meeting_booked sync: ${e.message}`); }
  }

  await emitBookingNotification(lead, conversationId, bookedViaNurture);

  const ownerUserId = lead?.user_id || (conversationId ? (await ChatConversation.findById(conversationId).select('user_id').lean())?.user_id : null);
  if (conversationId && ownerUserId && email) {
    logger.info('Calendly invitee.created: scheduling post-booking automations', { op: 'calendly.booking', conversation_id: String(conversationId), user_id: String(ownerUserId), lead_match_id: lead?._id ? String(lead._id) : null });
    setImmediate(() =>
      runPostBookingAutomations({ conversationId, userId: ownerUserId, inviteeEmail: email, inviteeUri: payload?.uri || null, leadMatchId: lead?._id || null })
        .catch((e) => logger.error(`postBooking automations: ${e.message}`))
    );
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

async function handleInviteeCanceled({ email, trackingUtm, ownerUserIdFromCalendly, payload, emailDomain }) {
  const { lead, matchedVia } = await findLeadForBooking(email, trackingUtm, ownerUserIdFromCalendly);
  const conversationId = resolveConversationId(lead, trackingUtm);

  if (lead) {
    lead.match_status = 'nurturing';
    lead.compatibility_factors = { ...lead.compatibility_factors, calendly: { ...calendlyMeta('invitee.canceled', payload), calendly_canceled: true } };
    await lead.save();
    logger.info('Calendly invitee.canceled: set nurturing', { op: 'calendly.booking', leadMatchId: String(lead._id), conversation_id: conversationId ? String(conversationId) : null, matched_via: matchedVia, email_domain: emailDomain });
  }

  if (conversationId) {
    await syncConversationCalendly(conversationId, 'canceled', false);
    logger.info('Calendly invitee.canceled: conversation marked canceled', { op: 'calendly.booking', conversation_id: String(conversationId) });
  }

  const nurtureUserId = await resolveOwnerUserIdForNurture(lead, conversationId);
  if (nurtureUserId && (email || conversationId || lead?._id)) {
    try {
      await clearRecentNurtureLogMeetingBooked({ userId: nurtureUserId, leadMatchId: lead?._id || null, conversationId, inviteeEmail: email });
    } catch (e) { logger.error(`nurture meeting_booked clear: ${e.message}`); }
  }

  await emitCancelNotification(lead, conversationId);

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

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function processCalendlyWebhook(body) {
  const eventName = body?.event;
  const payload   = body?.payload ?? body?.resource;

  if (!eventName || !payload) {
    logger.warn('Calendly webhook: missing event or payload', { op: 'calendly.webhook' });
    return { processed: false, reason: 'missing_fields' };
  }

  const email    = extractInviteeEmail(payload);
  const trackingUtm = extractTrackingUtmContent(payload);
  const ownerUserIdFromCalendly = await resolveOwnerUserId(payload);
  const emailDomain = email?.includes('@') ? email.split('@').pop() : null;

  logger.info('Calendly webhook: received', {
    op:                 'calendly.webhook',
    event:              eventName,
    utm_content:        trackingUtm || null,
    utm_source:         payload?.tracking?.utm_source?.trim?.() || payload?.scheduled_event?.tracking?.utm_source?.trim?.() || null,
    has_invitee_email:  Boolean(email),
    owner_user_id_hint: ownerUserIdFromCalendly ? String(ownerUserIdFromCalendly) : null,
    email_domain:       emailDomain,
  });

  const utmConversationId = trackingUtm && mongoose.Types.ObjectId.isValid(trackingUtm) ? new mongoose.Types.ObjectId(trackingUtm) : null;
  if (!email && eventName.startsWith('invitee.') && !utmConversationId) {
    logger.warn('Calendly webhook: no invitee email and no utm conversation id', { op: 'calendly.webhook', event: eventName });
    return { processed: true, matched: false, reason: 'no_email_or_utm' };
  }

  const ctx = { email, trackingUtm, ownerUserIdFromCalendly, payload, emailDomain };

  if (eventName === 'invitee.created')  return handleInviteeCreated(ctx);
  if (eventName === 'invitee.canceled') return handleInviteeCanceled(ctx);

  logger.debug('Calendly webhook: ignored event', { op: 'calendly.webhook', event: eventName });
  return { processed: true, matched: false, reason: 'event_not_handled' };
}
