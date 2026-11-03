import ChatConversation from '../../../models/ChatConversation.js';
import ChatMessage from '../../../models/ChatMessage.js';
import ProfessionalProfile from '../../../models/ProfessionalProfile.js';
import PublicProfile from '../../../models/PublicProfile.js';
import logger from '../../../utils/logger.js';
import { classifyIntentFromKeywords } from '../utils/normalizationUtils.js';
import {
  resolveVisitor,
  accumulateContactInfo,
  buildUserMessageContactMeta,
  hasIdentityContact,
} from '../utils/contactUtils.js';
import { mergeFormContactData } from '../utils/mergeFormContactData.js';
import { mergeSignals, extractSignals } from '../scoring/index.js';
import { getFlowForRole } from '../flows/getFlowForRole.js';
import {
  isAutomatedBookingEnabledForFlow,
  supportsPropertyMatches,
  usesFixedBuyIntentForLeadMatch,
} from '../flows/flowRoleMeta.js';
import {
  isValidProfessionalType,
  professionalTypeToWidgetAgentType,
  resolveChatFlowType,
} from '../../../constants/roles.js';
import {
  resolveCalendlyLinksForVisitor,
  shouldDeferCalendlyLink,
  buildFlowSystemPromptOptions,
} from './chatCalendlyPromptState.js';
import { userSignalsBookingIntent } from '../utils/chatBookingReply.js';
import {
  assistantSettingForPreview,
  assistantAllowsLeadSaving,
  loadAppliedAssistantSetting,
} from '../../professionalAssistant/professionalAssistantService.js';
import { nestiLandingFlow } from '../nestiLanding/nestiLandingFlow.js';
import { attachDocumentsToTurn } from '../documents/chatDocumentService.js';
import { chatAnsweredQuestionIds, openQualificationQuestionIds } from '../../professionalAssistant/qualificationProgress.js';
import { clientTypeForForm, settingForClientType } from '../../professionalAssistant/assistantSettings.js';
import { propertyMatchesEnabledForPlan, readSavedPlan } from './chatPlan.js';
import { prepareTurnDocuments } from './chatTurnDocuments.js';
import { asFormContactRecord, conversationCreateFields, intakeSessionId } from './chatTurnConversation.js';

const MAX_USER_MESSAGES_FOR_SCORING = 120;
const MAX_MESSAGES_FOR_PROMPT = 20;

export async function prepareProfessionalChatTurn(input) {
  let { sessionId } = input;
  const {
    embed,
    trimmedMessage,
    normalizedAgentType,
    normalizedChannel,
    visitorId,
    userAgent,
    clientIp,
    preview,
    viewerUserId,
    previewAssistantDraft,
    testPersona,
    formContact,
    forceNewLead,
    attachmentIds,
    landingMode,
    landingSettings,
    embedToken,
  } = input;
  const userId = embed.user_id;

  const [visitor, professionalProfile, publicProfile] = await Promise.all([
    resolveVisitor({ visitorUuid: visitorId, embedToken, userAgent, clientIp }),
    ProfessionalProfile.findOne({ user_id: userId }),
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
  const subscription = !landingMode && supportsPropertyMatches(flow)
    ? await readSavedPlan(userId)
    : null;
  let propertyMatchesEnabled = landingMode ? false : propertyMatchesEnabledForPlan(flow, subscription);
  if (preview === true && !previewForOwner) {
    return {
      response: {
        status: 403,
        body: { success: false, message: 'Sign in again to preview unsaved changes.' },
      },
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
  propertyMatchesEnabled = landingMode
    ? false
    : (
      intent !== 'sell'
      && propertyMatchesEnabledForPlan(flow, subscription, typedAssistant || appliedAssistantLoaded)
    );
  if (systemPromptOptions && typeof systemPromptOptions === 'object') {
    systemPromptOptions.propertyMatchesEnabled = propertyMatchesEnabled;
  }
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
  const {
    sharedDocuments,
    focusIds,
    focusedDocuments,
    documentPrompt,
    newFileNames,
    systemPrompt,
    openaiMessages,
  } = await prepareTurnDocuments({
    landingMode,
    userId,
    conversation,
    sessionId,
    previewForOwner,
    turnAttachments,
    trimmedMessage,
    flow,
    professionalProfile,
    systemPromptOptions,
    history,
  });

  return {
    state: {
      sessionId,
      userId,
      visitor,
      professionalProfile,
      previewForOwner,
      previewAssistantDraft,
      flowType,
      effectiveWidgetType,
      flow,
      propertyMatchesEnabled,
      canCreateLeads,
      nonAgentBuyerSellerIntent,
      intent,
      conversation,
      mergedFormContact,
      storedForm,
      turnAttachments,
      contactInfo,
      hasContact,
      conversationText,
      leadScore,
      leadGrade,
      leadMeta,
      seedSignals,
      formQualification,
      history,
      assistantHistory,
      lastAssistantReply,
      earlierAssistantReplies,
      calendlyLinkForVisitor,
      isAutomatedBookingEnabled,
      deferCalendlyLink,
      systemPromptOptions,
      visitorClientType,
      appliedAssistantSetting,
      leadSyncEnabled,
      sharedDocuments,
      focusIds,
      focusedDocuments,
      documentPrompt,
      newFileNames,
      systemPrompt,
      openaiMessages,
      interactionCount,
      landingMode,
      embedToken,
      clientIp,
      userAgent,
      referer: input.referer,
      formContact,
      forceNewLead,
      onReplyDelta: input.onReplyDelta,
      normalizedChannel,
      trimmedMessage,
    },
  };
}
