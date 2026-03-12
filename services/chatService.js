import crypto from 'crypto';

import ChatConversation from '../models/ChatConversation.js';
import ChatMessage from '../models/ChatMessage.js';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import LeadMatch from '../models/LeadMatch.js';
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
  scoreLead,
  buildLeadClassification,
  bestGrade,
  createLeadRecords,
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
  // ── Input validation ──
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

  // ── Embed resolution ──
  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
  if (!embed) {
    return { status: 403, body: { success: false, message: 'Invalid or inactive embed token' } };
  }
  const userId = embed.user_id;

  // ── Parallel: visitor + professional profile ──
  const [visitor, professionalProfile] = await Promise.all([
    resolveVisitor({ visitorUuid: visitorId, embedToken, userAgent, clientIp }),
    ProfessionalProfile.findOne({ user_id: userId }),
  ]);

  // ── Intent: form takes priority, then keyword detection ──
  const intent =
    formContact?.intent === 'sell' || formContact?.intent === 'buy'
      ? formContact.intent
      : classifyIntentFromKeywords(trimmedMessage);

  // ── Conversation lifecycle ──
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

  // ── Contact extraction ──
  // Regex extraction from the raw message text
  const regexContact = extractContactFromMessage(trimmedMessage);

  // Seed with validated form fields (form always wins over regex)
  const currentContact = mergeContact(regexContact, {
    name:    formContact?.name    || null,
    email:   formContact?.email   ? formContact.email.toLowerCase() : null,
    phone:   formContact?.phone   || null,
    address: formContact?.address || null,
  });

  // ── Build seed signals from form data (used in scoring below) ──
  const formSignals = formContact ? {
    timeline: formContact.timeline || null,
    budget:   formContact.budget   || formContact.price || null,
    location: formContact.location || null,
    beds:     formContact.beds  ? (parseInt(formContact.beds, 10)  || null) : null,
    baths:    formContact.baths ? (parseInt(formContact.baths, 10) || null) : null,
    area:     null,
  } : {};

  // ── Save user message (before accumulation so meta.contact is stored) ──
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

  // ── Accumulate contact across conversation (reads stored meta, not raw text) ──
  const contactInfo = await accumulateContactInfo(conversation._id, currentContact);
  const hasContact  = Boolean(contactInfo.email || contactInfo.phone || contactInfo.name);

  // ── Message count for engagement scoring ──
  const interactionCount = await ChatMessage.countDocuments({ conversation_id: conversation._id });

  // ── Lead scoring (form signals seeded in so score is accurate on message 1) ──
  const { leadScore, leadGrade, leadMeta } = scoreLead({
    message:          trimmedMessage,
    hasContact,
    contactInfo,
    interactionCount,
    seedSignals:      formSignals,
  });

  // ── Build OpenAI history ──
  const history = await ChatMessage.find({ conversation_id: conversation._id })
    .sort({ createdAt: 1 })
    .limit(20)
    .select('role content');

  const openaiMessages = [
    { role: 'system', content: buildSystemPrompt(professionalProfile) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  // ── OpenAI call ──
  let aiReply        = '';
  let aiMeta         = {};
  let aiIntent       = intent;
  let emotionalState = 'neutral';

  try {
    const completion = await getOpenAI().chat.completions.create({
      model:       'gpt-4o-mini',
      messages:    openaiMessages,
      temperature: 0.7,
      max_tokens:  600,
    });

    const rawContent = completion.choices[0].message.content || '';
    const [replyPart, metaPart] = rawContent.split('###META###');
    aiReply = replyPart.trim();

    if (metaPart) {
      try {
        aiMeta = JSON.parse(metaPart.trim());
      } catch {
        logger.warn(`Failed to parse AI meta JSON — session: ${sessionId}`);
      }
    }

    // Normalize AI intent
    aiIntent = normalizeAiIntent(aiMeta.intent, intent);
    emotionalState = aiMeta.emotional_state || 'neutral';

    // Merge AI-extracted contact (only fills gaps, never overwrites)
    const aiContact = aiMeta.contact || {};
    contactInfo.name    = contactInfo.name    || aiContact.full_name || null;
    contactInfo.email   = contactInfo.email   || (aiContact.email ? aiContact.email.toLowerCase() : null);
    contactInfo.phone   = contactInfo.phone   || aiContact.phone   || null;

    // Merge AI details into signals (only fills gaps)
    const aiDetails = aiMeta.details || {};
    leadMeta.signals = mergeSignals(leadMeta.signals, {
      location: aiDetails.property_address || null,
      budget:   aiDetails.budget           || null,
      timeline: aiDetails.timeline         || null,
    });
  } catch (err) {
    logger.error(`OpenAI error — session: ${sessionId} — ${err.message}`);
    return { status: 500, body: { success: false, message: 'AI service unavailable. Please try again.' } };
  }

  // ── Compute best (highest) score/grade across conversation lifetime ──
  const finalScore = Math.max(conversation.lead_score || 0, leadScore);
  const finalGrade = bestGrade(leadGrade, conversation.lead_grade || 'unscored');
  const finalClass = buildLeadClassification(finalGrade, aiIntent);

  // ── Save AI reply message ──
  await ChatMessage.create({
    conversation_id: conversation._id,
    session_id:      sessionId,
    role:            'assistant',
    content:         aiReply,
    agent_type:      normalizedAgentType,
    intent:          aiIntent,
    channel:         normalizedChannel,
    lead_score:      finalScore,
    lead_grade:      finalGrade,
    meta: {
      embedToken,
      contact: contactInfo,
      ai_metadata: {
        intent:            aiIntent,
        emotional_state:   emotionalState,
        extracted_data:    aiMeta.details || {},
        lead_classification: finalClass,
      },
    },
  });

  // ── Update conversation rollup ──
  conversation.intent             = aiIntent;
  conversation.lead_score         = finalScore;
  conversation.lead_grade         = finalGrade;
  conversation.lead_classification = finalClass;
  conversation.lead_reasons       = leadMeta;
  conversation.is_qualified       = leadMeta.qualified;
  conversation.emotional_state    = emotionalState;
  conversation.last_interaction_at = new Date();
  await conversation.save();

  // ── Lead creation / update ──
  // Look for an existing lead MATCHED FOR THIS INTENT (buyer vs seller).
  const intentSuffix = aiIntent === 'sell' ? 'seller' : 'buyer';
  const existingLeadMatch = await LeadMatch.findOne({
    conversation_id: conversation._id,
    user_id:         userId,
    lead_type:       new RegExp(`${intentSuffix}$`),
  });

  if (!existingLeadMatch && professionalProfile && hasContact) {
    await createLeadRecords({
      conversation,
      intent:                aiIntent,
      professionalProfileId: professionalProfile._id,
      leadScore:             finalScore,
      leadGrade:             finalGrade,
      leadMeta,
      sessionId,
      embedToken,
      clientIp,
      userAgent,
      referer,
      contactInfo,
      userId,
      messageSnippet: trimmedMessage.slice(0, 200),
    });
  } else if (existingLeadMatch && hasContact) {
    const prevContact = existingLeadMatch.compatibility_factors?.contact || {};
    const hasNewInfo  =
      (contactInfo.email && contactInfo.email !== prevContact.email) ||
      (contactInfo.phone && contactInfo.phone !== prevContact.phone);

    // Always keep the latest/best score on the lead match
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
  }

  // ── Response ──
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
        contact:             contactInfo,
      },
    },
  };
};
