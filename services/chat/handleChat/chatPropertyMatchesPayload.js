import LeadMatch from '../../../models/LeadMatch.js';
import { resolveAgentPropertyMatchesForChat } from '../../agent/propertyMatch/matchService.js';
import { buildLeadConversionPack } from '../../conversion/buildLeadConversionPack.js';
import { accumulateContactInfo } from '../utils/contactUtils.js';
import { mergeFormContactData } from '../utils/mergeFormContactData.js';
import { recomputeSignalsForPropertyMatches } from './chatFlowResolution.js';
import { parsePageLimitPagination, buildPaginationMeta, PAGINATION_PRESETS } from '../../../utils/pagination.js';

export async function buildPropertyMatchesPayload({
  conversation,
  userId,
  visitorId,
  formContact,
  page,
  limit,
  flow,
}) {
  const contactInfo = await accumulateContactInfo(conversation._id);
  const hasContact = Boolean(contactInfo.email || contactInfo.phone || contactInfo.name);
  const storedForm = mergeFormContactData(
    conversation.form_data && typeof conversation.form_data === 'object' ? conversation.form_data : {},
    formContact && typeof formContact === 'object' ? formContact : {},
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

  const [
    { property_matches, property_matches_context, property_matches_note },
    leadMatchDoc,
  ] = await Promise.all([
    resolveAgentPropertyMatchesForChat({
      isAgent: true,
      hasContact,
      matchIntent: propertyMatchIntent,
      userId,
      conversationId: conversation._id,
      leadMetaSignals: signals,
    }),
    LeadMatch.findOne({ conversation_id: conversation._id, user_id: userId })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const { page: p, limit: l, offset } = parsePageLimitPagination({ page, limit }, PAGINATION_PRESETS.propertyMatches);
  const total_matches = Array.isArray(property_matches) ? property_matches.length : 0;
  const pagedMatches = Array.isArray(property_matches)
    ? property_matches.slice(offset, offset + l)
    : [];

  const conversion = leadMatchDoc
    ? buildLeadConversionPack({ leadMatch: leadMatchDoc, conversation, intent: propertyMatchIntent })
    : null;

  return {
    success: true,
    session_id: String(conversation.session_id || ''),
    visitor_id: visitorId || null,
    meta: {
      property_matches: pagedMatches,
      property_matches_context,
      property_matches_note,
      pagination: buildPaginationMeta({ page: p, limit: l, total: total_matches }),
      ...(conversion ? { conversion } : {}),
    },
  };
}
