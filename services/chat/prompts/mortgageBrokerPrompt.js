import { getMortgageBrokerActionFlow } from '../config/mortgageBrokerActionFlow.js';
import {
  buildMortgageBrokerAutomationBlock,
  buildMortgageBrokerPostBookingBlock,
  buildMortgageBrokerPromptMainTemplate,
  openBrokerFollowUps,
} from './mortgageBrokerPromptBlocks.js';
import { appendAssistantOverlay } from '../../professionalAssistant/professionalAssistantService.js';
import { profileVisitorFactsBlock } from '../utils/profileVisitorFacts.js';
import { isBrokerInvestorForm, marketCountryFromForm } from '../../professionalAssistant/brokerInvestorMarket.js';

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
  const scheduleActions = options.assistantSetting?.next_actions;
  const blockSchedule = Boolean(
    options.assistantSetting?.applied
    && Array.isArray(scheduleActions)
    && scheduleActions.length
    && !scheduleActions.includes('schedule'),
  );
  const hasBookingLink = !blockSchedule && isAutomatedBookingEnabled && calendlyLink;
  const holdForQuestions = Boolean(
    options.assistantSetting?.applied
    && options.previewConversation !== true
    && !blockSchedule
    && openBrokerFollowUps(options.assistantSetting, options.intakeFormContact, options.chatAnsweredQuestions).length,
  );
  const effectiveHasBookingLink = Boolean(hasBookingLink && !deferCalendlyLink && !holdForQuestions);
  const intake = options.intakeFormContact
    || (options.previewConversation === true ? options.previewSignals || {} : {});
  const actionFlow = getMortgageBrokerActionFlow(leadGrade, {
    clientType: isBrokerInvestorForm(intake) ? 'investor' : '',
    market: marketCountryFromForm(intake),
  });
  const automationBlock = buildMortgageBrokerAutomationBlock({
    actionFlow,
    hasBookingLink: effectiveHasBookingLink,
    calendlyLink: deferCalendlyLink ? undefined : calendlyLink,
    name,
    rewriteInVoice: Boolean(options.assistantSetting?.applied),
    holdForQuestions,
  });
  const postBookedBlock = buildMortgageBrokerPostBookingBlock({
    name,
    calendlyBooked,
    postBookingChatChecklist,
    firstPerson: Boolean(options.assistantSetting?.applied),
  });
  const prompt = appendAssistantOverlay(buildMortgageBrokerPromptMainTemplate({
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
    previewSignals: options.previewConversation === true ? options.previewSignals || null : null,
  }).trim(), options.assistantSetting, {
    preview: options.previewConversation === true,
    contactKnown: options.contactKnown,
    intakeFormContact: options.intakeFormContact,
    openingTurn: options.openingTurn,
    chatAnsweredQuestions: options.chatAnsweredQuestions,
  });
  return `${prompt}\n\n${profileVisitorFactsBlock(professionalProfile, options.assistantSetting, options.yearsExperience)}`;
};
