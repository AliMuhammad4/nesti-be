import ChatConversation from '../../../models/ChatConversation.js';
import CalendarIntegration from '../../../models/CalendarIntegration.js';
import { calendlyWebhookAlignmentMeta } from '../../calendly/calendlyAlignmentService.js';
import {
  getPostBookingChecklistForMeta,
  supportsPropertyMatches,
  usesFixedBuyIntentForLeadMatch,
  usesMortgageAffordabilitySnapshot,
} from '../flows/flowRoleMeta.js';
import { buildMortgageAffordabilitySnapshot } from '../mortgageBroker/mortgageAffordabilityFromLead.js';

export async function buildChatResponseMeta({
  flow,
  conversation,
  userId,
  professionalProfile,
  hasContact,
  propertyMatchesEnabled = true,
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
  extractedData,
  refetchPropertyMatches = false,
}) {
  const property_matches_available = Boolean(
    supportsPropertyMatches(flow) && propertyMatchesEnabled && hasContact,
  );

  const calendlyBookingSnap = await ChatConversation.findById(conversation._id)
    .select('calendly_booking_status calendly_booking_at')
    .lean();

  const calInt = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' })
    .select('access_token calendly_slug calendly_slug_mismatch')
    .lean();
  const calendlyAlign = calendlyWebhookAlignmentMeta(calInt, professionalProfile);

  const mortgage_affordability_snapshot =
    usesMortgageAffordabilitySnapshot(flow) && mortgageBrokerSnapshotQual
      ? buildMortgageAffordabilitySnapshot(
          mortgageBrokerSnapshotQual,
          mortgageBrokerSnapshotSignals || {},
          finalGrade
        )
      : null;

  const visitorFacingIntent = usesFixedBuyIntentForLeadMatch(flow) ? 'unspecified' : aiIntent;

  return {
    intent: visitorFacingIntent,
    ...(extractedData && typeof extractedData === 'object' ? { extracted_data: extractedData } : {}),
    lead_score: finalScore,
    lead_grade: finalGrade,
    lead_classification: finalClass,
    is_qualified: leadMeta.qualified,
    emotional_state: emotionalState,
    signals: leadMeta.signals,
    lead_reasons: leadMeta.lead_reasons,
    sub_scores: leadMeta.sub_scores,
    contact: contactInfo,
    property_matches_available,
    refetch_property_matches: Boolean(property_matches_available && refetchPropertyMatches),
    calendly_link: deferCalendlyLink ? null : calendlyLinkForVisitor || null,
    conversation_id: conversation._id ? String(conversation._id) : null,
    automated_booking_enabled: isAutomatedBookingEnabled,
    calendly_booking_status: calendlyBookingSnap?.calendly_booking_status ?? null,
    calendly_booking_at: calendlyBookingSnap?.calendly_booking_at ?? null,
    post_booking_checklist:
      calendlyBookingSnap?.calendly_booking_status === 'booked'
        ? getPostBookingChecklistForMeta(flow, finalGrade, aiIntent)
        : null,
    ...calendlyAlign,
    ...(mortgage_affordability_snapshot ? { mortgage_affordability_snapshot } : {}),
  };
}
