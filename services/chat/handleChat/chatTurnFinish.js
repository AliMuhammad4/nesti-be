import ChatConversation from '../../../models/ChatConversation.js';
import ChatMessage from '../../../models/ChatMessage.js';
import logger from '../../../utils/logger.js';
import { coerceContactIdentityFields, hasIdentityContact } from '../utils/contactUtils.js';
import { classifyLeadForFlow } from '../flows/flowRoleMeta.js';
import { syncLeadMatchAfterTurn, buildChatResponseMeta } from './index.js';
import { identityReply } from '../utils/profileVisitorFacts.js';
import { appendCalendlyBookingLink, holdFurtherQuestions, offerConsultationAfterSkippedUpload, userSignalsBookingIntent } from '../utils/chatBookingReply.js';
import { keepOpenQuestion, qualificationStillOpen, quickRepliesForReply } from '../../professionalAssistant/qualificationProgress.js';
import { dropRepeatedVisitorName, replyLanguage } from '../../professionalAssistant/replyStyle.js';
import {
  assistantAnnouncingOptionCards,
  assistantOfferedAvailableOptions,
  shouldRefetchPropertyMatchesForMessage,
} from '../utils/propertyMatchesRequestIntent.js';
import { stripPropertyListingsFromReply } from '../utils/stripPropertyListingsFromReply.js';
import {
  buildLeadRecapMarkdownLines,
  injectLeadRecapIntoReply,
  shouldHydrateLeadRecap,
} from '../utils/leadRecapMarkdown.js';
import {
  applyDocumentAsk,
  followUpSkipIds,
  intakeHasPropertyImages,
  nextDocumentRequest,
} from '../documents/chatDocumentService.js';
import { withOccasionalEmoji } from '../../professionalAssistant/professionalAssistantService.js';
import { buildPreviewLeadSummary, leadClientTypeExtras } from './previewLeadSummary.js';
import { normalizePersistedGradeByScore } from './chatPlan.js';

export async function finishProfessionalChatTurn(state, patch) {
  const {
    trimmedMessage,
    sessionId,
    flow,
    professionalProfile,
    landingMode,
    appliedAssistantSetting,
    turnAttachments,
    sharedDocuments,
    conversationText,
    intent,
    storedForm,
    history,
    assistantHistory,
    lastAssistantReply,
    earlierAssistantReplies,
    calendlyLinkForVisitor,
    isAutomatedBookingEnabled,
    deferCalendlyLink,
    systemPromptOptions,
    visitorClientType,
    leadSyncEnabled,
    propertyMatchesEnabled,
    canCreateLeads,
    nonAgentBuyerSellerIntent,
    conversation,
    mergedFormContact,
    previewForOwner,
    previewAssistantDraft,
    flowType,
    effectiveWidgetType,
    userId,
    visitor,
    embedToken,
    clientIp,
    userAgent,
    referer,
    formContact,
    forceNewLead,
    normalizedChannel,
    interactionCount,
  } = state;
  let {
    aiReply,
    aiIntent,
    emotionalState,
    parsedAiDetails,
    leadScore,
    leadGrade,
    leadMeta,
    isOutOfScopeMessage,
    directDocumentReply,
  } = patch;
  let contactInfo = state.contactInfo;
  let hasContact = state.hasContact;
  const mortgageBrokerSnapshotQual = null;
  const mortgageBrokerSnapshotSignals = null;
  coerceContactIdentityFields(contactInfo);
  hasContact = hasIdentityContact(contactInfo);

  // Document follow-ups still look across recent assistant turns; options consent
  // must only key off the immediate previous reply or "yes" sticks for ~8 turns.
  const previousAssistantReply = earlierAssistantReplies;
  const refetchPropertyMatches = shouldRefetchPropertyMatchesForMessage(trimmedMessage, {
    previousAssistantReply: lastAssistantReply,
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
  if (appliedAssistantSetting?.client_type_blocked) {
    finalReply = 'This assistant is not set up for that client type. Please choose another option or contact the professional directly.';
  }
  finalReply = holdFurtherQuestions(finalReply, trimmedMessage, replyLanguage(appliedAssistantSetting, trimmedMessage, conversationText));
  finalReply = keepOpenQuestion(finalReply, appliedAssistantSetting, storedForm, systemPromptOptions.chatAnsweredQuestions, trimmedMessage);
  const visitorAskedToMeet = userSignalsBookingIntent(trimmedMessage);
  const stillAsking = /[?？]/.test(finalReply) && !visitorAskedToMeet;
  const questionsOpen = qualificationStillOpen(appliedAssistantSetting, storedForm, systemPromptOptions.chatAnsweredQuestions);
  const documentContext = {
    intent,
    text: `${storedForm?.intent || ''} ${conversationText || ''} ${trimmedMessage}`,
    propertyImages: intakeHasPropertyImages(storedForm),
    clientType: storedForm?.client_type || appliedAssistantSetting?.client_type || '',
  };
  const documentsAlreadyAsked = followUpSkipIds(appliedAssistantSetting, sharedDocuments, documentContext, history, lastAssistantReply);
  const visitorSkippedUpload = !turnAttachments.length && !questionsOpen && documentsAlreadyAsked.length > 0;
  const documentStillOpen = Boolean(
    !visitorSkippedUpload
    && appliedAssistantSetting?.applied
    && appliedAssistantSetting.document_requests?.length
    && nextDocumentRequest(appliedAssistantSetting, sharedDocuments, documentContext, documentsAlreadyAsked),
  );
  const offeringOptions = assistantOfferedAvailableOptions(finalReply);
  const showingOptions = refetchPropertyMatches || assistantAnnouncingOptionCards(finalReply);
  const waitOnOptions = offeringOptions || showingOptions;
  if (!waitOnOptions && !stillAsking && isAutomatedBookingEnabled && calendlyLinkForVisitor && scheduleAllowed && !namedReply && (visitorAskedToMeet || (!questionsOpen && !documentStillOpen && !deferCalendlyLink && hasContact))) {
    finalReply = appendCalendlyBookingLink(finalReply, calendlyLinkForVisitor, {
      userMessage: trimmedMessage,
      allowSchedule: scheduleAllowed,
      label: appliedAssistantSetting?.cta_label || '',
    });
  }

  const stillReadingDocument = /still (reading|looking)/i.test(directDocumentReply || '');
  let requestedDocument = null;
  if (waitOnOptions) {
    // Options offer or listings turn: wait for the visitor before document/booking lines.
  } else if (visitorSkippedUpload && scheduleAllowed && !namedReply && !deferCalendlyLink && calendlyLinkForVisitor) {
    finalReply = offerConsultationAfterSkippedUpload(finalReply, calendlyLinkForVisitor, {
      allowSchedule: scheduleAllowed,
      label: appliedAssistantSetting?.cta_label || '',
    });
  } else if (!namedReply && !landingMode && appliedAssistantSetting?.applied && appliedAssistantSetting.document_requests?.length && !isOutOfScopeMessage && !stillReadingDocument) {
    const asked = applyDocumentAsk(
      finalReply,
      nextDocumentRequest(appliedAssistantSetting, sharedDocuments, documentContext, followUpSkipIds(appliedAssistantSetting, sharedDocuments, documentContext, history, lastAssistantReply)),
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

  // Lead lookup, CRM write, and the new-lead email run after the reply is ready.
  void syncLeadTask;

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
}
