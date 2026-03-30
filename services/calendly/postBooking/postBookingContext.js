import LeadMatch from '../../../models/LeadMatch.js';
import LeadProfile from '../../../models/LeadProfile.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import { getFlowForRole } from '../../chat/flows/index.js';
import { recomputeSignalsForPropertyMatches } from '../../chatService.js';
import { resolveAgentPropertyMatchesForChat } from '../../agent/propertyMatch/matchService.js';
export function agentDisplayName(ctx) {
  return (
    ctx.professionalProfile?.full_name?.trim() ||
    `${ctx.agentUser?.first_name || ''} ${ctx.agentUser?.last_name || ''}`.trim() ||
    'your agent'
  );
}
export async function loadLeadProfileForConversation({ conversationId, userId, intent }) {
  const suffix = intent === 'sell' ? '_seller$' : '(buyer|client)$';
  const lm = await LeadMatch.findOne({
    conversation_id: conversationId,
    user_id:         userId,
    lead_type:       new RegExp(suffix),
  })
    .select('lead_profile_id')
    .lean();
  if (!lm?.lead_profile_id) return null;
  return LeadProfile.findById(lm.lead_profile_id).lean();
}

export async function fetchPropertyMatchBundle(ctx) {
  const { conversation, userId, flowType } = ctx;
  if (flowType !== PROFESSIONAL_TYPE.AGENT) return { error: 'not_agent_embed' };
  const flow = getFlowForRole(PROFESSIONAL_TYPE.AGENT);
  const storedForm = conversation.form_data || {};
  const storedIntent = storedForm?.intent;
  const aiIntent =
    conversation.intent === 'sell' || conversation.intent === 'buy' ? conversation.intent : 'buy';
  const propertyMatchIntent =
    storedIntent === 'buy' || storedIntent === 'sell' ? storedIntent : aiIntent;

  let signals =
    conversation.lead_reasons && typeof conversation.lead_reasons === 'object'
      ? conversation.lead_reasons.signals
      : null;
  if (!signals || typeof signals !== 'object') {
    signals = await recomputeSignalsForPropertyMatches(conversation, storedForm, flow);
  }

  const {
    property_matches,
    property_matches_context,
    property_matches_note,
  } = await resolveAgentPropertyMatchesForChat({
    isAgent:         true,
    hasContact:      true,
    matchIntent:     propertyMatchIntent,
    userId,
    conversationId:  conversation._id,
    leadMetaSignals: signals,
  });

  return {
    property_matches,
    property_matches_context,
    property_matches_note,
    signals,
    propertyMatchIntent,
    storedForm,
  };
}
