import ChatConversation from '../../../models/ChatConversation.js';
import ChatMessage from '../../../models/ChatMessage.js';
import ChatbotEmbedUrl from '../../../models/ChatbotEmbedUrl.js';
import LeadMatch from '../../../models/LeadMatch.js';
import ProfessionalProfile from '../../../models/ProfessionalProfile.js';
import logger from '../../../utils/logger.js';
import { getFlowForRole } from '../flows/getFlowForRole.js';
import { supportsPropertyMatches } from '../flows/flowRoleMeta.js';
import { flowTypeForConversation } from './chatFlowResolution.js';
import { buildPropertyMatchesPayload } from './chatPropertyMatchesPayload.js';
import { signStoredAttachments } from '../documents/chatDocumentService.js';
import { propertyMatchesEnabledForPlan, readSavedPlan } from './chatPlan.js';
import {
  normalizeInquiredProperty,
  resolveLinkedSellerLeadMatchId,
} from '../../lead/inquiredProperty.js';

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
    ...(m.meta?.selected_property && typeof m.meta.selected_property === 'object'
      ? { selected_property: m.meta.selected_property }
      : {}),
    ...(typeof m.meta?.selected_property_context === 'string' && m.meta.selected_property_context.trim()
      ? { selected_property_context: m.meta.selected_property_context.trim() }
      : {}),
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
  const subscription = supportsPropertyMatches(flow) ? await readSavedPlan(userId) : null;
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

  // Buyer + investor chat leads both store inquired property from "I'm interested".
  let leadMatch = await LeadMatch.findOne({
    conversation_id: conversation._id,
    user_id: embed.user_id,
    lead_type: /_(buyer|client|investor)$/,
  }).sort({ updatedAt: -1, createdAt: -1 });
  if (!leadMatch) {
    // Fallback: any lead on this conversation (covers race before lead_type is finalized).
    leadMatch = await LeadMatch.findOne({
      conversation_id: conversation._id,
      user_id: embed.user_id,
    }).sort({ updatedAt: -1, createdAt: -1 });
  }
  if (!leadMatch) {
    return { status: 404, body: { success: false, message: 'Lead not found for this chat session' } };
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
