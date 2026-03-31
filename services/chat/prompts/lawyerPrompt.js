/**
 * Real estate lawyer — tiered appointment flow + qualification (mirrors mortgage broker orchestration).
 */

import { getLawyerActionFlow } from '../config/lawyerActionFlow.js';
import {
  buildLawyerAutomationBlock,
  buildLawyerPostBookingBlock,
  buildLawyerPromptMainTemplate,
} from './lawyerPromptBlocks.js';

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
  const hasBookingLink = isAutomatedBookingEnabled && calendlyLink;
  const effectiveHasBookingLink = Boolean(hasBookingLink && !deferCalendlyLink);

  const actionFlow = getLawyerActionFlow(leadGrade);
  const automationBlock = buildLawyerAutomationBlock({
    actionFlow,
    hasBookingLink: effectiveHasBookingLink,
    calendlyLink: deferCalendlyLink ? undefined : calendlyLink,
    name,
  });
  const postBookedBlock = buildLawyerPostBookingBlock({
    name,
    calendlyBooked,
    postBookingChatChecklist,
  });

  return buildLawyerPromptMainTemplate({
    name,
    location,
    hasBookingLink: effectiveHasBookingLink,
    deferCalendlyLink,
    automationBlock,
    postBookedBlock,
  }).trim();
};
