import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import {
  scoreMortgageBrokerLead,
  mergeMortgageQualificationForScoring,
  deriveMortgageQualificationFromText,
  bestMortgageGrade,
  createMortgageLeadRecords,
  mergeSignals,
} from '../scoring/index.js';
import { buildMortgageBrokerSystemPrompt } from '../prompts/index.js';
import {
  pickStoredFormQualification,
  pickStoredFormSignals,
  buildAiExtractedMortgageSignals,
  mergeMortgageLeadMetaSignals,
  mergeMortgageAiDetailsForMeta,
  buildMortgageLeadProfileUpdate,
} from './mortgageBrokerQualificationHelpers.js';

export const mortgageBrokerFlow = {
  flowRole: PROFESSIONAL_TYPE.MORTGAGE_BROKER,

  getFormQualification: (storedForm) => pickStoredFormQualification(storedForm),

  getFormSignals: (storedForm) => pickStoredFormSignals(storedForm),

  scoreLead: scoreMortgageBrokerLead,

  mergeQualificationForScoring: mergeMortgageQualificationForScoring,

  deriveQualificationFromText: deriveMortgageQualificationFromText,

  buildSystemPrompt: buildMortgageBrokerSystemPrompt,

  bestGrade: bestMortgageGrade,

  createNewLead: async (params) => {
    const {
      conversation,
      professionalProfileId,
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
    return createMortgageLeadRecords({
      conversation,
      professionalProfileId,
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
  },

  /** Matches LeadMatch.lead_type `*_client` (mortgage client — not agent `*_buyer`). */
  getIntentSuffix: () => 'client',

  enhanceWithAi: (formQualification, parsedAiDetails, formSignals) => {
    const aiEnhancedQualification = mergeMortgageQualificationForScoring(
      formQualification,
      parsedAiDetails
    );
    const aiExtractedSignals = buildAiExtractedMortgageSignals(parsedAiDetails);
    const aiEnhancedSignals = mergeSignals(formSignals, aiExtractedSignals);
    return { aiEnhancedQualification, aiEnhancedSignals };
  },

  mergeSignalsForMeta: (leadMetaSignals, parsedAiDetails) =>
    mergeMortgageLeadMetaSignals(leadMetaSignals, parsedAiDetails),

  getPersistedGrade: (finalGrade) => finalGrade,

  getLeadClassification: (finalGrade) =>
    `${finalGrade.charAt(0).toUpperCase() + finalGrade.slice(1)} Mortgage Lead`,

  getMergedAiDetails: (parsedAiDetails, derivedQual) =>
    mergeMortgageAiDetailsForMeta(parsedAiDetails, derivedQual),

  getLeadProfileUpdate: (parsedAiDetails, derivedQual, formContact) =>
    buildMortgageLeadProfileUpdate(parsedAiDetails, derivedQual, formContact),
};
