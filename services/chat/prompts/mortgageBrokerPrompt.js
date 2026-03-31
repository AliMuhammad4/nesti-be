import { getMortgageBrokerActionFlow } from '../config/mortgageBrokerActionFlow.js';
import {
  buildMortgageBrokerAutomationBlock,
  buildMortgageBrokerPostBookingBlock,
  buildMortgageBrokerPromptMainTemplate,
} from './mortgageBrokerPromptBlocks.js';

export const buildMortgageBrokerSystemPrompt = (professionalProfile, options = {}) => {
  const name = professionalProfile?.full_name || 'a mortgage broker';
  const location = professionalProfile?.location || 'your area';
  const {
    isAutomatedBookingEnabled,
    calendlyLink,
    leadGrade,
    calendlyBooked = false,
    postBookingChatChecklist = [],
    deferCalendlyLink = false,
  } = options;
  const hasBookingLink = isAutomatedBookingEnabled && calendlyLink;
  const effectiveHasBookingLink = Boolean(hasBookingLink && !deferCalendlyLink);
  const actionFlow = getMortgageBrokerActionFlow(leadGrade);
  const automationBlock = buildMortgageBrokerAutomationBlock({
    actionFlow,
    hasBookingLink: effectiveHasBookingLink,
    calendlyLink: deferCalendlyLink ? undefined : calendlyLink,
    name,
  });
  const postBookedBlock = buildMortgageBrokerPostBookingBlock({
    name,
    calendlyBooked,
    postBookingChatChecklist,
  });
  return buildMortgageBrokerPromptMainTemplate({
    name,
    location,
    hasBookingLink: effectiveHasBookingLink,
    deferCalendlyLink,
    automationBlock,
    postBookedBlock,
  }).trim();
};
