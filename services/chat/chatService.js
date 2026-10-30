import crypto from 'crypto';
import ChatConversation from '../../models/ChatConversation.js';
import ChatMessage from '../../models/ChatMessage.js';
import ChatbotEmbedUrl from '../../models/ChatbotEmbedUrl.js';
import LeadMatch from '../../models/LeadMatch.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import PublicProfile from '../../models/PublicProfile.js';
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
import { identityReply } from './utils/profileVisitorFacts.js';
import { allowLandingChatRate, isLandingEmbed, loadLandingChatSettings } from './nestiLanding/landingChatConfig.js';
import {
  applyDocumentAsk,
  attachDocumentsToTurn,
  buildSharedDocumentsPrompt,
  briefDocumentAnswer,
  documentReadReply,
  documentReviewReply,
  followUpSkipIds,
  loadConversationDocuments,
  rereadUndescribedImages,
  nextDocumentRequest,
  signStoredAttachments,
  waitForDocumentReads,
  waitForDocumentSummaries,
} from './documents/chatDocumentService.js';
import {
  assistantSettingForPreview,
  assistantAllowsLeadSaving,
  buildPreviewChatPrompt,
  finishAgentReply,
  finishBrokerReply,
  finishLawyerReply,
  lawyerReplyDrifted,
  loadAppliedAssistantSetting,
  voiceTurnReminder,
  withOccasionalEmoji,
} from '../professionalAssistant/professionalAssistantService.js';
import { nestiLandingFlow } from './nestiLanding/nestiLandingFlow.js';
import { handleLandingChatTurn } from './nestiLanding/landingChatTurnService.js';
import { buildPropertyMatchesPayload } from './handleChat/chatPropertyMatchesPayload.js';
import { appendCalendlyBookingLink, holdFurtherQuestions, userSignalsBookingIntent } from './utils/chatBookingReply.js';
import { chatAnsweredQuestionIds, openQualificationQuestionIds, qualificationStillOpen, quickRepliesForReply } from '../professionalAssistant/qualificationProgress.js';
import { clientTypeForForm, settingForClientType } from '../professionalAssistant/assistantSettings.js';
import { buildPreviewLeadSummary, leadClientTypeExtras } from './handleChat/previewLeadSummary.js';
import { dropRepeatedVisitorName, replyLanguage } from '../professionalAssistant/replyStyle.js';
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
  existingLeadMatch,
  leadLookupFailed = false,
}) {
  if (!canCreateLeads || !hasContact) return false;
  // Intake forms fork a fresh conversation; persist the lead in the background so the reply returns fast.
  if (forceNewLead) return false;
  if (leadLookupFailed) return false;
  return !existingLeadMatch?._id;
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

  const messages = await Promise.all(rows.map(async (m) => ({
    id: String(m._id),
    role: m.role,
    content: m.content,
    intent: m.intent || null,
    created_at: m.createdAt,
    attachments: await signStoredAttachments(m.meta?.attachments),
  })));

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
  opening = false,
  preview = false,
  previewAssistantDraft = null,
  testPersona = null,
  viewerUserId = null,
  onReplyDelta = null,
  attachmentIds = [],
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
  if (isLandingEmbed(embed) || normalizedChannel === 'landing') {
    return handleLandingChatTurn({
      message: trimmedMessage,
      embedToken,
      sessionId,
      visitorId,
      clientIp,
      formContact,
      opening: Boolean(opening),
    });
  }
  const landingMode = isLandingEmbed(embed);
  if (landingMode && !allowLandingChatRate(clientIp, visitorId)) {
    return { status: 429, body: { success: false, message: 'Too many messages. Try again in a minute.' } };
  }
  const landingSettings = landingMode ? await loadLandingChatSettings().catch(() => null) : null;
  if (landingMode && landingSettings && landingSettings.enabled === false) {
    return { status: 403, body: { success: false, message: 'Landing chat is turned off.' } };
  }
  const userId = embed.user_id;

  const [visitor, professionalProfile, subscription, publicProfile] = await Promise.all([
    resolveVisitor({ visitorUuid: visitorId, embedToken, userAgent, clientIp }),
    ProfessionalProfile.findOne({ user_id: userId }),
    getOrCreateSubscriptionForUser({ _id: userId }),
    landingMode
      ? null
      : PublicProfile.findOne({ user_id: userId }).select('stats.years_experience stats.years_practice').lean(),
  ]);

  const previewForOwner =
    preview === true && viewerUserId && String(embed.user_id) === String(viewerUserId);
  const draftRole = previewAssistantDraft?.role;
  const flowType = landingMode
    ? 'landing'
    : previewForOwner && isValidProfessionalType(draftRole)
      ? draftRole
      : resolveChatFlowType({
        embed,
        normalizedAgentType,
        professionalProfile,
      });
  const effectiveWidgetType = professionalTypeToWidgetAgentType(landingMode ? 'agent' : flowType);
  const flow = landingMode ? nestiLandingFlow : getFlowForRole(flowType);
  const propertyMatchesEnabled = landingMode ? false : propertyMatchesEnabledForPlan(flow, subscription);
  if (preview === true && !previewForOwner) {
    return {
      status: 403,
      body: { success: false, message: 'Sign in again to preview unsaved changes.' },
    };
  }
  const canCreateLeads = Boolean(flow?.flowRole) && !previewForOwner;
  const previewPersona = previewForOwner && ['buyer', 'seller', 'investor'].includes(testPersona) ? testPersona : '';

  const nonAgentBuyerSellerIntent = usesFixedBuyIntentForLeadMatch(flow) || Boolean(flow.landingMode);
  const intent = nonAgentBuyerSellerIntent
    ? 'unspecified'
    : formContact?.intent === 'sell' || formContact?.intent === 'buy'
      ? formContact.intent
      : previewPersona
        ? (previewPersona === 'seller' ? 'sell' : 'buy')
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

  const turnAttachments = landingMode
    ? []
    : await attachDocumentsToTurn({
      userId,
      conversationId: conversation._id,
      sessionId,
      attachmentIds,
    });
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
      attachments: turnAttachments,
    },
  });

  const assistantSettingPromise = landingMode
    ? Promise.resolve(null)
    : previewForOwner && previewAssistantDraft
      ? Promise.resolve(assistantSettingForPreview(previewAssistantDraft, flowType))
      : loadAppliedAssistantSetting(userId);
  const [contactInfoLoaded, interactionCount, recentUserMessages, historyRows, appliedAssistantLoaded] = await Promise.all([
    accumulateContactInfo(conversation._id, currentContact),
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
    ChatMessage.find({ conversation_id: conversation._id })
      .sort({ createdAt: -1 })
      .limit(MAX_MESSAGES_FOR_PROMPT)
      .select('role content meta')
      .lean(),
    assistantSettingPromise,
  ]);
  let contactInfo = contactInfoLoaded;
  let hasContact = hasIdentityContact(contactInfo);
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

  const history = historyRows.reverse();
  const assistantHistory = history.filter((message) => message.role === 'assistant');
  const lastAssistantReply = assistantHistory.at(-1)?.content || '';
  const earlierAssistantReplies = assistantHistory
    .slice(-8)
    .map((message) => message.content)
    .join('\n');

  const { calendlyLinkForVisitor } = resolveCalendlyLinksForVisitor(
    flow,
    professionalProfile,
    leadGrade,
    conversation
  );
  const isAutomatedBookingEnabled = landingMode
    ? false
    : isAutomatedBookingEnabledForFlow(
      flow,
      professionalProfile,
      conversation
    );
  const conversationPromptSnapshot = {
    calendly_booking_status: conversation?.calendly_booking_status ?? null,
    lead_grade: conversation?.lead_grade ?? null,
  };
  const deferCalendlyLink = userSignalsBookingIntent(trimmedMessage)
    ? false
    : shouldDeferCalendlyLink(
      flow,
      isAutomatedBookingEnabled,
      calendlyLinkForVisitor,
      storedForm,
      history,
      interactionCount
    );

  const savedYears = Number(publicProfile?.stats?.years_experience) || Number(publicProfile?.stats?.years_practice) || 0;
  const systemPromptOptions = await buildFlowSystemPromptOptions({
    flow,
    professionalProfile,
    conversation,
    conversationSnapshot: conversationPromptSnapshot,
    intent,
    leadGrade,
    deferCalendlyLink,
    isAutomatedBookingEnabled,
    calendlyLinkForVisitor,
    propertyMatchesEnabled,
  });
  const visitorClientType = landingMode ? '' : (previewPersona || clientTypeForForm(storedForm));
  const typedAssistant = !landingMode && appliedAssistantLoaded
    ? settingForClientType(appliedAssistantLoaded, visitorClientType)
    : appliedAssistantLoaded;
  const appliedAssistantResolved = typedAssistant?.applied && storedForm && !previewForOwner && !landingMode
    ? { ...typedAssistant, qualification_questions: openQualificationQuestionIds(typedAssistant, storedForm) }
    : typedAssistant;
  if (!landingMode) {
    systemPromptOptions.assistantSetting = appliedAssistantResolved;
    systemPromptOptions.yearsExperience = savedYears;
    systemPromptOptions.previewConversation = Boolean(previewForOwner);
    systemPromptOptions.clientType = visitorClientType;
  }
  const appliedAssistantSetting = systemPromptOptions.assistantSetting;
  const leadSyncEnabled = canCreateLeads && assistantAllowsLeadSaving(appliedAssistantSetting);
  if (!landingMode && storedForm && typeof storedForm === 'object') {
    systemPromptOptions.intakeFormContact = storedForm;
  }
  if (!landingMode) {
    systemPromptOptions.openingTurn = assistantHistory.length === 0;
    systemPromptOptions.chatAnsweredQuestions = chatAnsweredQuestionIds(appliedAssistantResolved, history, trimmedMessage);
  }
  if (landingMode) {
    systemPromptOptions.audience = String(storedForm?.audience_role || formContact?.audience_role || 'client');
    systemPromptOptions.landingGuides = landingSettings || {};
    systemPromptOptions.contactKnown = Boolean(
      storedForm?.email || storedForm?.phone || storedForm?.name
      || formContact?.email || formContact?.phone || formContact?.name
    );
  }
  if (!landingMode && turnAttachments.length) {
    await waitForDocumentReads(turnAttachments.map((file) => file.id));
  }
  let sharedDocuments = landingMode
    ? []
    : await loadConversationDocuments({
      userId,
      conversationId: conversation._id,
      sessionId,
      includePreview: previewForOwner,
    });
  const focusIdsForRead = new Set(turnAttachments.map((file) => String(file.id)));
  const photosToReread = focusIdsForRead.size
    ? sharedDocuments.filter((doc) => focusIdsForRead.has(String(doc._id)))
    : [];
  if (photosToReread.length && await rereadUndescribedImages(photosToReread)) {
    sharedDocuments = await loadConversationDocuments({
      userId,
      conversationId: conversation._id,
      sessionId,
      includePreview: previewForOwner,
    });
  }
  const focusIds = new Set(turnAttachments.map((file) => String(file.id)));
  let focusedDocuments = focusIds.size
    ? sharedDocuments.filter((doc) => focusIds.has(String(doc._id)))
    : [];
  if (focusedDocuments.some((doc) => doc.text_ready && doc.status !== 'ready' && doc.status !== 'failed')) {
    await waitForDocumentSummaries(focusedDocuments.map((doc) => doc._id), 8000);
    sharedDocuments = await loadConversationDocuments({
      userId,
      conversationId: conversation._id,
      sessionId,
      includePreview: previewForOwner,
    });
    focusedDocuments = sharedDocuments.filter((doc) => focusIds.has(String(doc._id)));
  }
  const documentPrompt = buildSharedDocumentsPrompt(sharedDocuments, {
    focusIds: turnAttachments.map((file) => file.id),
    question: trimmedMessage,
  });
  const newFileNames = turnAttachments.map((file) => file.original_filename).filter(Boolean).join(', ');
  const systemPrompt = `${previewForOwner
    ? buildPreviewChatPrompt(flow?.flowRole, professionalProfile, systemPromptOptions)
    : flow.buildSystemPrompt(professionalProfile, systemPromptOptions)}${documentPrompt ? `\n\n${documentPrompt}` : ''}`;
  const recentHistory = previewForOwner ? history.slice(-6) : history;
  const promptHistory = flow?.flowRole !== 'lawyer'
    ? recentHistory
    : recentHistory.filter((message) => message.role !== 'assistant' || !lawyerReplyDrifted(message.content));
  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...promptHistory.map((m) => ({ role: m.role, content: m.content })),
  ];

  const mortgageBrokerSnapshotQual = null;
  const mortgageBrokerSnapshotSignals = null;

  let aiReply = '';
  let aiIntent = intent;
  let emotionalState = 'neutral';
  let parsedAiDetails = {};
  const isOutOfScopeMessage = detectOutOfScopeMessage(trimmedMessage, flow?.flowRole);
  const directDocumentReply = documentReadReply(focusedDocuments);
  const reviewReply = turnAttachments.length
    ? documentReviewReply(focusedDocuments, appliedAssistantSetting, {
      priorDocuments: sharedDocuments.filter((doc) => !focusIds.has(String(doc._id))),
      userMessage: trimmedMessage,
      conversationText,
      intent,
      text: `${storedForm?.intent || ''} ${conversationText || ''} ${trimmedMessage}`,
      history,
      previousReply: lastAssistantReply,
    })
    : '';
  const shapeDocumentReply = (text) => {
    const replyContext = {
      userMessage: trimmedMessage,
      documentReceived: true,
      previousReply: lastAssistantReply,
      history,
      setting: appliedAssistantSetting,
      preview: previewForOwner,
      conversationText,
    };
    return flow?.flowRole === 'lawyer'
      ? finishLawyerReply(text, replyContext)
      : flow?.flowRole === 'mortgage_broker'
        ? finishBrokerReply(text, replyContext)
        : flow?.flowRole === 'agent'
          ? finishAgentReply(text, replyContext)
          : text;
  };

  if (isOutOfScopeMessage) {
    aiReply = buildOutOfScopeReply(
      flow?.flowRole,
      professionalProfile?.full_name,
      landingMode ? null : appliedAssistantSetting,
    );
    logger.info('Chat service: out-of-scope message blocked', {
      op: 'chat.message',
      session_id: sessionId,
      flow_role: flow?.flowRole || 'agent',
    });
  } else if (reviewReply) {
    aiReply = reviewReply;
    logger.info('Chat service: document reviewed against the request', {
      op: 'chat.message',
      session_id: sessionId,
    });
  } else if (directDocumentReply) {
    aiReply = shapeDocumentReply(directDocumentReply);
    logger.info('Chat service: document reply from saved notes', {
      op: 'chat.message',
      session_id: sessionId,
    });
  } else {
    let briefReply = '';
    if (focusedDocuments.length && !turnAttachments.length) {
      try {
        briefReply = await briefDocumentAnswer(focusedDocuments, trimmedMessage);
      } catch (err) {
        logger.warn('Chat service: short document answer failed', { session_id: sessionId, error: err?.message });
      }
    }
    if (briefReply) {
      aiReply = shapeDocumentReply(briefReply);
      logger.info('Chat service: document reply from short read', { op: 'chat.message', session_id: sessionId });
    } else try {
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
        turnReminder: landingMode
          ? ''
          : `${voiceTurnReminder(appliedAssistantSetting, trimmedMessage, { preview: previewForOwner, conversationText, openingTurn: assistantHistory.length === 0, intakeFormContact: storedForm })}${turnAttachments.length ? `\nThe visitor just shared ${newFileNames || 'a file'}. Say whether it is the requested document or a different file. Do not describe the picture or the file.` : (documentPrompt ? '\nA file was shared earlier. Do not describe it again unless the visitor asks what it says.' : '')}${previewForOwner ? '\nVisible reply only. One reply in the selected voice and communication style. Do not write a second version. Do not write ###META### or JSON.' : ''}`,
        assistantSetting: landingMode ? null : appliedAssistantSetting,
        maxTokens: previewForOwner
          ? (documentPrompt
            ? 280
            : (flow?.flowRole === 'lawyer' || flow?.flowRole === 'mortgage_broker'
              ? (['educational', 'consultative'].includes(appliedAssistantSetting?.communication_style) ? 280 : 180)
              : 120))
          : 600,
        onDelta: typeof onReplyDelta === 'function' && previewForOwner
          ? (text) => onReplyDelta(String(text || '').trim())
          : null,
      });
      logger.info('Chat service: OpenAI turn completed', {
        op: 'chat.message',
        session_id: sessionId,
        ms: Date.now() - openAiStartedAt,
        prompt_chars: systemPrompt.length,
        preview: Boolean(previewForOwner),
      });
      const replyContext = {
        userMessage: trimmedMessage,
        documentReceived: turnAttachments.length > 0,
        previousReply: lastAssistantReply,
        history,
        setting: appliedAssistantSetting,
        preview: previewForOwner,
        conversationText,
      };
      aiReply = flow?.flowRole === 'lawyer'
        ? finishLawyerReply(turn.aiReply, replyContext)
        : flow?.flowRole === 'mortgage_broker'
          ? finishBrokerReply(turn.aiReply, replyContext)
          : flow?.flowRole === 'agent'
            ? finishAgentReply(turn.aiReply, replyContext)
            : turn.aiReply;
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

  const previousAssistantReply = earlierAssistantReplies;
  const refetchPropertyMatches = shouldRefetchPropertyMatchesForMessage(trimmedMessage, {
    previousAssistantReply,
  });
  const appliedAssistant = systemPromptOptions.assistantSetting;
  const scheduleActions = appliedAssistant?.next_actions;
  const scheduleAllowed = !appliedAssistant?.applied
    || !Array.isArray(scheduleActions)
    || !scheduleActions.length
    || scheduleActions.includes('schedule');
  const recapLines = refetchPropertyMatches || flow?.flowRole === 'lawyer' || flow?.flowRole === 'mortgage_broker'
    ? []
    : buildLeadRecapMarkdownLines({
        form: storedForm,
        contact: contactInfo,
        extracted: parsedAiDetails,
        intent: aiIntent,
        compact: Boolean(appliedAssistant?.applied && flow?.flowRole === 'agent'),
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

  const namedReply = identityReply({
    userMessage: trimmedMessage,
    profile: professionalProfile,
    setting: appliedAssistantSetting,
    yearsExperience: systemPromptOptions.yearsExperience,
  });
  if (namedReply) finalReply = namedReply;
  finalReply = holdFurtherQuestions(finalReply, trimmedMessage, replyLanguage(appliedAssistantSetting, trimmedMessage, conversationText));
  const visitorAskedToMeet = userSignalsBookingIntent(trimmedMessage);
  const stillAsking = /[?？]/.test(finalReply) && !visitorAskedToMeet;
  const questionsOpen = qualificationStillOpen(appliedAssistantSetting, storedForm, systemPromptOptions.chatAnsweredQuestions);
  if (!stillAsking && isAutomatedBookingEnabled && calendlyLinkForVisitor && scheduleAllowed && !namedReply && (visitorAskedToMeet || (!questionsOpen && !deferCalendlyLink && hasContact))) {
    finalReply = appendCalendlyBookingLink(finalReply, calendlyLinkForVisitor, {
      userMessage: trimmedMessage,
      allowSchedule: scheduleAllowed,
      label: appliedAssistantSetting?.cta_label || '',
    });
  }

  const stillReadingDocument = /still (reading|looking)/i.test(directDocumentReply || '');
  let requestedDocument = null;
  if (!namedReply && !landingMode && appliedAssistantSetting?.applied && appliedAssistantSetting.document_requests?.length && !isOutOfScopeMessage && !stillReadingDocument) {
    const asked = applyDocumentAsk(
      finalReply,
      nextDocumentRequest(appliedAssistantSetting, sharedDocuments, {
        intent,
        text: `${storedForm?.intent || ''} ${conversationText || ''} ${trimmedMessage}`,
      }, followUpSkipIds(appliedAssistantSetting, sharedDocuments, {
        intent,
        text: `${storedForm?.intent || ''} ${conversationText || ''} ${trimmedMessage}`,
      }, history, lastAssistantReply)),
      { previousReply: previousAssistantReply, userMessage: trimmedMessage, setting: appliedAssistantSetting, conversationText, qualificationOpen: !turnAttachments.length && qualificationStillOpen(appliedAssistantSetting, storedForm, systemPromptOptions.chatAnsweredQuestions) },
    );
    finalReply = asked.reply;
    requestedDocument = asked.request;
    if (appliedAssistantSetting.use_emojis) {
      finalReply = withOccasionalEmoji(finalReply, appliedAssistantSetting, {
        previousReply: lastAssistantReply,
        userMessage: trimmedMessage,
        documentReceived: Boolean(requestedDocument) || turnAttachments.length > 0,
      });
    }
  }
  const visitorFirstName = String(storedForm?.name || storedForm?.full_name || '').trim().split(/\s+/)[0] || '';
  finalReply = dropRepeatedVisitorName(finalReply, visitorFirstName, {
    keepName: Boolean(appliedAssistantSetting?.address_by_first_name && assistantHistory.length === 0),
  });

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
  if (visitorClientType) conversation.client_type = visitorClientType;
  await conversation.save();
  const conversationMetaSnapshot = {
    calendly_booking_status: conversation?.calendly_booking_status ?? null,
    calendly_booking_at: conversation?.calendly_booking_at ?? null,
  };

  let existingLeadMatchForSync;
  let leadLookupFailed = false;
  if (leadSyncEnabled && hasContact && !forceNewLead) {
    try {
      const formIntent = String(mergedFormContact?.intent || '').trim().toLowerCase();
      const leadIntent = usesFixedBuyIntentForLeadMatch(flow) ? 'unspecified' : (formIntent || aiIntent);
      const intentSuffix = flow.getIntentSuffix(leadIntent);
      existingLeadMatchForSync = await LeadMatch.findOne({
        conversation_id: conversation._id,
        user_id: userId,
        lead_type: new RegExp(`${intentSuffix}$`),
      });
    } catch (err) {
      leadLookupFailed = true;
      logger.warn('Chat service: pre-sync lead existence check failed', {
        session_id: sessionId,
        user_id: String(userId),
        error: err?.message || String(err),
      });
    }
  }

  const awaitLeadSync = await shouldAwaitLeadSync({
    forceNewLead,
    canCreateLeads: leadSyncEnabled,
    hasContact,
    existingLeadMatch: existingLeadMatchForSync,
    leadLookupFailed,
  });

  const clientTypeExtras = leadSyncEnabled && visitorClientType
    ? leadClientTypeExtras({
      role: flow?.flowRole,
      setting: appliedAssistantSetting,
      clientType: visitorClientType,
      form: mergedFormContact,
      history,
      userMessage: trimmedMessage,
      leadGrade: finalGrade,
      intent: aiIntent,
    })
    : null;
  const syncLeadTask = syncLeadMatchAfterTurn({
    flow,
    flowType,
    canCreateLeads: leadSyncEnabled,
    clientTypeExtras,
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
    existingLeadMatchPrefetched: existingLeadMatchForSync,
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
    conversationSnapshot: conversationMetaSnapshot,
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

  const quickReplies = !landingMode && appliedAssistantSetting?.applied && appliedAssistantSetting.question_overrides
    ? quickRepliesForReply(appliedAssistantSetting, finalReply, systemPromptOptions.chatAnsweredQuestions || [])
    : null;
  const previewLeadSummary = previewForOwner && !landingMode && appliedAssistantSetting?.applied
    ? buildPreviewLeadSummary({
      role: flow?.flowRole,
      setting: appliedAssistantSetting,
      clientType: visitorClientType,
      form: mergedFormContact,
      history,
      userMessage: trimmedMessage,
      details: parsedAiDetails,
      contactInfo,
      leadGrade: finalGrade,
      leadScore: finalScore,
      intent: aiIntent,
    })
    : null;

  return {
    status: 200,
    body: {
      success: true,
      reply: finalReply,
      session_id: sessionId,
      visitor_id: visitor.uuid,
      meta: {
        ...responseMeta,
        ...(previewForOwner && previewAssistantDraft ? { preview_draft_applied: true } : {}),
        ...(previewLeadSummary ? { preview_lead_summary: previewLeadSummary } : {}),
        ...(visitorClientType ? { client_type: visitorClientType } : {}),
        ...(appliedAssistantSetting?.cta_label ? { cta_label: appliedAssistantSetting.cta_label } : {}),
        ...(quickReplies ? { quick_replies: quickReplies } : {}),
        request_document: requestedDocument,
      },
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
