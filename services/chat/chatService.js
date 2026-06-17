import crypto from 'crypto';
import ChatConversation from '../../models/ChatConversation.js';
import ChatMessage from '../../models/ChatMessage.js';
import ChatbotEmbedUrl from '../../models/ChatbotEmbedUrl.js';
import LeadMatch from '../../models/LeadMatch.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import logger from '../../utils/logger.js';
import {
  normalizeAgentType,
  classifyIntentFromKeywords,
} from './utils/normalizationUtils.js';
import {
  resolveVisitor,
  accumulateContactInfo,
  buildUserMessageContactMeta,
  coerceContactIdentityFields,
  hasIdentityContact,
} from './utils/contactUtils.js';
import { mergeFormContactData } from './utils/mergeFormContactData.js';
import { mergeSignals, extractSignals } from './scoring/index.js';
import { getFlowForRole } from './flows/getFlowForRole.js';
import {
  supportsPropertyMatches,
  classifyLeadForFlow,
  usesFixedBuyIntentForLeadMatch,
} from './flows/flowRoleMeta.js';
import { getOrCreateSubscriptionForUser } from '../billing/subscriptionService.js';
import { FEATURES, hasFeature } from '../billing/entitlements.js';
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
import { buildPropertyMatchesPayload } from './handleChat/chatPropertyMatchesPayload.js';
import { appendCalendlyBookingLink } from './utils/chatBookingReply.js';
import { shouldRefetchPropertyMatchesForMessage } from './utils/propertyMatchesRequestIntent.js';
import { stripPropertyListingsFromReply } from './utils/stripPropertyListingsFromReply.js';
import { buildOutOfScopeReply, detectOutOfScopeMessage } from './utils/chatScopeGuard.js';
import {
  buildLeadRecapMarkdownLines,
  injectLeadRecapIntoReply,
  shouldHydrateLeadRecap,
} from './utils/leadRecapMarkdown.js';
import {
  normalizeInquiredProperty,
  resolveLinkedSellerLeadMatchId,
} from '../lead/inquiredProperty.js';

export { flowTypeForConversation, recomputeSignalsForPropertyMatches } from './handleChat/index.js';

const MAX_USER_MESSAGES_FOR_SCORING = 120;
const MAX_MESSAGES_FOR_PROMPT = 20;

function propertyMatchesEnabledForPlan(flow, subscription) {
  return Boolean(
    supportsPropertyMatches(flow) && hasFeature(subscription, FEATURES.LEADS_INSIGHTS_ADVANCED),
  );
}

function normalizePersistedGradeByScore(grade, score) {
  const normalizedGrade = String(grade || '').toLowerCase();
  const normalizedScore = Number(score);
  if (normalizedGrade === 'warm' && Number.isFinite(normalizedScore) && normalizedScore >= 40 && normalizedScore < 60) {
    return 'interested';
  }
  return normalizedGrade || grade;
}

function asFormContactRecord(formContact) {
  return formContact && typeof formContact === 'object' && !Array.isArray(formContact) ? formContact : {};
}

