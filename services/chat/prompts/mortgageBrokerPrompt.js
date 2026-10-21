import { getMortgageBrokerActionFlow } from '../config/mortgageBrokerActionFlow.js';
import {
  buildMortgageBrokerAutomationBlock,
  buildMortgageBrokerPostBookingBlock,
  buildMortgageBrokerPromptMainTemplate,
} from './mortgageBrokerPromptBlocks.js';
import { appendAssistantOverlay } from '../../professionalAssistant/professionalAssistantService.js';
import { profileVisitorFactsBlock } from '../utils/profileVisitorFacts.js';

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
  const blockSchedule = options.assistantSetting?.applied && !(options.assistantSetting.next_actions || []).includes('schedule');
  const hasBookingLink = !blockSchedule && isAutomatedBookingEnabled && calendlyLink;
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
  const prompt = appendAssistantOverlay(buildMortgageBrokerPromptMainTemplate({
    name,
    location,
    hasBookingLink: effectiveHasBookingLink,
    deferCalendlyLink,
    automationBlock,
    postBookedBlock,
    assistantSetting: options.assistantSetting,
  }).trim(), options.assistantSetting);
  return `${prompt}\n\n${profileVisitorFactsBlock(professionalProfile, options.assistantSetting, options.yearsExperience)}`;
};
