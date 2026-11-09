import ChatConversation from '../../../models/ChatConversation.js';
import ChatMessage from '../../../models/ChatMessage.js';
import logger from '../../../utils/logger.js';
import { coerceContactIdentityFields, hasIdentityContact } from '../utils/contactUtils.js';
import { classifyLeadForFlow } from '../flows/flowRoleMeta.js';
import { syncLeadMatchAfterTurn, buildChatResponseMeta } from './index.js';
import { identityReply } from '../utils/profileVisitorFacts.js';
import {
  appendCalendlyBookingLink,
  holdFurtherQuestions,
  offerConsultationAfterSkippedUpload,
  stripBookingLinks,
  userSignalsBookingIntent,
  isDocumentDeclineMessage,
} from '../utils/chatBookingReply.js';
import {
  keepOpenQuestion,
  qualificationStillOpen,
  quickRepliesForReply,
  stripAnsweredIntakeAsks,
  openQualificationQuestionIds,
} from '../../professionalAssistant/qualificationProgress.js';
import { questionLabel } from '../../professionalAssistant/assistantSettings.js';
import {
  availableOptionsOffer,
  applyAgentOpeningFunnel,
  investorStrategyGoalConflict,
  declineRefinementReply,
  DECLINE_REFINE_RE,
  dropRepeatedVisitorName,
  replyLanguage,
  REPLY_QUESTION_RE,
  REPLY_SENTENCE_SPLIT_RE,
} from '../../professionalAssistant/replyStyle.js';
import {
  assistantAnnouncingOptionCards,
  assistantOfferedAvailableOptions,
  historyDeclinedAvailableOptions,
  historyOfferedAvailableOptions,
  classifyAvailableOptionsFeedback,
  isAvailableOptionsDeclineMessage,
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
import { keepModelEmoji } from '../../professionalAssistant/assistantEmoji.js';
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
    } else if (!hasContact) {
      finalReply = 'I can show available options once I have a contact detail. What name, email, or phone number should I use?';
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
  const flowRole = flow?.flowRole || '';
  if (!landingMode && ['agent', 'mortgage_broker', 'lawyer'].includes(flowRole) && (storedForm || mergedFormContact)) {
    // Prefer this-turn form + AI extraction so we do not re-ask a city the visitor just named.
    const formForIntakeStrip = {
      ...(storedForm && typeof storedForm === 'object' ? storedForm : {}),
      ...(mergedFormContact && typeof mergedFormContact === 'object' ? mergedFormContact : {}),
    };
    const extractedLocation = String(
      parsedAiDetails?.property_address
      || parsedAiDetails?.location
      || parsedAiDetails?.buy_property_location
      || '',
    ).trim();
    if (extractedLocation) {
      if (!String(formForIntakeStrip.location || '').trim()) {
        formForIntakeStrip.location = extractedLocation;
      }
      if (!String(formForIntakeStrip.buy_property_location || '').trim()) {
        formForIntakeStrip.buy_property_location = extractedLocation;
      }
    }
    finalReply = stripAnsweredIntakeAsks(
      finalReply,
      flowRole,
      formForIntakeStrip,
      systemPromptOptions.chatAnsweredQuestions || [],
    );
  }
  const visitorAskedToMeet = userSignalsBookingIntent(trimmedMessage);
  const questionsOpen = qualificationStillOpen(appliedAssistantSetting, storedForm, systemPromptOptions.chatAnsweredQuestions);
  const visitorClientTypeEarly = String(
    storedForm?.client_type || appliedAssistantSetting?.client_type || visitorClientType || '',
  ).toLowerCase();
  const isInvestorVisitor = visitorClientTypeEarly === 'investor'
    || String(storedForm?.motivation_reason || '').toLowerCase() === 'investment'
    || Boolean(storedForm?.investment_type || storedForm?.investment_goal);
  const declinedOptionsThisTurn = isAvailableOptionsDeclineMessage(trimmedMessage);
  const optionsAlreadyDeclined = declinedOptionsThisTurn || historyDeclinedAvailableOptions(history);
  const optionsAlreadyShown = Boolean(
    storedForm?.property_matches_shown
    || mergedFormContact?.property_matches_shown
    || storedForm?.property_options_status === 'shown'
    || mergedFormContact?.property_options_status === 'shown',
  );
  const optionsFeedback = flow?.flowRole === 'agent' && isInvestorVisitor && optionsAlreadyShown
    ? classifyAvailableOptionsFeedback(trimmedMessage)
    : null;
  const optionsStatus = String(
    storedForm?.property_options_status
    || mergedFormContact?.property_options_status
    || '',
  ).toLowerCase();
  const optionsAlreadyOffered = historyOfferedAvailableOptions(history)
    || assistantOfferedAvailableOptions(lastAssistantReply)
    || optionsAlreadyShown
    || optionsAlreadyDeclined
    || optionsStatus === 'offered'
    || optionsStatus === 'shown'
    || optionsStatus === 'declined';
  // Buyers/investors must get one "available options" ask before docs or booking.
  // Never re-ask after they already saw cards or declined matches.
  // Skip on the very first assistant reply after form submit so greeting/intake lands first.
  const isOpeningFormTurn = Number(interactionCount || 0) <= 1
    || !(Array.isArray(history) ? history : []).some((message) => message?.role === 'assistant');
  finalReply = applyAgentOpeningFunnel(finalReply, {
    isOpeningFormTurn,
    flowRole,
    namedReply: Boolean(namedReply),
    isOutOfScopeMessage: Boolean(isOutOfScopeMessage),
    isInvestorVisitor,
    intent,
    locationHint: String(
      storedForm?.location
      || storedForm?.buy_property_location
      || mergedFormContact?.location
      || mergedFormContact?.buy_property_location
      || '',
    ).trim(),
    setting: appliedAssistantSetting,
    userMessage: trimmedMessage,
    conversationText,
    nextQuestion: questionLabel(
      appliedAssistantSetting,
      openQualificationQuestionIds(
        appliedAssistantSetting,
        { ...(storedForm && typeof storedForm === 'object' ? storedForm : {}), ...(mergedFormContact && typeof mergedFormContact === 'object' ? mergedFormContact : {}) },
        systemPromptOptions.chatAnsweredQuestions || [],
      )[0],
    ) || '',
    investmentGoalKnown: Boolean(storedForm?.investment_goal || mergedFormContact?.investment_goal),
    strategyGoalConflict: investorStrategyGoalConflict(
      storedForm?.investment_type || mergedFormContact?.investment_type,
      storedForm?.investment_goal || mergedFormContact?.investment_goal,
    ),
  });
  const shouldForceOptionsOffer = Boolean(
    !landingMode
    && !namedReply
    && !isOutOfScopeMessage
    && flowRole === 'agent'
    && propertyMatchesEnabled
    && hasContact
    && intent !== 'sell'
    && !questionsOpen
    && !isOpeningFormTurn
    && !refetchPropertyMatches
    && !optionsAlreadyOffered
    && !optionsAlreadyDeclined
    && !assistantOfferedAvailableOptions(finalReply)
    && !assistantAnnouncingOptionCards(finalReply)
    && !visitorAskedToMeet,
  );
  if (shouldForceOptionsOffer) {
    const statements = String(finalReply || '')
      .split(REPLY_SENTENCE_SPLIT_RE)
      .filter((sentence) => sentence && !REPLY_QUESTION_RE.test(sentence) && !/\b(upload|proof of funds|pre-?approval|document)\b/i.test(sentence))
      .slice(0, 2)
      .join(' ')
      .trim();
    const offerAsk = availableOptionsOffer(
      appliedAssistantSetting,
      isInvestorVisitor,
      trimmedMessage,
      conversationText,
    );
    if (offerAsk) {
      finalReply = `${statements || (replyLanguage(appliedAssistantSetting, trimmedMessage, conversationText) === 'english'
      ? (isInvestorVisitor ? 'Thanks for sharing your investment details.' : 'Thanks for sharing your details.')
      : '')} ${offerAsk}`.trim();
    }
  } else if (declinedOptionsThisTurn && !optionsFeedback) {
    // Acknowledge the decline and move on — do not re-pitch the same options ask.
    const statements = stripPropertyListingsFromReply(finalReply)
      .split(REPLY_SENTENCE_SPLIT_RE)
      .filter((sentence) => {
        if (!sentence) return false;
        if (assistantOfferedAvailableOptions(sentence)) return false;
        if (/\b(available )?(investment )?(options|listings|properties|matches)\b/i.test(sentence) && REPLY_QUESTION_RE.test(sentence)) {
          return false;
        }
        return true;
      })
      .slice(0, 2)
      .join(' ')
      .trim();
    finalReply = statements
      || (isInvestorVisitor
        ? 'No problem — we can skip those listings for now and keep refining what you want.'
        : 'No problem — we can skip those listings for now and keep refining what you want.');
  }
  if (declinedOptionsThisTurn && flowRole === 'agent') {
    finalReply = declineRefinementReply(finalReply, {
      nextQuestion: questionLabel(
        appliedAssistantSetting,
        openQualificationQuestionIds(appliedAssistantSetting, storedForm || {}, systemPromptOptions.chatAnsweredQuestions || [])[0],
      ) || '',
      isInvestor: isInvestorVisitor,
      language: replyLanguage(appliedAssistantSetting, trimmedMessage, conversationText),
    });
  }
  const refinementPending = DECLINE_REFINE_RE.test(String(lastAssistantReply || ''));
  const documentContext = {
    intent,
    text: `${storedForm?.intent || ''} ${storedForm?.mortgage_status || ''} ${conversationText || ''} ${trimmedMessage}`,
    propertyImages: intakeHasPropertyImages(storedForm),
    clientType: storedForm?.client_type || appliedAssistantSetting?.client_type || '',
    mortgageStatus: storedForm?.mortgage_status || '',
  };
  const documentsAlreadyAsked = followUpSkipIds(appliedAssistantSetting, sharedDocuments, documentContext, history, lastAssistantReply);
  // Explicit deferral of an asked document ends the document sequence (all document requests are optional).
  const documentDeclined = documentsAlreadyAsked.length > 0
    && !turnAttachments.length
    && isDocumentDeclineMessage(trimmedMessage);
  const visitorSkippedUpload = !turnAttachments.length && !questionsOpen && documentsAlreadyAsked.length > 0
    && (!optionsFeedback || documentDeclined);
  const documentStillOpen = Boolean(
    !visitorSkippedUpload
    && appliedAssistantSetting?.applied
    && appliedAssistantSetting.document_requests?.length
    && nextDocumentRequest(appliedAssistantSetting, sharedDocuments, documentContext, documentsAlreadyAsked),
  );
  const offeringOptions = assistantOfferedAvailableOptions(finalReply);
  const showingOptions = refetchPropertyMatches || assistantAnnouncingOptionCards(finalReply);
  const waitOnOptions = offeringOptions || showingOptions || shouldForceOptionsOffer;
  const optionsGateOpen = Boolean(
    propertyMatchesEnabled
    && intent !== 'sell'
    && flowRole === 'agent'
    && !optionsAlreadyOffered
    && !showingOptions
    && !refetchPropertyMatches,
  );
  const stillReadingDocument = /still (reading|looking)/i.test(directDocumentReply || '');
  let requestedDocument = null;
  if (waitOnOptions || shouldForceOptionsOffer) {
    // Options offer or listings turn: wait for the visitor before document/booking lines.
    finalReply = stripBookingLinks(finalReply, calendlyLinkForVisitor);
  } else if (
    !namedReply
    && !landingMode
    && !optionsGateOpen
    && appliedAssistantSetting?.applied
    && appliedAssistantSetting.document_requests?.length
    && !isOutOfScopeMessage
    && !stillReadingDocument
    && !visitorSkippedUpload
    && !optionsFeedback
    // Answer a direct visitor question first; after a decline, refine criteria instead of asking for files.
    && !REPLY_QUESTION_RE.test(trimmedMessage)
    && !declinedOptionsThisTurn
    && !(optionsAlreadyDeclined && questionsOpen)
    && !refinementPending
    && !documentDeclined
  ) {
    const asked = applyDocumentAsk(
      finalReply,
      nextDocumentRequest(appliedAssistantSetting, sharedDocuments, documentContext, followUpSkipIds(appliedAssistantSetting, sharedDocuments, documentContext, history, lastAssistantReply)),
      { previousReply: previousAssistantReply, userMessage: trimmedMessage, setting: appliedAssistantSetting, conversationText, qualificationOpen: !turnAttachments.length && qualificationStillOpen(appliedAssistantSetting, storedForm, systemPromptOptions.chatAnsweredQuestions) },
    );
    finalReply = asked.reply;
    requestedDocument = asked.request;
    if (requestedDocument) {
      finalReply = stripBookingLinks(finalReply, calendlyLinkForVisitor);
    }
  }
  let consultationOffered = false;
  if (visitorSkippedUpload && !waitOnOptions && !namedReply) {
    consultationOffered = Boolean(isAutomatedBookingEnabled && scheduleAllowed && calendlyLinkForVisitor);
    finalReply = offerConsultationAfterSkippedUpload(finalReply, calendlyLinkForVisitor, {
      allowSchedule: isAutomatedBookingEnabled && scheduleAllowed,
      label: appliedAssistantSetting?.cta_label || '',
    });
  }
  const replyStillAsking = REPLY_QUESTION_RE.test(finalReply) && !visitorAskedToMeet;
  // When the reply already offers "we can also pick a time", never strip the link it promises.
  const bookingLinkAllowed = consultationOffered || Boolean(
    !waitOnOptions
    && !replyStillAsking
    && (!optionsGateOpen || documentDeclined)
    && isAutomatedBookingEnabled
    && calendlyLinkForVisitor
    && scheduleAllowed
    && !namedReply
    && !requestedDocument
    && (
      visitorAskedToMeet
      || visitorSkippedUpload
      || (!questionsOpen && !documentStillOpen && !deferCalendlyLink && hasContact)
    ),
  );
  if (bookingLinkAllowed) {
    finalReply = appendCalendlyBookingLink(finalReply, calendlyLinkForVisitor, {
      userMessage: trimmedMessage,
      allowSchedule: scheduleAllowed,
      label: appliedAssistantSetting?.cta_label || '',
    });
  } else {
    finalReply = stripBookingLinks(finalReply, calendlyLinkForVisitor);
  }
  // Always run: when use_emojis is off this still strips model emojis from the reply.
  if (appliedAssistantSetting) {
    finalReply = keepModelEmoji(finalReply, aiReply, appliedAssistantSetting);
    finalReply = withOccasionalEmoji(finalReply, appliedAssistantSetting, {
      previousReply: lastAssistantReply,
      userMessage: trimmedMessage,
      // Upload reviews and operational document asks stay emoji-free.
      documentReceived: Boolean(requestedDocument) || turnAttachments.length > 0,
    });
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
  const classExtras = { clientType: visitorClientType || '', client_type: visitorClientType || '' };
  const finalClass = classifyLeadForFlow(flow, finalGrade, aiIntent, classExtras);
  const persistedClass = classifyLeadForFlow(flow, persistedGrade, aiIntent, classExtras);

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
  const formDataToPersist = {
    ...(mergedFormContact && typeof mergedFormContact === 'object' ? mergedFormContact : {}),
  };
  delete formDataToPersist.selected_property;
  delete formDataToPersist.selected_property_context;
  if (declinedOptionsThisTurn) {
    formDataToPersist.property_options_status = 'declined';
    formDataToPersist.property_matches_shown = true;
  } else if (shouldForceOptionsOffer && formDataToPersist.property_options_status !== 'shown') {
    formDataToPersist.property_options_status = 'offered';
  }
  conversation.form_data = formDataToPersist;
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
    assistantSetting: appliedAssistantSetting,
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
    qualificationOpen: questionsOpen,
  });

  // Lead lookup, CRM write, and the new-lead email run after the reply is ready.
  // Fire-and-forget: an unhandled rejection here would crash the API process.
  void Promise.resolve(syncLeadTask).catch((error) => {
    logger.warn('Lead sync after chat turn failed', { error: error?.message });
  });

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