function intakeSessionId() {
  return `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function conversationCreateFields({
  sessionId,
  userId,
  visitor,
  embed,
  embedToken,
  embedFlowRole,
  agentType,
  channel,
  intent,
}) {
  return {
    session_id: sessionId,
    user_id: userId,
    visitor_id: visitor._id,
    embed_id: embed._id,
    embed_token: embedToken,
    embed_flow_role: embedFlowRole,
    agent_type: agentType,
    channel,
    intent,
  };
}

async function shouldAwaitLeadSync({
  forceNewLead,
  canCreateLeads,
  hasContact,
  conversation,
  userId,
  flow,
  mergedFormContact,
  aiIntent,
  sessionId,
}) {
  if (!canCreateLeads || !hasContact) return false;
  // Intake forms fork a fresh conversation; persist the lead in the background so the reply returns fast.
  if (forceNewLead) return false;

  try {
    const formIntent = String(mergedFormContact?.intent || '').trim().toLowerCase();
    const leadIntent = usesFixedBuyIntentForLeadMatch(flow) ? 'unspecified' : (formIntent || aiIntent);
    const intentSuffix = flow.getIntentSuffix(leadIntent);
    const existingLead = await LeadMatch.findOne({
      conversation_id: conversation._id,
      user_id: userId,
      lead_type: new RegExp(`${intentSuffix}$`),
    })
      .select('_id')
      .lean();
    return !existingLead?._id;
  } catch (err) {
    logger.warn('Chat service: pre-sync lead existence check failed', {
      session_id: sessionId,
      user_id: String(userId),
      error: err?.message || String(err),
    });
    return false;
  }
}

export const getChatSessionMessagesService = async ({ id: sessionId, embedToken }) => {
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

  const conversation = await ChatConversation.findOne({
    session_id: sessionId.trim(),
    user_id: embed.user_id,
  })
    .select('_id session_id')
    .lean();

  if (!conversation) {
    return {
      status: 200,
      body: {
        success: true,
        session_id: sessionId.trim(),
        conversation_id: null,
        messages: [],
        total: 0,
      },
    };
  }

  const rows = await ChatMessage.find({ conversation_id: conversation._id })
    .sort({ createdAt: 1 })
    .select('role content intent createdAt meta')
    .lean();

  const messages = rows.map((m) => ({
    id: String(m._id),
    role: m.role,
    content: m.content,
    intent: m.intent || null,
    created_at: m.createdAt,
  }));

  return {
    status: 200,
    body: {
      success: true,
      session_id: sessionId.trim(),
      conversation_id: String(conversation._id),
      messages,
      total: messages.length,
    },
  };
};

export const handlePropertyMatchesService = async ({
  id: sessionId,
  embedToken,
  visitorId,
  formContact,
  page,
  limit,
  matchMode,
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
  const subscription = await getOrCreateSubscriptionForUser({ _id: userId });
  if (!propertyMatchesEnabledForPlan(flow, subscription)) {
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
  const normalizedMatchMode = String(matchMode || 'strict').trim().toLowerCase() === 'relaxed' ? 'relaxed' : 'strict';
  const payload = await buildPropertyMatchesPayload({
    conversation,
    userId,
    visitorId,
    formContact,
    page,
    limit,
    flow,
    matchMode: normalizedMatchMode,
  });
  if (!payload.session_id) payload.session_id = sessionId.trim();
  return { status: 200, body: payload };
};

export const selectChatPropertyMatchService = async ({ id: sessionId, embedToken, property }) => {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
    return { status: 400, body: { success: false, message: 'id (session_id) is required' } };
  }
  if (!embedToken || typeof embedToken !== 'string' || !embedToken.trim()) {
    return { status: 400, body: { success: false, message: 'embedToken is required' } };
  }
  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken }).select('user_id').lean();
  if (!embed) {
    return { status: 403, body: { success: false, message: 'Invalid or inactive embed token' } };
  }

  const conversation = await ChatConversation.findOne({
    session_id: sessionId.trim(),
    user_id: embed.user_id,
  }).select('_id').lean();
  if (!conversation) {
    return { status: 404, body: { success: false, message: 'Session not found' } };
  }

  const inquiredProperty = normalizeInquiredProperty(property, { fromPropertyMatch: true });
  if (!inquiredProperty) {
    return { status: 400, body: { success: false, message: 'Selected property is empty' } };
  }

  const leadMatch = await LeadMatch.findOne({
    conversation_id: conversation._id,
    user_id: embed.user_id,
    lead_type: /_(buyer|client)$/,
  }).sort({ updatedAt: -1, createdAt: -1 });
  if (!leadMatch) {
    return { status: 404, body: { success: false, message: 'Buyer lead not found for this chat session' } };
  }

  const linkedSellerLeadMatchId = await resolveLinkedSellerLeadMatchId({
    ownerUserId: embed.user_id,
    inquiredProperty,
    selectedProperty: property,
  });
  const nextFactors =
    leadMatch.compatibility_factors && typeof leadMatch.compatibility_factors === 'object'
      ? { ...leadMatch.compatibility_factors }
      : {};
  nextFactors.inquired_property = inquiredProperty;
  nextFactors.inquiry_type = 'specific_property';
  nextFactors.linked_seller_lead_match_id = linkedSellerLeadMatchId || null;
  leadMatch.compatibility_factors = nextFactors;
  leadMatch.markModified('compatibility_factors');
  await leadMatch.save();

  return {
    status: 200,
    body: {
      success: true,
      lead_match_id: String(leadMatch._id),
      inquired_property: inquiredProperty,
      linked_seller_lead_match_id: linkedSellerLeadMatchId || null,
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
  forceNewLead = false,
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
  let sessionId = id || crypto.randomBytes(8).toString('hex');
  const normalizedAgentType = normalizeAgentType(agentType);
  const normalizedChannel = channel || 'web';

  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
  if (!embed) {
    return { status: 403, body: { success: false, message: 'Invalid or inactive embed token' } };
  }
  const userId = embed.user_id;

  const [visitor, professionalProfile, subscription] = await Promise.all([
    resolveVisitor({ visitorUuid: visitorId, embedToken, userAgent, clientIp }),
    ProfessionalProfile.findOne({ user_id: userId }),
    getOrCreateSubscriptionForUser({ _id: userId }),
  ]);

  const flowType = resolveChatFlowType({
    embed,
    normalizedAgentType,
    professionalProfile,
  });
  const effectiveWidgetType = professionalTypeToWidgetAgentType(flowType);
  const flow = getFlowForRole(flowType);
  const propertyMatchesEnabled = propertyMatchesEnabledForPlan(flow, subscription);
  const canCreateLeads = Boolean(flow?.flowRole);

  const nonAgentBuyerSellerIntent = usesFixedBuyIntentForLeadMatch(flow);
  const intent = nonAgentBuyerSellerIntent
    ? 'unspecified'
    : formContact?.intent === 'sell' || formContact?.intent === 'buy'
      ? formContact.intent
      : classifyIntentFromKeywords(trimmedMessage);

  const embedFlowRole =
    embed.widget_role && isValidProfessionalType(embed.widget_role) ? embed.widget_role : undefined;
  const conversationBase = {
    userId,
    visitor,
    embed,
    embedToken,
    embedFlowRole,
    agentType: effectiveWidgetType,
    channel: normalizedChannel,
    intent,
  };

  let conversation;
  if (forceNewLead) {
    sessionId = intakeSessionId();
    conversation = await ChatConversation.create(
      conversationCreateFields({ sessionId, ...conversationBase }),
    );
    logger.info('Chat service: intake conversation created', {
      op: 'chat.lead',
      session_id: sessionId,
      user_id: String(userId),
    });
  } else {
    conversation = await ChatConversation.findOne({ session_id: sessionId });
    if (!conversation) {
      conversation = await ChatConversation.create(
        conversationCreateFields({ sessionId, ...conversationBase }),
      );
    } else {
      conversation.agent_type = effectiveWidgetType;
      if (embedFlowRole) conversation.embed_flow_role = embedFlowRole;
      conversation.channel = normalizedChannel;
      conversation.last_interaction_at = new Date();
      await conversation.save();
    }
  }

  const formPatch = asFormContactRecord(formContact);
  const mergedFormContact = forceNewLead
    ? mergeFormContactData({}, formPatch)
    : mergeFormContactData(asFormContactRecord(conversation.form_data), formPatch);
  const storedForm = mergedFormContact;

  const currentContact = buildUserMessageContactMeta(trimmedMessage, mergedFormContact);
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
  let hasContact = hasIdentityContact(contactInfo);

  const [interactionCount, recentUserMessages] = await Promise.all([
    ChatMessage.countDocuments({
      conversation_id: conversation._id,
      role: 'user',
    }),
    ChatMessage.find({
      conversation_id: conversation._id,
      role: 'user',
    })
      .sort({ createdAt: -1 })
      .limit(MAX_USER_MESSAGES_FOR_SCORING)
      .select('content')
      .lean(),
  ]);
  const conversationText = [...recentUserMessages]
    .reverse()
    .map((m) => m.content)
    .join(' ');

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

  const history = (
    await ChatMessage.find({ conversation_id: conversation._id })
      .sort({ createdAt: -1 })
      .limit(MAX_MESSAGES_FOR_PROMPT)
      .select('role content meta')
      .lean()
  ).reverse();

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
    history,
    interactionCount
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
    propertyMatchesEnabled,
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
  const isOutOfScopeMessage = detectOutOfScopeMessage(trimmedMessage, flow?.flowRole);

  if (isOutOfScopeMessage) {
    aiReply = buildOutOfScopeReply(flow?.flowRole, professionalProfile?.full_name);
    logger.info('Chat service: out-of-scope message blocked', {
      op: 'chat.message',
      session_id: sessionId,
      flow_role: flow?.flowRole || 'agent',
    });
  } else {
    try {
      const openAiStartedAt = Date.now();
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
      logger.info('Chat service: OpenAI turn completed', {
        op: 'chat.message',
        session_id: sessionId,
        ms: Date.now() - openAiStartedAt,
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
  }

  coerceContactIdentityFields(contactInfo);
  hasContact = hasIdentityContact(contactInfo);

  const refetchPropertyMatches = shouldRefetchPropertyMatchesForMessage(trimmedMessage);
  const recapLines = refetchPropertyMatches
    ? []
    : buildLeadRecapMarkdownLines({
        form: storedForm,
        contact: contactInfo,
        extracted: parsedAiDetails,
        intent: aiIntent,
      });
  let finalReply = aiReply;
  if (
    recapLines.length > 0 &&
    shouldHydrateLeadRecap({
      userMessage: trimmedMessage,
      aiReply,
      interactionCount,
    })
  ) {
    finalReply = injectLeadRecapIntoReply(aiReply, recapLines);
  }
  if (refetchPropertyMatches) {
    finalReply = stripPropertyListingsFromReply(finalReply);
    if (!propertyMatchesEnabled) {
      finalReply =
        'Thanks for sharing. I can help refine your preferences and connect you with the professional for tailored options.';
    }
  }

  if (isAutomatedBookingEnabled && calendlyLinkForVisitor && hasContact) {
    finalReply = appendCalendlyBookingLink(finalReply, calendlyLinkForVisitor, {
      userMessage: trimmedMessage,
    });
  }

  const finalScore = leadScore;
  const finalGradeRaw = flow.bestGrade(leadGrade, conversation.lead_grade || 'unscored');
  const finalGrade = normalizePersistedGradeByScore(finalGradeRaw, finalScore);
  const persistedGradeRaw = flow.getPersistedGrade(finalGrade);
  const persistedGrade = normalizePersistedGradeByScore(persistedGradeRaw, finalScore);
  const finalClass = classifyLeadForFlow(flow, finalGrade, aiIntent);
  const persistedClass = classifyLeadForFlow(flow, persistedGrade, aiIntent);

  await ChatMessage.create({
    conversation_id: conversation._id,
    session_id: sessionId,
    role: 'assistant',
    content: finalReply,
    agent_type: effectiveWidgetType,
    intent: nonAgentBuyerSellerIntent ? 'unspecified' : aiIntent,
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

  conversation.intent = nonAgentBuyerSellerIntent ? 'unspecified' : aiIntent;
  conversation.lead_score = finalScore;
  conversation.lead_grade = persistedGrade;
  conversation.lead_classification = persistedClass;
  conversation.lead_reasons = leadMeta;
  conversation.is_qualified = leadMeta.qualified;
  conversation.emotional_state = emotionalState;
  conversation.last_interaction_at = new Date();
  conversation.form_data = mergedFormContact;
  await conversation.save();

  const awaitLeadSync = await shouldAwaitLeadSync({
    forceNewLead,
    canCreateLeads,
    hasContact,
    conversation,
    userId,
    flow,
    mergedFormContact,
    aiIntent,
    sessionId,
  });

  const syncLeadTask = syncLeadMatchAfterTurn({
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
    forceCreateLead: Boolean(forceNewLead),
  }).catch((err) => {
    logger.warn('Chat service: async lead sync failed', {
      session_id: sessionId,
      user_id: String(userId),
      error: err?.message || String(err),
    });
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
    extractedData: parsedAiDetails,
    refetchPropertyMatches,
    propertyMatchesEnabled,
  });

  if (awaitLeadSync) {
    await syncLeadTask;
  } else {
    // Keep widget latency low: do not block the reply on non-critical CRM sync side effects.
    void syncLeadTask;
  }

  return {
    status: 200,
    body: {
      success: true,
      reply: finalReply,
      session_id: sessionId,
      visitor_id: visitor.uuid,
      meta: responseMeta,
    },
  };
};

export const clearChatSessionService = async (sessionId) => {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return { status: 400, body: { success: false, message: 'session id is required' } };
  }

  const conversation = await ChatConversation.findOne({ session_id: normalizedSessionId });
  if (!conversation) {
    return {
      status: 200,
      body: {
        success: true,
        message: 'Session already cleared',
        session_id: normalizedSessionId,
      },
    };
  }

  const hasCrmLead = await LeadMatch.exists({ conversation_id: conversation._id });
  if (hasCrmLead) {
    /**
     * Widget "Start new request" / clear must not delete the thread that LeadMatch points to,
     * or GET /api/leads/:id/conversation shows an empty transcript forever. The client already
     * rotates session_id; leaving this conversation + messages intact preserves CRM history.
     */
    logger.info('Chat clear: skipped delete — conversation linked to LeadMatch', {
      op: 'chat.clear',
      session_id: normalizedSessionId,
      conversation_id: String(conversation._id),
    });
    return {
      status: 200,
      body: {
        success: true,
        message: 'Session reset for the widget; lead chat history kept for your workspace.',
        session_id: normalizedSessionId,
        lead_history_preserved: true,
      },
    };
  }

  await Promise.all([
    ChatMessage.deleteMany({ conversation_id: conversation._id }),
    ChatConversation.deleteOne({ _id: conversation._id }),
  ]);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Conversation cleared successfully',
      session_id: normalizedSessionId,
    },
  };
};
