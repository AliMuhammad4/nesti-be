/**
 * Real estate lawyer — tiered appointment flow + qualification (mirrors mortgage broker orchestration).
 */

import { getLawyerActionFlow } from '../config/lawyerActionFlow.js';
import {
  buildLawyerAutomationBlock,
  buildLawyerPostBookingBlock,
  buildLawyerPromptMainTemplate,
  openLawyerFollowUps,
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
  const scheduleActions = options.assistantSetting?.next_actions;
  const blockSchedule = Boolean(
    options.assistantSetting?.applied
    && Array.isArray(scheduleActions)
    && scheduleActions.length
    && !scheduleActions.includes('schedule'),
  );
  const hasBookingLink = !blockSchedule && isAutomatedBookingEnabled && calendlyLink;
  const formProvided = options.intakeFormContact && typeof options.intakeFormContact === 'object';
  const holdForQuestions = Boolean(
    options.assistantSetting?.applied
    && options.previewConversation !== true
    && !blockSchedule
    && formProvided
    && openLawyerFollowUps(options.assistantSetting, options.intakeFormContact, options.chatAnsweredQuestions).length,
  );
  const effectiveHasBookingLink = Boolean(hasBookingLink && !deferCalendlyLink && !holdForQuestions);

  const actionFlow = getLawyerActionFlow(leadGrade);
  const automationBlock = buildLawyerAutomationBlock({
    actionFlow,
    hasBookingLink: effectiveHasBookingLink,
    calendlyLink: deferCalendlyLink ? undefined : calendlyLink,
    name,
    rewriteInVoice: Boolean(options.assistantSetting?.applied),
    holdForQuestions,
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
    intakeFormContact: options.intakeFormContact,
    blockSchedule,
    chatAnsweredQuestions: options.chatAnsweredQuestions,
  }).trim(), options.assistantSetting, {
    preview: options.previewConversation === true,
    intakeFormContact: options.intakeFormContact,
    openingTurn: options.openingTurn,
    chatAnsweredQuestions: options.chatAnsweredQuestions,
  });
  return `${prompt}\n\n${profileVisitorFactsBlock(professionalProfile, options.assistantSetting, options.yearsExperience)}`;
};
