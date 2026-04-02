import crypto from 'crypto';
import ChatConversation from '../../models/ChatConversation.js';
import ChatMessage from '../../models/ChatMessage.js';
import ChatbotEmbedUrl from '../../models/ChatbotEmbedUrl.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import logger from '../../utils/logger.js';
import {
  normalizeAgentType,
  classifyIntentFromKeywords,
} from './utils/normalizationUtils.js';
import {
  resolveVisitor,
  extractContactFromMessage,
  mergeContact,
  accumulateContactInfo,
} from './utils/contactUtils.js';
import { mergeFormContactData } from './utils/mergeFormContactData.js';
import { mergeSignals, extractSignals } from './scoring/index.js';
import { getFlowForRole } from './flows/getFlowForRole.js';
import {
  supportsPropertyMatches,
  classifyLeadForFlow,
} from './flows/flowRoleMeta.js';
import { resolveAgentPropertyMatchesForChat } from '../agent/propertyMatch/matchService.js';
import {
  isValidProfessionalType,
  professionalTypeToWidgetAgentType,
  resolveChatFlowType,
} from '../../constants/roles.js';
import {
  flowTypeForConversation,
  recomputeSignalsForPropertyMatches,
  resolveCalendlyLinksForVisitor,
  shouldDeferCalendlyLink,
  buildFlowSystemPromptOptions,
  runChatOpenAiTurn,
  syncLeadMatchAfterTurn,
  buildChatResponseMeta,
} from './handleChat/index.js';
import { isAutomatedBookingEnabledForFlow } from './flows/flowRoleMeta.js';

export { flowTypeForConversation, recomputeSignalsForPropertyMatches } from './handleChat/index.js';
export const handlePropertyMatchesService = async ({
  id: sessionId,
  embedToken,
  visitorId,
  formContact,
}) => {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
    return { status: 400, body: { success: false, message: 'id (session_id) is required' } };
  }
  if (!embedToken || typeof embedToken !== 'string' || !embedToken.trim()) {
    return { status: 400, body: { success: false, message: 'embedToken is required' } };
  }
  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
  if (!embed) {
    return { status: 403, body: { success: false, message: 'Invalid or inactive embed token' } };
  }
  const userId = embed.user_id;
  const conversation = await ChatConversation.findOne({
    session_id: sessionId.trim(),
    user_id: userId,
  });
  if (!conversation) {
    logger.warn('Chat service: property-matches session not found', {
      op: 'chat.property_matches',
      session_id: sessionId.trim(),
      owner_user_id: String(userId),
    });
    return { status: 404, body: { success: false, message: 'Session not found' } };
  }
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: userId });
  const flowType = await flowTypeForConversation(conversation, professionalProfile);
  const flow = getFlowForRole(flowType);
  if (!supportsPropertyMatches(flow)) {
    return {
      status: 200,
      body: {
        success: true,
        session_id: sessionId.trim(),
        visitor_id: visitorId || null,
        meta: {
          property_matches: [],
          property_matches_context: null,
          property_matches_note: null,
        },
      },
    };
  }

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
  const {
    property_matches,
    property_matches_context,
    property_matches_note,
  } = await resolveAgentPropertyMatchesForChat({
    isAgent: true,
    hasContact,
    matchIntent: propertyMatchIntent,
    userId,
    conversationId: conversation._id,
    leadMetaSignals: signals,
  });

  return {
    status: 200,
    body: {
      success: true,
      session_id: sessionId.trim(),
      visitor_id: visitorId || null,
      meta: {
        property_matches,
        property_matches_context,
        property_matches_note,
      },
    },
  };
};

