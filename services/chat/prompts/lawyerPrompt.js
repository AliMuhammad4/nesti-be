/**
 * Real estate lawyer — tiered appointment flow + qualification (mirrors mortgage broker orchestration).
 */

import { getLawyerActionFlow } from '../config/lawyerActionFlow.js';
import {
  buildLawyerAutomationBlock,
  buildLawyerPostBookingBlock,
  buildLawyerPromptMainTemplate,
} from './lawyerPromptBlocks.js';
import { appendAssistantOverlay } from '../../professionalAssistant/professionalAssistantService.js';
import { profileVisitorFactsBlock } from '../utils/profileVisitorFacts.js';

export const buildLawyerSystemPrompt = (professionalProfile, options = {}) => {
  const name = professionalProfile?.full_name || 'a real estate lawyer';
  const location = professionalProfile?.location || 'your area';
  const {
    isAutomatedBookingEnabled,
    calendlyLink,
    leadGrade,
    calendlyBooked = false,
    postBookingChatChecklist = [],
    deferCalendlyLink = false,
  } = options;
  const blockSchedule = false;
  const hasBookingLink = !blockSchedule && isAutomatedBookingEnabled && calendlyLink;
  const effectiveHasBookingLink = Boolean(hasBookingLink && !deferCalendlyLink);

  const actionFlow = getLawyerActionFlow(leadGrade);
  const automationBlock = buildLawyerAutomationBlock({
    actionFlow,
    hasBookingLink: effectiveHasBookingLink,
    calendlyLink: deferCalendlyLink ? undefined : calendlyLink,
    name,
    rewriteInVoice: Boolean(options.assistantSetting?.applied),
  });
  const postBookedBlock = buildLawyerPostBookingBlock({
    name,
    calendlyBooked,
    postBookingChatChecklist,
    firstPerson: Boolean(options.assistantSetting?.applied),
  });

  const prompt = appendAssistantOverlay(buildLawyerPromptMainTemplate({
    name,
    location,
    hasBookingLink: effectiveHasBookingLink,
    deferCalendlyLink,
    automationBlock,
    postBookedBlock,
    assistantSetting: options.assistantSetting,
    previewConversation: options.previewConversation === true,
  }).trim(), options.assistantSetting, { preview: options.previewConversation === true });
  return `${prompt}\n\n${profileVisitorFactsBlock(professionalProfile, options.assistantSetting, options.yearsExperience)}`;
};
