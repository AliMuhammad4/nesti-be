import logger from '../../../utils/logger.js';
import { runChatOpenAiTurn } from './chatOpenAiTurn.js';
import {
  briefDocumentAnswer,
  documentReadReply,
  documentReviewReply,
  intakeHasPropertyImages,
} from '../documents/chatDocumentService.js';
import {
  finishAgentReply,
  finishBrokerReply,
  finishLawyerReply,
  voiceTurnReminder,
} from '../../professionalAssistant/professionalAssistantService.js';
import { buildOutOfScopeReply, detectOutOfScopeMessage } from '../utils/chatScopeGuard.js';

export async function draftProfessionalChatReply(state) {
  const {
    trimmedMessage,
    sessionId,
    flow,
    professionalProfile,
    landingMode,
    appliedAssistantSetting,
    turnAttachments,
    sharedDocuments,
    focusIds,
    focusedDocuments,
    conversationText,
    intent,
    storedForm,
    history,
    lastAssistantReply,
    openaiMessages,
    formQualification,
    seedSignals,
    hasContact,
    contactInfo,
    interactionCount,
    previewForOwner,
    assistantHistory,
    documentPrompt,
    newFileNames,
    systemPrompt,
    onReplyDelta,
  } = state;
  let { leadScore, leadGrade, leadMeta } = state;
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
      text: `${storedForm?.intent || ''} ${storedForm?.mortgage_status || ''} ${conversationText || ''} ${trimmedMessage}`,
      clientType: storedForm?.client_type || appliedAssistantSetting?.client_type || '',
      mortgageStatus: storedForm?.mortgage_status || '',
      propertyImages: intakeHasPropertyImages(storedForm),
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
    aiReply = shapeDocumentReply(reviewReply);
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
              : 200))
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
      return { response: { status: 500, body: { success: false, message: 'AI service unavailable. Please try again.' } } };
    }
  }

  return {
    patch: {
      aiReply,
      aiIntent,
      emotionalState,
      parsedAiDetails,
      leadScore,
      leadGrade,
      leadMeta,
      isOutOfScopeMessage,
      directDocumentReply,
    },
  };
}
