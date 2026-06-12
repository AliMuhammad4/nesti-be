import OpenAI from 'openai';
import logger from '../../../utils/logger.js';
import { mergeSignals } from '../scoring/index.js';
import { normalizeAiIntent } from '../utils/normalizationUtils.js';
import { coerceContactIdentityFields } from '../utils/contactUtils.js';
let _openaiClient = null;
function getOpenAI() {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
}
export async function runChatOpenAiTurn({
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
}) {
  const completion = await getOpenAI().chat.completions.create(
    {
      model: 'gpt-4o-mini',
      messages: openaiMessages,
      temperature: 0.7,
      max_tokens: 600,
    },
    { timeout: 60_000 },
  );

  const rawContent = completion.choices[0].message.content || '';
  const [replyPart, metaPart] = rawContent.split('###META###');
  let aiReply = replyPart?.trim() || '';
  if (!aiReply) {
    aiReply = "I'm here to help! Could you tell me a bit more about what you're looking for?";
  }

  let aiMeta = {};
  if (metaPart) {
    try {
      aiMeta = JSON.parse(metaPart.trim());
    } catch {
      logger.warn(`Failed to parse AI meta JSON — session: ${sessionId}`);
    }
  }

  let aiIntent = normalizeAiIntent(aiMeta.intent, intent);
  const emotionalState = aiMeta.emotional_state || 'neutral';

  const aiContact = aiMeta.contact || {};
  contactInfo.name = contactInfo.name || aiContact.full_name || null;
  contactInfo.email = contactInfo.email || (aiContact.email ? aiContact.email.toLowerCase() : null);
  contactInfo.phone = contactInfo.phone || aiContact.phone || null;
  coerceContactIdentityFields(contactInfo);

  const parsedAiDetails = aiMeta.details || {};

  const { aiEnhancedQualification, aiEnhancedSignals } = flow.enhanceWithAi(
    formQualification,
    parsedAiDetails,
    seedSignals
  );
  const aiEnhanced = flow.scoreLead({
    message: conversationText,
    hasContact,
    contactInfo,
    interactionCount,
    seedSignals: aiEnhancedSignals,
    formQualification: aiEnhancedQualification,
  });

  let { leadScore, leadGrade, leadMeta } = aiEnhanced;
  if (!leadMeta || typeof leadMeta !== 'object') {
    leadMeta = { signals: {}, qualified: false, lead_reasons: [] };
  }
  const baseSignals = leadMeta.signals && typeof leadMeta.signals === 'object' ? leadMeta.signals : {};
  leadMeta.signals = mergeSignals(baseSignals, flow.mergeSignalsForMeta(baseSignals, parsedAiDetails));

  return {
    aiReply,
    aiIntent,
    emotionalState,
    parsedAiDetails,
    leadScore,
    leadGrade,
    leadMeta,
  };
}
