import { getAgentActionFlow } from '../config/agentActionFlow.js';
import { getMortgageBrokerActionFlow } from '../config/mortgageBrokerActionFlow.js';
import { getLawyerActionFlow } from '../config/lawyerActionFlow.js';
import {
  hasMortgageCalendlyConfigured,
  resolveMortgageCalendlyUrl,
} from '../mortgageBroker/mortgageCalendlyUtils.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';

const isAgent = (flow) => flow?.flowRole === PROFESSIONAL_TYPE.AGENT;
const isBroker = (flow) => flow?.flowRole === PROFESSIONAL_TYPE.MORTGAGE_BROKER;

export function supportsPropertyMatches(flow) {
  return isAgent(flow);
}

export const usesMortgageAffordabilitySnapshot = isBroker;

/** Kept for callers; mortgage Calendly is a single `calendly_link`, not per lead tier. */
export const usesTieredMortgageCalendly = false;

export function leadClassificationUsesIntent(flow) {
  return isAgent(flow);
}

export function usesFixedBuyIntentForLeadMatch(flow) {
  return isBroker(flow) || flow?.flowRole === PROFESSIONAL_TYPE.LAWYER;
}

export function resolveCalendlyUrlForFlow(flow, professionalProfile) {
  if (isBroker(flow)) {
    return resolveMortgageCalendlyUrl(professionalProfile);
  }
  return (professionalProfile?.calendly_link || '').trim();
}

export function isAutomatedBookingEnabledForFlow(flow, professionalProfile, conversation) {
  const hasCalendly = isBroker(flow)
    ? hasMortgageCalendlyConfigured(professionalProfile)
    : Boolean((professionalProfile?.calendly_link || '').trim());
  return hasCalendly && conversation.is_automated_booking_enabled !== false;
}

function postBookingChecklistItemsForFlow(flow, leadGrade, aiIntent) {
  const role = flow?.flowRole;
  if (role === PROFESSIONAL_TYPE.AGENT) {
    return getAgentActionFlow(leadGrade, aiIntent).postBookingChatChecklist || [];
  }
  if (role === PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return getMortgageBrokerActionFlow(leadGrade).postBookingChatChecklist || [];
  }
  if (role === PROFESSIONAL_TYPE.LAWYER) {
    return getLawyerActionFlow(leadGrade).postBookingChatChecklist || [];
  }
  return null;
}

export function getPostBookingChecklistForPrompt(flow, leadGrade, aiIntent) {
  return postBookingChecklistItemsForFlow(flow, leadGrade, aiIntent) ?? [];
}

export function getPostBookingChecklistForMeta(flow, leadGrade, aiIntent) {
  return postBookingChecklistItemsForFlow(flow, leadGrade, aiIntent);
}

export function classifyLeadForFlow(flow, finalGrade, aiIntent) {
  if (leadClassificationUsesIntent(flow)) {
    return flow.getLeadClassification(finalGrade, aiIntent);
  }
  return flow.getLeadClassification(finalGrade);
}

// Mortgage broker + lawyer flow wiring (shared implementations)

export const clientIntentSuffix = () => 'client';

export const identityPersistedGrade = (finalGrade) => finalGrade;

export function tieredProfessionalLabel(finalGrade, suffixPhrase) {
  const g = String(finalGrade || '');
  const head = g ? g.charAt(0).toUpperCase() + g.slice(1) : '';
  return `${head} ${suffixPhrase}`;
}

export async function dispatchClientLead(createRecordsFn, params) {
  const {
    conversation,
    professionalProfileId,
    activeIcpProfileId,
    leadScore,
    leadGrade,
    leadMeta,
    sessionId,
    embedToken,
    clientIp,
    userAgent,
    referer,
    contactInfo,
    userId,
    messageSnippet,
    formContact,
    aiDetails,
  } = params;
  return createRecordsFn({
    conversation,
    professionalProfileId,
    activeIcpProfileId,
    leadScore,
    leadGrade,
    leadMeta,
    sessionId,
    embedToken,
    clientIp,
    userAgent,
    referer,
    contactInfo,
    userId,
    messageSnippet,
    formContact,
    aiDetails,
  });
}
