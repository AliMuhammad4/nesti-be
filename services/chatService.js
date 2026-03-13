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
import {
  mergeSignals,
  mergeQualificationForScoring,
  normalizeTimeline,
  scoreLead,
  buildLeadClassification,
  bestGrade,
  createLeadRecords,
  deriveQualificationFromText,
} from './chat/scoringUtils.js';
import { buildSystemPrompt } from './chat/promptUtils.js';

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
  const formSignals = storedForm ? {
    timeline: storedForm.timeline || null,
    budget:   storedForm.budget   || storedForm.price || null,
    location: storedForm.location || null,
    beds:     storedForm.beds  ? (parseInt(storedForm.beds, 10)  || null) : null,
    baths:    storedForm.baths ? (parseInt(storedForm.baths, 10) || null) : null,
    area:     null,
  } : {};

  const formQualification = storedForm ? {
    mortgage_status:    storedForm.mortgage_status || null,
    realtor_status:     storedForm.realtor_status || null,
    motivation_reason:  storedForm.motivation_reason || null,
    viewing_readiness:  storedForm.viewing_readiness || null,
    living_situation:   storedForm.living_situation || null,
    urgency_readiness:  storedForm.urgency_readiness || null,
  } : {};

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

  let { leadScore, leadGrade, leadMeta } = scoreLead({
    message:          conversationText,
    hasContact,
    contactInfo,
    interactionCount,
    seedSignals:      formSignals,
    formQualification,
  });

  const history = await ChatMessage.find({ conversation_id: conversation._id })
    .sort({ createdAt: 1 })
    .limit(20)
    .select('role content');

  const openaiMessages = [
    { role: 'system', content: buildSystemPrompt(professionalProfile) },
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
    leadMeta.signals = mergeSignals(leadMeta.signals, {
      location: parsedAiDetails.property_address || null,
      budget:   parsedAiDetails.budget           || null,
      timeline: parsedAiDetails.timeline         || null,
    });

    const aiEnhancedQualification = mergeQualificationForScoring(formQualification, parsedAiDetails);
    const aiExtractedSignals = {
      location: parsedAiDetails.property_address || null,
      budget:   parsedAiDetails.budget           || null,
      timeline: normalizeTimeline(parsedAiDetails.timeline) || formSignals.timeline || null,
    };
    const aiEnhancedSignals = mergeSignals(formSignals, aiExtractedSignals);

    const aiEnhanced = scoreLead({
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

  const finalScore = Math.max(conversation.lead_score || 0, leadScore);
  const finalGrade = bestGrade(leadGrade, conversation.lead_grade || 'unscored');
  const finalClass = buildLeadClassification(finalGrade, aiIntent);
  // Map lukewarm → warm for DB storage (lukewarm is UI-only color, not a stored category)
  const persistedGrade = finalGrade === 'lukewarm' ? 'warm' : finalGrade;
  const persistedClass = buildLeadClassification(persistedGrade, aiIntent);

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

  const intentSuffix = aiIntent === 'sell' ? 'seller' : 'buyer';
  const existingLeadMatch = await LeadMatch.findOne({
    conversation_id: conversation._id,
    user_id:         userId,
    lead_type:       new RegExp(`${intentSuffix}$`),
  });

  if (!existingLeadMatch && professionalProfile && hasContact) {
    const derivedQual = deriveQualificationFromText(conversationText);
    const mergedAiDetails = {
      ...parsedAiDetails,
      realtor_status:     parsedAiDetails?.realtor_status     || derivedQual.realtor_status || '',
      motivation_reason:  parsedAiDetails?.motivation_reason  || derivedQual.motivation_reason || '',
      viewing_readiness:  parsedAiDetails?.viewing_readiness  || derivedQual.viewing_readiness || '',
      living_situation:   parsedAiDetails?.living_situation   || derivedQual.living_situation || '',
      urgency_readiness:  parsedAiDetails?.urgency_readiness  || derivedQual.urgency_readiness || '',
    };

    await createLeadRecords({
      conversation,
      intent:                aiIntent,
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
  } else if (existingLeadMatch && hasContact) {
    const prevContact = existingLeadMatch.compatibility_factors?.contact || {};
    const hasNewInfo  =
      (contactInfo.email && contactInfo.email !== prevContact.email) ||
      (contactInfo.phone && contactInfo.phone !== prevContact.phone);

    existingLeadMatch.match_score = finalScore;

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
      const derivedQual = deriveQualificationFromText(conversationText);
      const mergedQual = {
        mortgage_status:    parsedAiDetails?.mortgage_status    || formContact?.mortgage_status,
        realtor_status:     parsedAiDetails?.realtor_status     || derivedQual.realtor_status || formContact?.realtor_status,
        motivation_reason:  parsedAiDetails?.motivation_reason  || derivedQual.motivation_reason || formContact?.motivation_reason,
        viewing_readiness:  parsedAiDetails?.viewing_readiness  || derivedQual.viewing_readiness || formContact?.viewing_readiness,
        living_situation:   parsedAiDetails?.living_situation   || derivedQual.living_situation || formContact?.living_situation,
        urgency_readiness:  parsedAiDetails?.urgency_readiness  || derivedQual.urgency_readiness || formContact?.urgency_readiness,
      };
      const update = { total_score: finalScore };
      if (leadMeta.signals?.location) update.location = leadMeta.signals.location;
      if (leadMeta.signals?.budget) update.budget = leadMeta.signals.budget;
      if (leadMeta.signals?.timeline) update.timeline = leadMeta.signals.timeline;
      for (const [k, v] of Object.entries(mergedQual)) {
        if (v) update[k] = v;
      }
      await LeadProfile.findByIdAndUpdate(existingLeadMatch.lead_profile_id, { $set: update });
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
