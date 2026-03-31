import ChatMessage from '../../../models/ChatMessage.js';
import ChatbotEmbedUrl from '../../../models/ChatbotEmbedUrl.js';
import {
  WIDGET_AGENT_TYPE,
  isValidProfessionalType,
  resolveChatFlowType,
  resolveFlowTypeFromLegacySignals,
} from '../../../constants/roles.js';
import { extractSignals, mergeSignals } from '../scoring/index.js';

export async function flowTypeForConversation(conversation, professionalProfile) {
  if (conversation?.embed_flow_role && isValidProfessionalType(conversation.embed_flow_role)) {
    return conversation.embed_flow_role;
  }
  const normalizedAgentType = conversation.agent_type || WIDGET_AGENT_TYPE.AGENT;
  if (conversation?.embed_id) {
    const emb = await ChatbotEmbedUrl.findById(conversation.embed_id).select('widget_role').lean();
    if (emb) {
      return resolveChatFlowType({ embed: emb, normalizedAgentType, professionalProfile });
    }
  }
  return resolveFlowTypeFromLegacySignals({ normalizedAgentType, professionalProfile });
}

export async function recomputeSignalsForPropertyMatches(conversation, storedForm, flow) {
  const allUserMessages = await ChatMessage.find({
    conversation_id: conversation._id,
    role: 'user',
  })
    .sort({ createdAt: 1 })
    .select('content')
    .lean();
  const conversationText = allUserMessages.map((m) => m.content).join(' ');
  const formSignals = flow.getFormSignals(storedForm || {});
  const textSignals = extractSignals(conversationText);
  let signals = mergeSignals(formSignals, textSignals);
  const lastAssistant = await ChatMessage.findOne({
    conversation_id: conversation._id,
    role: 'assistant',
  })
    .sort({ createdAt: -1 })
    .select('meta')
    .lean();
  const parsed = lastAssistant?.meta?.ai_metadata?.extracted_data || {};
  if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
    signals = mergeSignals(signals, flow.mergeSignalsForMeta(signals, parsed));
  }
  return signals;
}
