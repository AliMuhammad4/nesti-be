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
  clientIntentSuffix,
  identityPersistedGrade,
  tieredProfessionalLabel,
  dispatchClientLead,
} from '../flows/flowRoleMeta.js';
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
  createNewLead: (params) => dispatchClientLead(createMortgageLeadRecords, params),
  getIntentSuffix: clientIntentSuffix,
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
  getPersistedGrade: identityPersistedGrade,
  getLeadClassification: (finalGrade) => tieredProfessionalLabel(finalGrade, 'Mortgage Lead'),
  getMergedAiDetails: (parsedAiDetails, derivedQual) =>
    mergeMortgageAiDetailsForMeta(parsedAiDetails, derivedQual),
  getLeadProfileUpdate: (parsedAiDetails, derivedQual, formContact) =>
    buildMortgageLeadProfileUpdate(parsedAiDetails, derivedQual, formContact),
};
