import mongoose from 'mongoose';
import ChatConversation from '../../../models/ChatConversation.js';
import LeadMatch from '../../../models/LeadMatch.js';
import LeadProfile from '../../../models/LeadProfile.js';
import CalendarIntegration from '../../../models/CalendarIntegration.js';
import NurtureLog from '../../../models/NurtureLog.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import { extractCalendlyOwnerUri } from './tracking.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ownerFilter(userId) {
  return userId && mongoose.Types.ObjectId.isValid(String(userId))
    ? { user_id: new mongoose.Types.ObjectId(String(userId)) }
    : {};
}

const SELLER_LEAD_MATCH_EXCLUSION = {
  lead_type: { $not: /seller/i },
};
const SELLER_LEAD_PROFILE_EXCLUSION = {
  $nor: [
    { 'intent_summary.primary_intent': 'sell' },
    { intent: 'sell' },
    { 'property.images.0': { $exists: true } },
  ],
};

export async function resolveOwnerUserId(payload) {
  const uri = extractCalendlyOwnerUri(payload);
  if (!uri) return null;
  const doc = await CalendarIntegration.findOne({ provider: 'calendly', calendly_user_uri: uri }).select('user_id').lean();
  return doc?.user_id || null;
}

export async function resolveNurtureSenderUserIdFromLogs({ conversationId, leadMatchId, inviteeEmail }) {
  const or = [];
  if (leadMatchId && mongoose.Types.ObjectId.isValid(String(leadMatchId))) {
    or.push({ lead_match_id: new mongoose.Types.ObjectId(String(leadMatchId)) });
  }
  if (conversationId && mongoose.Types.ObjectId.isValid(String(conversationId))) {
    or.push({ conversation_id: new mongoose.Types.ObjectId(String(conversationId)) });
  }
  const email = inviteeEmail && String(inviteeEmail).trim().toLowerCase();
  if (email) {
    or.push({ to_email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
  }
  if (!or.length) return null;

  const doc = await NurtureLog.findOne({ status: 'sent', $or: or })
    .sort({ sent_at: -1, createdAt: -1 })
    .select('user_id')
    .lean();
  return doc?.user_id || null;
}

export async function findLeadForBooking(email, trackingUtm, ownerUserId = null) {
  const filter = ownerFilter(ownerUserId);

  if (trackingUtm && mongoose.Types.ObjectId.isValid(trackingUtm)) {
    const byLeadMatchId = await LeadMatch.findOne({
      _id: new mongoose.Types.ObjectId(trackingUtm),
      ...filter,
      ...SELLER_LEAD_MATCH_EXCLUSION,
    });
    if (byLeadMatchId) return { lead: byLeadMatchId, matchedVia: 'utm_lead_match' };

    const lead = await LeadMatch.findOne({ conversation_id: new mongoose.Types.ObjectId(trackingUtm), ...filter });
    if (lead) return { lead, matchedVia: 'utm_conversation' };
  }

  if (!email) return { lead: null, matchedVia: null };

  const emailRe = new RegExp(`^${String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

  const byContact = await LeadMatch.findOne({
    'compatibility_factors.contact.email': { $regex: emailRe },
    ...SELLER_LEAD_MATCH_EXCLUSION,
    ...filter,
  }).sort({ last_contact_at: -1 });
  if (byContact) return { lead: byContact, matchedVia: 'leadmatch_contact_email' };

  const profile = await LeadProfile.findOne({
    $or: [{ 'identity.canonical_email': { $regex: emailRe } }, { 'identity.email': { $regex: emailRe } }],
    ...SELLER_LEAD_PROFILE_EXCLUSION,
  }).sort({ updatedAt: -1 });
  if (profile?._id) {
    const leadMatch = await LeadMatch.findOne({
      lead_profile_id: profile._id,
      ...SELLER_LEAD_MATCH_EXCLUSION,
      ...filter,
    }).sort({ last_contact_at: -1 });
    if (leadMatch) return { lead: leadMatch, matchedVia: 'leadprofile_email' };
  }

  return { lead: null, matchedVia: null };
}

export function resolveConversationId(lead, trackingUtm, matchedVia = '') {
  if (lead?.conversation_id) return lead.conversation_id;
  if (
    trackingUtm &&
    mongoose.Types.ObjectId.isValid(trackingUtm) &&
    String(matchedVia || '').includes('conversation')
  ) {
    return new mongoose.Types.ObjectId(trackingUtm);
  }
  return null;
}

export async function resolveInviteeMatchContext(email, trackingUtm, ownerUserIdFromCalendly) {
  let { lead: match, matchedVia } = await findLeadForBooking(email, trackingUtm, ownerUserIdFromCalendly);
  const trackingConversationId =
    trackingUtm && mongoose.Types.ObjectId.isValid(String(trackingUtm))
      ? new mongoose.Types.ObjectId(String(trackingUtm))
      : null;

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
    conversationId: resolveConversationId(match, trackingUtm, matchedVia),
  };
}

export async function resolveOwnerUserIdForNurture(lead, conversationId) {
  if (lead?.user_id) return lead.user_id;
  if (!conversationId) return null;
  const conv = await ChatConversation.findById(conversationId).select('user_id').lean();
  return conv?.user_id || null;
}

export async function syncConversationCalendly(conversationId, status, setBookedAt = false) {
  if (!conversationId) return;
  const $set = { calendly_booking_status: status };
  if (setBookedAt) $set.calendly_booking_at = new Date();
  await ChatConversation.findByIdAndUpdate(conversationId, { $set });
}

export function leadProfessionalType(lead) {
  return String(lead?.compatibility_factors?.professional_type || '').trim().toLowerCase();
}

export function shouldAutoUpdatePipelineFromCalendly(lead) {
  return leadProfessionalType(lead) === PROFESSIONAL_TYPE.AGENT;
}

export async function resolveBookingNurtureUserId({
  ownerUserIdFromTracking,
  ownerUserIdFromCalendly,
  match,
  conversationId,
  isPublicProfileBooking,
  email,
}) {
  return (
    ownerUserIdFromTracking ||
    ownerUserIdFromCalendly ||
    (await resolveOwnerUserIdForNurture(match, conversationId)) ||
    (isPublicProfileBooking
      ? null
      : await resolveNurtureSenderUserIdFromLogs({
          conversationId,
          leadMatchId: match?._id || null,
          inviteeEmail: email,
        }))
  );
}
