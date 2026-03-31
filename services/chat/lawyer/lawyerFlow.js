import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import {
  scoreLawyerLead,
  mergeLawyerQualificationForScoring,
  deriveLawyerQualificationFromText,
  bestLawyerGrade,
  createLawyerLeadRecords,
} from '../scoring/index.js';
import { buildLawyerSystemPrompt } from '../prompts/index.js';
import {
  clientIntentSuffix,
  identityPersistedGrade,
  tieredProfessionalLabel,
  dispatchClientLead,
} from '../flows/flowRoleMeta.js';
import {
  pickLawyerFormQualification,
  pickLawyerFormSignals,
  lawyerEnhanceWithAi,
  lawyerMergeSignalsForMeta,
  mergeLawyerAiDetailsForMeta,
  buildLawyerLeadProfileUpdate,
} from './lawyerQualificationHelpers.js';

export const lawyerFlow = {
  flowRole: PROFESSIONAL_TYPE.LAWYER,
  getFormQualification: pickLawyerFormQualification,
  getFormSignals: pickLawyerFormSignals,
  scoreLead: scoreLawyerLead,
  mergeQualificationForScoring: mergeLawyerQualificationForScoring,
  deriveQualificationFromText: deriveLawyerQualificationFromText,
  buildSystemPrompt: buildLawyerSystemPrompt,
  bestGrade: bestLawyerGrade,
  createNewLead: (params) => dispatchClientLead(createLawyerLeadRecords, params),
  getIntentSuffix: clientIntentSuffix,
  enhanceWithAi: lawyerEnhanceWithAi,
  mergeSignalsForMeta: lawyerMergeSignalsForMeta,
  getPersistedGrade: identityPersistedGrade,
  getLeadClassification: (finalGrade) => tieredProfessionalLabel(finalGrade, 'Lawyer Client'),
  getMergedAiDetails: mergeLawyerAiDetailsForMeta,
  getLeadProfileUpdate: buildLawyerLeadProfileUpdate,
};
