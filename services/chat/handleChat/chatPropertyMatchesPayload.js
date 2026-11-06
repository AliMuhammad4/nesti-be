import LeadMatch from '../../../models/LeadMatch.js';
import { resolveAgentPropertyMatchesForChat } from '../../agent/propertyMatch/matchService.js';
import { enrichPropertyMatch } from '../../lead/leadPropertyMatchHelpers.js';
import { buildLeadConversionPack } from '../../conversion/buildLeadConversionPack.js';
import { accumulateContactInfo } from '../utils/contactUtils.js';
import { mergeFormContactData } from '../utils/mergeFormContactData.js';
import { recomputeSignalsForPropertyMatches } from './chatFlowResolution.js';
import { parsePageLimitPagination, buildPaginationMeta, PAGINATION_PRESETS } from '../../../utils/pagination.js';
import { selectChatPropertyMatches, loadAppliedAssistantSetting } from '../../professionalAssistant/professionalAssistantService.js';

export function shouldMarkPropertyOptionsShown(status) {
  return status === 'ready';
}

export async function buildPropertyMatchesPayload({
  conversation,
  userId,
  visitorId,
  formContact,
  page,
  limit,
  flow,
  matchMode = 'strict',
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
    { property_matches, property_matches_context, property_matches_note, property_matches_status },
    leadMatchDoc,
  ] = await Promise.all([
    resolveAgentPropertyMatchesForChat({
      isAgent: true,
      hasContact,
      matchIntent: propertyMatchIntent,
      userId,
      conversationId: conversation._id,
      leadMetaSignals: signals,
      matchMode,
    }),
    LeadMatch.findOne({ conversation_id: conversation._id, user_id: userId })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const assistantSetting = await loadAppliedAssistantSetting(userId);
  const shownMatches = selectChatPropertyMatches(property_matches, assistantSetting);
  const matchStatus = property_matches_status || (shownMatches.length ? 'ready' : 'pending');
  const investorContext = String(property_matches_context || '').toLowerCase() === 'investor'
    || String(storedForm?.client_type || '').toLowerCase() === 'investor'
    || String(storedForm?.motivation_reason || '').toLowerCase() === 'investment'
    || Boolean(storedForm?.investment_type || storedForm?.investment_goal);
  const emptyMatchesNote = investorContext
    ? 'I don’t have investment options to show right now. Your agent can share listings that fit your markets and budget.'
    : 'I don’t have listings to show right now. Your agent can share options that fit what you’re looking for.';
  const propertyMatchesNote = matchStatus !== 'ready'
    ? null
    : shownMatches.length
      ? property_matches_note
      : emptyMatchesNote;
  const resolvedMatchesContext = investorContext && propertyMatchIntent === 'buy'
    ? 'investor'
    : property_matches_context;

  const { page: p, limit: l, offset } = parsePageLimitPagination({ page, limit }, PAGINATION_PRESETS.propertyMatches);
  const total_matches = shownMatches.length;
  const pagedMatches = shownMatches.slice(offset, offset + l).map(enrichPropertyMatch);

  const conversion = leadMatchDoc
    ? buildLeadConversionPack({ leadMatch: leadMatchDoc, conversation, intent: propertyMatchIntent })
    : null;

  if (shouldMarkPropertyOptionsShown(matchStatus)) {
    const nextForm = {
      ...(conversation.form_data && typeof conversation.form_data === 'object' ? conversation.form_data : {}),
      property_matches_shown: true,
      property_options_status: 'shown',
    };
    conversation.form_data = nextForm;
    await conversation.save();
  }

  return {
    success: true,
    session_id: String(conversation.session_id || ''),
    visitor_id: visitorId || null,
    meta: {
      property_matches: pagedMatches,
      property_matches_context: resolvedMatchesContext,
      property_matches_note: propertyMatchesNote,
      property_matches_status: matchStatus,
      pagination: buildPaginationMeta({ page: p, limit: l, total: total_matches }),
      ...(conversion ? { conversion } : {}),
    },
  };
}
