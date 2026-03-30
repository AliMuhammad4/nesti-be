import { getAgentActionFlow } from '../config/agentActionFlow.js';
import { getMortgageBrokerActionFlow } from '../config/mortgageBrokerActionFlow.js';
import {
  hasMortgageCalendlyConfigured,
  resolveMortgageCalendlyUrl,
} from '../mortgageCalendlyUtils.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
export const FLOW_ROLE = PROFESSIONAL_TYPE;
export function supportsPropertyMatches(flow) {
  return flow?.flowRole === FLOW_ROLE.AGENT;
}
export function usesMortgageAffordabilitySnapshot(flow) {
  return flow?.flowRole === FLOW_ROLE.MORTGAGE_BROKER;
}
export function usesTieredMortgageCalendly(flow) {
  return flow?.flowRole === FLOW_ROLE.MORTGAGE_BROKER;
}
export function leadClassificationUsesIntent(flow) {
  return flow?.flowRole === FLOW_ROLE.AGENT;
}

export function usesFixedBuyIntentForLeadMatch(flow) {
  return flow?.flowRole === FLOW_ROLE.MORTGAGE_BROKER || flow?.flowRole === FLOW_ROLE.LAWYER;
}

export function resolveCalendlyUrlForFlow(flow, professionalProfile, leadGrade) {
  if (usesTieredMortgageCalendly(flow)) {
    return resolveMortgageCalendlyUrl(professionalProfile, leadGrade);
  }
  return (professionalProfile?.calendly_link || '').trim();
}
export function isAutomatedBookingEnabledForFlow(flow, professionalProfile, conversation) {
  const hasCalendly =
    usesTieredMortgageCalendly(flow)
      ? hasMortgageCalendlyConfigured(professionalProfile)
      : Boolean((professionalProfile?.calendly_link || '').trim());
  return hasCalendly && conversation.is_automated_booking_enabled !== false;
}

export function getPostBookingChecklistForPrompt(flow, leadGrade, aiIntent) {
  if (flow?.flowRole === FLOW_ROLE.AGENT) {
    return getAgentActionFlow(leadGrade, aiIntent).postBookingChatChecklist || [];
  }
  if (flow?.flowRole === FLOW_ROLE.MORTGAGE_BROKER) {
    return getMortgageBrokerActionFlow(leadGrade).postBookingChatChecklist || [];
  }
  return [];
}

export function getPostBookingChecklistForMeta(flow, leadGrade, aiIntent) {
  if (flow?.flowRole === FLOW_ROLE.LAWYER) return null;
  if (flow?.flowRole === FLOW_ROLE.AGENT) {
    return getAgentActionFlow(leadGrade, aiIntent).postBookingChatChecklist || [];
  }
  if (flow?.flowRole === FLOW_ROLE.MORTGAGE_BROKER) {
    return getMortgageBrokerActionFlow(leadGrade).postBookingChatChecklist || [];
  }
  return null;
}

export function classifyLeadForFlow(flow, finalGrade, aiIntent) {
  if (leadClassificationUsesIntent(flow)) {
    return flow.getLeadClassification(finalGrade, aiIntent);
  }
  return flow.getLeadClassification(finalGrade);
}
