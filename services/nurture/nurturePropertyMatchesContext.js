import mongoose from 'mongoose';
import ChatConversation from '../../models/ChatConversation.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { flowTypeForConversation, recomputeSignalsForPropertyMatches } from '../chat/handleChat/chatFlowResolution.js';
import { getFlowForRole } from '../chat/flows/getFlowForRole.js';
import { supportsPropertyMatches } from '../chat/flows/flowRoleMeta.js';
import { accumulateContactInfo } from '../chat/utils/contactUtils.js';
import { mergeFormContactData } from '../chat/utils/mergeFormContactData.js';
import { resolveAgentPropertyMatchesForChat } from '../agent/propertyMatch/matchService.js';
import logger from '../../utils/logger.js';

const MAX_LISTINGS = 8;
const SUMMARY_MAX = 480;

function compactListing(m) {
  if (!m || typeof m !== 'object') return null;
  const reasons = Array.isArray(m.match_reasons)
    ? m.match_reasons.slice(0, 4).map((r) => String(r).trim().slice(0, 160))
    : [];
  const sum = String(m.summary || '').trim();
  return {
    title: m.title || null,
    address: m.address || null,
    location: m.location || null,
    price: m.price != null && Number.isFinite(Number(m.price)) ? Number(m.price) : null,
    bedrooms: m.bedrooms ?? null,
    bathrooms: m.bathrooms ?? null,
    property_type: m.property_type || null,
    listing_url: m.listing_url || null,
    summary: sum ? sum.slice(0, SUMMARY_MAX) : null,
    match_score: m.match_score != null ? m.match_score : null,
    match_headline: m.match_headline || null,
    source: m.source || null,
    ...(reasons.length ? { match_reasons: reasons } : {}),
  };
}

/**
 * Same resolution as chat property-matches, compacted for nurture email context (agent + buy/sell flows only).
 */
function logNurturePropertyMatches(payload) {
  logger.info('nurture.property_matches', { op: 'nurture.property_matches', ...payload });
  if (process.env.NODE_ENV !== 'production') {
    console.log('[nurture:property-matches]', payload);
  }
}

export async function loadPropertyMatchesForNurtureEmail({
  userId,
  conversationId,
  leadProfessionalType,
  professionalProfile: profileIn,
}) {
  const empty = { listings: [], context: null, note: null };
  try {
    if (!userId || !conversationId || !mongoose.Types.ObjectId.isValid(String(conversationId))) {
      logNurturePropertyMatches({
        stage:   'skip',
        reason:  'missing_or_invalid_conversation_id',
        user_id: String(userId),
        conversation_id: conversationId ? String(conversationId) : null,
      });
      return empty;
    }
    if (leadProfessionalType && leadProfessionalType !== PROFESSIONAL_TYPE.AGENT) {
      logNurturePropertyMatches({
        stage: 'skip',
        reason: 'not_agent_lead_professional_type',
        lead_professional_type: leadProfessionalType,
        conversation_id: String(conversationId),
      });
      return empty;
    }

    const conversation = await ChatConversation.findById(conversationId).lean();
    if (!conversation) {
      logNurturePropertyMatches({
        stage: 'skip',
        reason: 'conversation_not_found',
        conversation_id: String(conversationId),
      });
      return empty;
    }

    const professionalProfile =
      profileIn ||
      (await ProfessionalProfile.findOne({ user_id: userId }).select('professional_type').lean());
    const flowType = await flowTypeForConversation(conversation, professionalProfile);
    const flow = getFlowForRole(flowType);
    if (!supportsPropertyMatches(flow)) {
      logNurturePropertyMatches({
        stage: 'skip',
        reason: 'flow_does_not_support_property_matches',
        flow_type: flowType,
        conversation_id: String(conversation._id),
      });
      return empty;
    }

    const contactInfo = await accumulateContactInfo(conversation._id);
    const hasContact = Boolean(contactInfo.email || contactInfo.phone || contactInfo.name);
    if (!hasContact) {
      logNurturePropertyMatches({
        stage: 'skip',
        reason: 'no_contact_on_conversation',
        conversation_id: String(conversation._id),
      });
      return empty;
    }

    const storedForm = mergeFormContactData(
      conversation.form_data && typeof conversation.form_data === 'object' ? conversation.form_data : {},
      {},
    );
    const storedIntent = storedForm?.intent;
    const aiIntent =
      conversation.intent === 'sell' || conversation.intent === 'buy' ? conversation.intent : 'buy';
    const propertyMatchIntent =
      storedIntent === 'buy' || storedIntent === 'sell' ? storedIntent : aiIntent;

    const leadReasons = conversation.lead_reasons;
    let signals = leadReasons && typeof leadReasons === 'object' ? leadReasons.signals : null;
    if (!signals || typeof signals !== 'object') {
      signals = await recomputeSignalsForPropertyMatches(conversation, storedForm, flow);
    }

    const { property_matches, property_matches_context, property_matches_note } =
      await resolveAgentPropertyMatchesForChat({
        isAgent:         true,
        hasContact,
        matchIntent:     propertyMatchIntent,
        userId,
        conversationId:  conversation._id,
        leadMetaSignals: signals,
      });

    const raw = Array.isArray(property_matches) ? property_matches : [];
    const listings = raw
      .slice(0, MAX_LISTINGS)
      .map(compactListing)
      .filter(Boolean);

    const preview = listings.map((L, i) => ({
      i: i + 1,
      title: L.title,
      location: L.location,
      price: L.price,
      match_score: L.match_score,
      match_headline: L.match_headline,
      source: L.source,
    }));

    logNurturePropertyMatches({
      stage: 'resolved',
      conversation_id: String(conversation._id),
      user_id: String(userId),
      property_match_intent: propertyMatchIntent,
      raw_match_count: raw.length,
      compact_listings_sent_to_ai: listings.length,
      property_matches_context: property_matches_context || null,
      property_matches_note: property_matches_note || null,
      listings_preview: preview,
    });

    return {
      listings,
      context: property_matches_context || null,
      note: property_matches_note || null,
    };
  } catch (err) {
    logger.warn('nurture: property matches context failed', { error: err.message });
    logNurturePropertyMatches({ stage: 'error', error: err.message });
    return empty;
  }
}
