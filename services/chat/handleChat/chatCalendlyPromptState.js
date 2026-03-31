import ChatConversation from '../../../models/ChatConversation.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import { visitorHasPreferredContactPrefs } from '../mortgageBroker/mortgageCalendlyUtils.js';
import {
  getPostBookingChecklistForPrompt,
  isAutomatedBookingEnabledForFlow,
  resolveCalendlyUrlForFlow,
} from '../flows/flowRoleMeta.js';
import { getLastAssistantExtractedData, withCalendlyConversationTracking } from './chatEmbedUtils.js';

export function resolveCalendlyLinksForVisitor(flow, professionalProfile, leadGrade, conversation) {
  const calendlyLinkTrimmed = resolveCalendlyUrlForFlow(flow, professionalProfile, leadGrade);
  const calendlyLinkForVisitor =
    calendlyLinkTrimmed && conversation?._id
      ? withCalendlyConversationTracking(calendlyLinkTrimmed, conversation._id)
      : calendlyLinkTrimmed;
  return { calendlyLinkTrimmed, calendlyLinkForVisitor };
}

export function shouldDeferCalendlyLink(
  flow,
  isAutomatedBookingEnabled,
  calendlyLinkForVisitor,
  storedForm,
  history
) {
  const lastAssistantExtracted = getLastAssistantExtractedData(history);
  const formContact = storedForm || {};
  const extracted = lastAssistantExtracted || {};
  const lawyerHasReadinessSignals = (() => {
    if (flow.flowRole !== PROFESSIONAL_TYPE.LAWYER) return true;
    const transactionStage = String(
      formContact.transaction_stage || extracted.transaction_stage || ''
    ).trim();
    const closingTimeline = String(
      formContact.closing_timeline || extracted.closing_timeline || ''
    ).trim();
    const legalServicesNeeded = String(
      formContact.legal_services_needed || extracted.legal_services_needed || ''
    ).trim();
    return Boolean(transactionStage && closingTimeline && legalServicesNeeded);
  })();

  return (
    (flow.flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER || flow.flowRole === PROFESSIONAL_TYPE.LAWYER) &&
    isAutomatedBookingEnabled &&
    Boolean(calendlyLinkForVisitor) &&
    (!lawyerHasReadinessSignals ||
    !visitorHasPreferredContactPrefs({
      formContact: storedForm,
      lastAssistantExtracted,
    }))
  );
}

export async function buildFlowSystemPromptOptions({
  flow,
  professionalProfile,
  conversation,
  intent,
  leadGrade,
  deferCalendlyLink,
  isAutomatedBookingEnabled,
  calendlyLinkForVisitor,
}) {
  const calendlySnapForPrompt = await ChatConversation.findById(conversation._id)
    .select('calendly_booking_status lead_grade')
    .lean();
  const calendlyBookedForPrompt = calendlySnapForPrompt?.calendly_booking_status === 'booked';
  const checklistGradeForPrompt = flow.bestGrade(
    leadGrade,
    calendlySnapForPrompt?.lead_grade || conversation.lead_grade || 'unscored'
  );
  const checklistIntentForPrompt =
    conversation.intent === 'sell' || conversation.intent === 'buy' ? conversation.intent : intent;
  const postBookingChatChecklistForPrompt = calendlyBookedForPrompt
    ? getPostBookingChecklistForPrompt(flow, checklistGradeForPrompt, checklistIntentForPrompt)
    : [];

  const base = {
    isAutomatedBookingEnabled,
    calendlyLink: calendlyLinkForVisitor || undefined,
    leadGrade,
    intent: conversation.intent || intent,
    calendlyBooked: Boolean(postBookingChatChecklistForPrompt.length),
    postBookingChatChecklist: postBookingChatChecklistForPrompt,
  };

  if (flow.flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER || flow.flowRole === PROFESSIONAL_TYPE.LAWYER) {
    return { ...base, deferCalendlyLink };
  }
  return base;
}
