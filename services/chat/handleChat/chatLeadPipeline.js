import logger from '../../../utils/logger.js';
import LeadMatch from '../../../models/LeadMatch.js';
import LeadProfile from '../../../models/LeadProfile.js';
import { usesFixedBuyIntentForLeadMatch } from '../flows/flowRoleMeta.js';
export async function syncLeadMatchAfterTurn({
  flow,
  flowType,
  canCreateLeads,
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
  formContact,
  parsedAiDetails,
  finalScore,
  persistedGrade,
  leadMeta,
  aiIntent,
}) {
  const intentSuffix = flow.getIntentSuffix(aiIntent);
  const existingLeadMatch = canCreateLeads
    ? await LeadMatch.findOne({
        conversation_id: conversation._id,
        user_id: userId,
        lead_type: new RegExp(`${intentSuffix}$`),
      })
    : null;

  if (canCreateLeads && !existingLeadMatch && professionalProfile && hasContact) {
    const derivedQual = flow.deriveQualificationFromText(conversationText);
    const mergedAiDetails = flow.getMergedAiDetails(parsedAiDetails, derivedQual);

    const newLeadMatch = await flow.createNewLead({
      conversation,
      intent: usesFixedBuyIntentForLeadMatch(flow) ? 'buy' : aiIntent,
      professionalProfileId: professionalProfile._id,
      leadScore: finalScore,
      leadGrade: persistedGrade,
      leadMeta,
      sessionId,
      embedToken,
      clientIp,
      userAgent,
      referer,
      contactInfo,
      userId,
      messageSnippet: trimmedMessage.slice(0, 200),
      formContact: formContact || {},
      aiDetails: mergedAiDetails,
    });
    if (newLeadMatch?._id) {
      logger.info('Chat service: new lead match created', {
        op: 'chat.lead',
        flow: flowType,
        conversation_id: String(conversation._id),
        session_id: sessionId,
        lead_match_id: String(newLeadMatch._id),
        owner_user_id: String(userId),
        lead_grade: persistedGrade,
        intent: aiIntent,
      });
    }
    return;
  }

  if (!canCreateLeads || !existingLeadMatch || !hasContact) return;

  const prevContact = existingLeadMatch.compatibility_factors?.contact || {};
  const hasNewInfo =
    (contactInfo.email && contactInfo.email !== prevContact.email) ||
    (contactInfo.phone && contactInfo.phone !== prevContact.phone);

  if (hasNewInfo) {
    existingLeadMatch.last_contact_at = new Date();
    existingLeadMatch.contact_count = (existingLeadMatch.contact_count || 0) + 1;
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
      if (v === undefined) continue;
      if (v === '' && k !== 'budget') continue;
      update[k] = v;
    }
    if (Object.keys(update).length) {
      await LeadProfile.findByIdAndUpdate(existingLeadMatch.lead_profile_id, { $set: update });
    }
  }
}
