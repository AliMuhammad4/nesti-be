import crypto from 'crypto';

import ChatConversation from '../models/ChatConversation.js';
import ChatMessage from '../models/ChatMessage.js';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import LeadMatch from '../models/LeadMatch.js';
import LeadProfile from '../models/LeadProfile.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import logger from '../utils/logger.js';

import { getOpenAI } from './chat/openaiClient.js';
import {
  normalizeAgentType,
  classifyIntentFromKeywords,
  normalizeAiIntent,
} from './chat/normalizationUtils.js';
import {
  resolveVisitor,
  extractContactFromMessage,
  mergeContact,
  accumulateContactInfo,
} from './chat/contactUtils.js';
import { mergeSignals, extractSignals } from './chat/scoring/index.js';
import { getFlowForRole } from './chat/flows/index.js';

// ─── Main Chat Service ────────────────────────────────────────────────────────

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

  const trimmedMessage      = message.trim();
  const sessionId           = id || crypto.randomBytes(8).toString('hex');
  const normalizedAgentType = normalizeAgentType(agentType);
  const normalizedChannel   = channel || 'web';

  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
  if (!embed) {
    return { status: 403, body: { success: false, message: 'Invalid or inactive embed token' } };
  }
  const userId = embed.user_id;

  const [visitor, professionalProfile] = await Promise.all([
    resolveVisitor({ visitorUuid: visitorId, embedToken, userAgent, clientIp }),
    ProfessionalProfile.findOne({ user_id: userId }),
  ]);

  // Flow is determined by widget type (agentType) when broker/lawyer, else by embed owner's professional_type.
  const professionalType = professionalProfile?.professional_type || 'agent';
  const flowType =
    normalizedAgentType === 'broker' ? 'mortgage_broker'
    : normalizedAgentType === 'lawyer' ? 'lawyer'
    : professionalType;
  const flow = getFlowForRole(flowType);
  const isAgent = flowType === 'agent';
  const isMortgageBroker = flowType === 'mortgage_broker';
  const isLawyer = flowType === 'lawyer';
  const canCreateLeads = isAgent || isMortgageBroker || isLawyer;

  const intent =
    formContact?.intent === 'sell' || formContact?.intent === 'buy'
      ? formContact.intent
      : classifyIntentFromKeywords(trimmedMessage);

  let conversation = await ChatConversation.findOne({ session_id: sessionId });
  if (!conversation) {
    conversation = await ChatConversation.create({
      session_id:  sessionId,
      user_id:     userId,
      visitor_id:  visitor._id,
      embed_id:    embed._id,
      embed_token: embedToken,
      agent_type:  normalizedAgentType,
      channel:     normalizedChannel,
      intent,
    });
  } else {
    conversation.agent_type          = normalizedAgentType;
    conversation.channel             = normalizedChannel;
    conversation.last_interaction_at = new Date();
    await conversation.save();
  }

  const regexContact = extractContactFromMessage(trimmedMessage);
  const currentContact = mergeContact(regexContact, {
    name:    formContact?.name    || null,
    email:   formContact?.email   ? formContact.email.toLowerCase() : null,
    phone:   formContact?.phone   || null,
    address: formContact?.address || null,
  });

  const storedForm = formContact || conversation.form_data;
  const formSignals = flow.getFormSignals(storedForm);
  const formQualification = flow.getFormQualification(storedForm);

  await ChatMessage.create({
    conversation_id: conversation._id,
    session_id:      sessionId,
    role:            'user',
    content:         trimmedMessage,
    agent_type:      normalizedAgentType,
    intent,
    channel:         normalizedChannel,
    meta: {
      embedToken,
      ip:      clientIp,
      session: sessionId,
      contact: currentContact,
    },
  });

  const contactInfo = await accumulateContactInfo(conversation._id, currentContact);
  const hasContact  = Boolean(contactInfo.email || contactInfo.phone || contactInfo.name);

  const allUserMessages = await ChatMessage.find({
    conversation_id: conversation._id,
    role:            'user',
  })
    .sort({ createdAt: 1 })
    .select('content');
  const interactionCount = allUserMessages.length;
  const conversationText = allUserMessages.map((m) => m.content).join(' ');

  // Merge form signals with text-extracted signals (location, beds, baths, area from conversation)
  const textSignals = extractSignals(conversationText);
  const seedSignals = mergeSignals(formSignals, textSignals);

  let { leadScore, leadGrade, leadMeta } = flow.scoreLead({
    message:          conversationText,
    hasContact,
    contactInfo,
    interactionCount,
    seedSignals,
    formQualification,
  });

  const history = await ChatMessage.find({ conversation_id: conversation._id })
    .sort({ createdAt: 1 })
    .limit(20)
    .select('role content');

  const systemPrompt = flow.buildSystemPrompt(professionalProfile, {
    isAutomatedBookingEnabled: conversation.is_automated_booking_enabled,
    calendlyLink: professionalProfile?.calendly_link,
    leadGrade: leadGrade,
    intent: conversation.intent || intent,
  });
  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  let aiReply        = '';
  let aiMeta         = {};
  let aiIntent       = intent;
  let emotionalState = 'neutral';
  let parsedAiDetails = {};

  try {
    const completion = await getOpenAI().chat.completions.create({
      model:       'gpt-4o-mini',
      messages:    openaiMessages,
      temperature: 0.7,
      max_tokens:  600,
    });

    const rawContent = completion.choices[0].message.content || '';
    const [replyPart, metaPart] = rawContent.split('###META###');
    aiReply = replyPart?.trim() || '';
    if (!aiReply) aiReply = "I'm here to help! Could you tell me a bit more about what you're looking for?";

    if (metaPart) {
      try {
        aiMeta = JSON.parse(metaPart.trim());
      } catch {
        logger.warn(`Failed to parse AI meta JSON — session: ${sessionId}`);
      }
    }

    aiIntent = normalizeAiIntent(aiMeta.intent, intent);
    emotionalState = aiMeta.emotional_state || 'neutral';

    const aiContact = aiMeta.contact || {};
    contactInfo.name    = contactInfo.name    || aiContact.full_name || null;
    contactInfo.email   = contactInfo.email   || (aiContact.email ? aiContact.email.toLowerCase() : null);
    contactInfo.phone   = contactInfo.phone   || aiContact.phone   || null;

    parsedAiDetails = aiMeta.details || {};
    leadMeta.signals = mergeSignals(leadMeta.signals, flow.mergeSignalsForMeta(leadMeta.signals, parsedAiDetails));

    // Use seedSignals (includes text-extracted location/beds/baths/area) as base for AI enhancement
    const { aiEnhancedQualification, aiEnhancedSignals } = flow.enhanceWithAi(formQualification, parsedAiDetails, seedSignals);
    const aiEnhanced = flow.scoreLead({
      message:          conversationText,
      hasContact,
      contactInfo,
      interactionCount,
      seedSignals:      aiEnhancedSignals,
      formQualification: aiEnhancedQualification,
    });

    leadScore = aiEnhanced.leadScore;
    leadGrade = aiEnhanced.leadGrade;
    leadMeta = aiEnhanced.leadMeta;
  } catch (err) {
    logger.error(`OpenAI error — session: ${sessionId} — ${err.message}`);
    return { status: 500, body: { success: false, message: 'AI service unavailable. Please try again.' } };
  }

  const finalScore = leadScore;

  const finalGrade = flow.bestGrade(leadGrade, conversation.lead_grade || 'unscored');
  const persistedGrade = flow.getPersistedGrade(finalGrade);
  const useSimpleClassification = isMortgageBroker || isLawyer;
  const finalClass = useSimpleClassification
    ? flow.getLeadClassification(finalGrade)
    : flow.getLeadClassification(finalGrade, aiIntent);
  const persistedClass = useSimpleClassification
    ? flow.getLeadClassification(persistedGrade)
    : flow.getLeadClassification(persistedGrade, aiIntent);

  await ChatMessage.create({
    conversation_id: conversation._id,
    session_id:      sessionId,
    role:            'assistant',
    content:         aiReply,
    agent_type:      normalizedAgentType,
    intent:          aiIntent,
    channel:         normalizedChannel,
    lead_score:      finalScore,
    lead_grade:      persistedGrade,
    meta: {
      embedToken,
      contact: contactInfo,
      ai_metadata: {
        intent:            aiIntent,
        emotional_state:   emotionalState,
        extracted_data:    parsedAiDetails,
        lead_classification: finalClass,
      },
    },
  });

  conversation.intent              = aiIntent;
  conversation.lead_score          = finalScore;
  conversation.lead_grade          = persistedGrade;
  conversation.lead_classification = persistedClass;
  conversation.lead_reasons        = leadMeta;
  conversation.is_qualified        = leadMeta.qualified;
  conversation.emotional_state     = emotionalState;
  conversation.last_interaction_at = new Date();
  if (formContact) conversation.form_data = formContact;
  await conversation.save();

  const intentSuffix = flow.getIntentSuffix(aiIntent);
  const existingLeadMatch = canCreateLeads
    ? await LeadMatch.findOne({
        conversation_id: conversation._id,
        user_id:         userId,
        lead_type:       new RegExp(`${intentSuffix}$`),
      })
    : null;

  if (canCreateLeads && !existingLeadMatch && professionalProfile && hasContact) {
    const derivedQual = flow.deriveQualificationFromText(conversationText);
    const mergedAiDetails = flow.getMergedAiDetails(parsedAiDetails, derivedQual);

    await flow.createNewLead({
      conversation,
      intent:                (isMortgageBroker || isLawyer) ? 'buy' : aiIntent,
      professionalProfileId: professionalProfile._id,
      leadScore:             finalScore,
      leadGrade:             persistedGrade,
      leadMeta,
      sessionId,
      embedToken,
      clientIp,
      userAgent,
      referer,
      contactInfo,
      userId,
      messageSnippet: trimmedMessage.slice(0, 200),
      formContact:    formContact || {},
      aiDetails:      mergedAiDetails,
    });
  } else if (canCreateLeads && existingLeadMatch && hasContact) {
    const prevContact = existingLeadMatch.compatibility_factors?.contact || {};
    const hasNewInfo  =
      (contactInfo.email && contactInfo.email !== prevContact.email) ||
      (contactInfo.phone && contactInfo.phone !== prevContact.phone);

    if (hasNewInfo) {
      existingLeadMatch.last_contact_at  = new Date();
      existingLeadMatch.contact_count    = (existingLeadMatch.contact_count || 0) + 1;
      existingLeadMatch.compatibility_factors = {
        ...existingLeadMatch.compatibility_factors,
        contact: contactInfo,
      };
    }

    await existingLeadMatch.save();

    if (existingLeadMatch.lead_profile_id) {
      const derivedQual = flow.deriveQualificationFromText(conversationText);
      const mergedQual = flow.getLeadProfileUpdate(parsedAiDetails, derivedQual, formContact);
      const update = {};
      for (const [k, v] of Object.entries(mergedQual)) {
        if (v != null && v !== '') update[k] = v;
      }
      if (Object.keys(update).length) {
        await LeadProfile.findByIdAndUpdate(existingLeadMatch.lead_profile_id, { $set: update });
      }
    }
  }

  return {
    status: 200,
    body: {
      success:    true,
      reply:      aiReply,
      session_id: sessionId,
      visitor_id: visitor.uuid,
      meta: {
        intent:              aiIntent,
        lead_score:          finalScore,
        lead_grade:          finalGrade,
        lead_classification: finalClass,
        is_qualified:        leadMeta.qualified,
        emotional_state:     emotionalState,
        signals:             leadMeta.signals,
        lead_reasons:        leadMeta.lead_reasons,
        sub_scores:          leadMeta.sub_scores,
        contact:             contactInfo,
      },
    },
  };
};