export const handleChatService = async ({
  id,
  message,
  embedToken,
  visitorId,
  agentType,
  channel,
  clientIp,
  userAgent,
  referer,
  formContact,
}) => {
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { status: 400, body: { success: false, message: 'message is required' } };
  }
  if (!embedToken) {
    return { status: 400, body: { success: false, message: 'embedToken is required' } };
  }
  if (message.length > 10_000) {
    return { status: 400, body: { success: false, message: 'message exceeds 10,000 characters' } };
  }

  const trimmedMessage = message.trim();
  const sessionId = id || crypto.randomBytes(8).toString('hex');
  const normalizedAgentType = normalizeAgentType(agentType);
  const normalizedChannel = channel || 'web';

  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
  if (!embed) {
    return { status: 403, body: { success: false, message: 'Invalid or inactive embed token' } };
  }
  const userId = embed.user_id;

  const [visitor, professionalProfile] = await Promise.all([
    resolveVisitor({ visitorUuid: visitorId, embedToken, userAgent, clientIp }),
    ProfessionalProfile.findOne({ user_id: userId }),
  ]);

  const flowType = resolveChatFlowType({
    embed,
    normalizedAgentType,
    professionalProfile,
  });
  const effectiveWidgetType = professionalTypeToWidgetAgentType(flowType);
  const flow = getFlowForRole(flowType);
  const canCreateLeads = Boolean(flow?.flowRole);

  const intent =
    formContact?.intent === 'sell' || formContact?.intent === 'buy'
      ? formContact.intent
      : classifyIntentFromKeywords(trimmedMessage);

  let conversation = await ChatConversation.findOne({ session_id: sessionId });
  const embedFlowRole =
    embed.widget_role && isValidProfessionalType(embed.widget_role) ? embed.widget_role : undefined;
  if (!conversation) {
    conversation = await ChatConversation.create({
      session_id: sessionId,
      user_id: userId,
      visitor_id: visitor._id,
      embed_id: embed._id,
      embed_token: embedToken,
      embed_flow_role: embedFlowRole,
      agent_type: effectiveWidgetType,
      channel: normalizedChannel,
      intent,
    });
  } else {
    conversation.agent_type = effectiveWidgetType;
    if (embedFlowRole) conversation.embed_flow_role = embedFlowRole;
    conversation.channel = normalizedChannel;
    conversation.last_interaction_at = new Date();
    await conversation.save();
  }

  const regexContact = extractContactFromMessage(trimmedMessage);
  const currentContact = mergeContact(regexContact, {
    name: formContact?.name || null,
    email: formContact?.email ? formContact.email.toLowerCase() : null,
    phone: formContact?.phone || null,
    address: formContact?.address || null,
  });

  const mergedFormContact = mergeFormContactData(
    conversation.form_data && typeof conversation.form_data === 'object' ? conversation.form_data : {},
    formContact && typeof formContact === 'object' ? formContact : {},
  );
  const storedForm = mergedFormContact;
  const formSignals = flow.getFormSignals(storedForm);
  const formQualification = flow.getFormQualification(storedForm);

  await ChatMessage.create({
    conversation_id: conversation._id,
    session_id: sessionId,
    role: 'user',
    content: trimmedMessage,
    agent_type: effectiveWidgetType,
    intent,
    channel: normalizedChannel,
    meta: {
      embedToken,
      ip: clientIp,
      session: sessionId,
      contact: currentContact,
    },
  });

  let contactInfo = await accumulateContactInfo(conversation._id, currentContact);
  const hasContact = Boolean(contactInfo.email || contactInfo.phone || contactInfo.name);

  const allUserMessages = await ChatMessage.find({
    conversation_id: conversation._id,
    role: 'user',
  })
    .sort({ createdAt: 1 })
    .select('content');
  const interactionCount = allUserMessages.length;
  const conversationText = allUserMessages.map((m) => m.content).join(' ');

  const textSignals = extractSignals(conversationText);
  const seedSignals = mergeSignals(formSignals, textSignals);

  let { leadScore, leadGrade, leadMeta } = flow.scoreLead({
    message: conversationText,
    hasContact,
    contactInfo,
    interactionCount,
    seedSignals,
    formQualification,
  });

  const history = await ChatMessage.find({ conversation_id: conversation._id })
    .sort({ createdAt: 1 })
    .limit(20)
    .select('role content meta');

  const { calendlyLinkForVisitor } = resolveCalendlyLinksForVisitor(
    flow,
    professionalProfile,
    leadGrade,
    conversation
  );
  const isAutomatedBookingEnabled = isAutomatedBookingEnabledForFlow(
    flow,
    professionalProfile,
    conversation
  );
  const deferCalendlyLink = shouldDeferCalendlyLink(
    flow,
    isAutomatedBookingEnabled,
    calendlyLinkForVisitor,
    storedForm,
    history
  );

  const systemPromptOptions = await buildFlowSystemPromptOptions({
    flow,
    professionalProfile,
    conversation,
    intent,
    leadGrade,
    deferCalendlyLink,
    isAutomatedBookingEnabled,
    calendlyLinkForVisitor,
  });
  const systemPrompt = flow.buildSystemPrompt(professionalProfile, systemPromptOptions);
  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const mortgageBrokerSnapshotQual = null;
  const mortgageBrokerSnapshotSignals = null;

  let aiReply = '';
  let aiIntent = intent;
  let emotionalState = 'neutral';
  let parsedAiDetails = {};

  try {
    const turn = await runChatOpenAiTurn({
      openaiMessages,
      sessionId,
      flow,
      formQualification,
      seedSignals,
      conversationText,
      hasContact,
      contactInfo,
      interactionCount,
      intent,
    });
    aiReply = turn.aiReply;
    aiIntent = turn.aiIntent;
    emotionalState = turn.emotionalState;
    parsedAiDetails = turn.parsedAiDetails;
    leadScore = turn.leadScore;
    leadGrade = turn.leadGrade;
    leadMeta = turn.leadMeta;
  } catch (err) {
    logger.error(`OpenAI error — session: ${sessionId} — ${err.message}`);
    return { status: 500, body: { success: false, message: 'AI service unavailable. Please try again.' } };
  }

  const finalScore = leadScore;
  const finalGrade = flow.bestGrade(leadGrade, conversation.lead_grade || 'unscored');
  const persistedGrade = flow.getPersistedGrade(finalGrade);
  const finalClass = classifyLeadForFlow(flow, finalGrade, aiIntent);
  const persistedClass = classifyLeadForFlow(flow, persistedGrade, aiIntent);

  await ChatMessage.create({
    conversation_id: conversation._id,
    session_id: sessionId,
    role: 'assistant',
    content: aiReply,
    agent_type: effectiveWidgetType,
    intent: aiIntent,
    channel: normalizedChannel,
    lead_score: finalScore,
    lead_grade: persistedGrade,
    meta: {
      embedToken,
      contact: contactInfo,
      ai_metadata: {
        intent: aiIntent,
        emotional_state: emotionalState,
        extracted_data: parsedAiDetails,
        lead_classification: finalClass,
      },
    },
  });

  conversation.intent = aiIntent;
  conversation.lead_score = finalScore;
  conversation.lead_grade = persistedGrade;
  conversation.lead_classification = persistedClass;
  conversation.lead_reasons = leadMeta;
  conversation.is_qualified = leadMeta.qualified;
  conversation.emotional_state = emotionalState;
  conversation.last_interaction_at = new Date();
  conversation.form_data = mergedFormContact;
  await conversation.save();

  await syncLeadMatchAfterTurn({
    flow,
    flowType,
    canCreateLeads,
    conversation,
    userId,
    professionalProfile,
    hasContact,
    contactInfo,
    conversationText,
    trimmedMessage,
    sessionId,
    embedToken,
    clientIp,
    userAgent,
    referer,
    formContact: mergedFormContact,
    parsedAiDetails,
    finalScore,
    persistedGrade,
    leadMeta,
    aiIntent,
  });

  const responseMeta = await buildChatResponseMeta({
    flow,
    conversation,
    userId,
    professionalProfile,
    hasContact,
    deferCalendlyLink,
    calendlyLinkForVisitor,
    isAutomatedBookingEnabled,
    finalScore,
    finalGrade,
    aiIntent,
    finalClass,
    leadMeta,
    contactInfo,
    emotionalState,
    mortgageBrokerSnapshotQual,
    mortgageBrokerSnapshotSignals,
  });

  return {
    status: 200,
    body: {
      success: true,
      reply: aiReply,
      session_id: sessionId,
      visitor_id: visitor.uuid,
      meta: responseMeta,
    },
  };
};
