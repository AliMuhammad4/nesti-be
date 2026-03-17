/**
 * Mortgage broker role – Mortgage lead flow handler.
 */

import {
  scoreMortgageBrokerLead,
  mergeMortgageQualificationForScoring,
  deriveMortgageQualificationFromText,
  bestMortgageGrade,
  createMortgageLeadRecords,
  mergeSignals,
} from '../scoring/index.js';
import { buildMortgageBrokerSystemPrompt } from '../prompts/index.js';

export const mortgageBrokerFlow = {
  getFormQualification: (storedForm) => storedForm ? {
    mortgage_timeline:       storedForm.mortgage_timeline || null,
    pre_approval_status:    storedForm.pre_approval_status || null,
    credit_score_range:     storedForm.credit_score_range || null,
    employment_status:      storedForm.employment_status || null,
    household_income:       storedForm.household_income || null,
    down_payment_readiness:  storedForm.down_payment_readiness || null,
    property_budget:        storedForm.property_budget || null,
    purchase_purpose:       storedForm.purchase_purpose || null,
    urgency_signal:         storedForm.urgency_signal || null,
    budget:                 storedForm.budget || null,
  } : {},

  getFormSignals: (storedForm) => storedForm ? {
    timeline: storedForm.timeline || storedForm.mortgage_timeline || null,
    budget:   storedForm.budget   || storedForm.price || null,
    location: storedForm.location || storedForm.address || null,
    beds:     storedForm.beds  ? (parseInt(storedForm.beds, 10)  || null) : null,
    baths:    storedForm.baths ? (parseInt(storedForm.baths, 10) || null) : null,
    area:     null,
  } : {},

  scoreLead: scoreMortgageBrokerLead,

  mergeQualificationForScoring: mergeMortgageQualificationForScoring,

  deriveQualificationFromText: deriveMortgageQualificationFromText,

  buildSystemPrompt: buildMortgageBrokerSystemPrompt,

  bestGrade: bestMortgageGrade,

  createNewLead: async (params) => {
    const { conversation, professionalProfileId, leadScore, leadGrade, leadMeta, sessionId, embedToken, clientIp, userAgent, referer, contactInfo, userId, messageSnippet, formContact, aiDetails } = params;
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

  getIntentSuffix: () => 'buyer',

  enhanceWithAi: (formQualification, parsedAiDetails, formSignals) => {
    const aiEnhancedQualification = mergeMortgageQualificationForScoring(formQualification, parsedAiDetails);
    const aiExtractedSignals = {
      location: parsedAiDetails?.property_address || parsedAiDetails?.location || null,
      budget:   parsedAiDetails?.budget || parsedAiDetails?.property_budget || null,
      timeline: parsedAiDetails?.timeline || parsedAiDetails?.mortgage_timeline || null,
      beds:     parsedAiDetails?.bedrooms != null && parsedAiDetails?.bedrooms !== ''
        ? (parseInt(parsedAiDetails.bedrooms, 10) || null) : null,
      baths:    parsedAiDetails?.bathrooms != null && parsedAiDetails?.bathrooms !== ''
        ? (parseInt(parsedAiDetails.bathrooms, 10) || null) : null,
      area:     parsedAiDetails?.area != null && String(parsedAiDetails.area).trim() !== ''
        ? String(parsedAiDetails.area).trim() : null,
    };
    const aiEnhancedSignals = mergeSignals(formSignals, aiExtractedSignals);
    return { aiEnhancedQualification, aiEnhancedSignals };
  },

  mergeSignalsForMeta: (leadMetaSignals, parsedAiDetails) => {
    const ai = parsedAiDetails || {};
    const base = leadMetaSignals || {};
    const loc = ai.property_address || ai.location || null;
    const beds = ai.bedrooms != null && ai.bedrooms !== '' ? (parseInt(ai.bedrooms, 10) || null) : null;
    const baths = ai.bathrooms != null && ai.bathrooms !== '' ? (parseInt(ai.bathrooms, 10) || null) : null;
    const areaVal = ai.area != null && String(ai.area).trim() !== '' ? String(ai.area).trim() : null;
    return {
      location: loc || base.location || null,
      budget:   ai.budget || ai.property_budget || base.budget || null,
      timeline: ai.timeline || ai.mortgage_timeline || base.timeline || null,
      beds:     beds ?? base.beds ?? null,
      baths:    baths ?? base.baths ?? null,
      area:     areaVal || base.area || null,
    };
  },

  getPersistedGrade: (finalGrade) => finalGrade,

  getLeadClassification: (finalGrade) => `${finalGrade.charAt(0).toUpperCase() + finalGrade.slice(1)} Mortgage Lead`,

  getMergedAiDetails: (parsedAiDetails, derivedQual) => ({
    ...parsedAiDetails,
    mortgage_timeline:      parsedAiDetails?.mortgage_timeline      || derivedQual.mortgage_timeline || '',
    pre_approval_status:   parsedAiDetails?.pre_approval_status   || derivedQual.pre_approval_status || '',
    credit_score_range:    parsedAiDetails?.credit_score_range     || derivedQual.credit_score_range || '',
    employment_status:     parsedAiDetails?.employment_status      || derivedQual.employment_status || '',
    household_income:      parsedAiDetails?.household_income        || derivedQual.household_income || '',
    down_payment_readiness: parsedAiDetails?.down_payment_readiness || derivedQual.down_payment_readiness || '',
    purchase_purpose:      parsedAiDetails?.purchase_purpose        || derivedQual.purchase_purpose || '',
    urgency_signal:        parsedAiDetails?.urgency_signal          || derivedQual.urgency_signal || '',
  }),

  getLeadProfileUpdate: (parsedAiDetails, derivedQual, formContact) => ({
    mortgage_timeline:      parsedAiDetails?.mortgage_timeline      || derivedQual.mortgage_timeline || formContact?.mortgage_timeline,
    pre_approval_status:   parsedAiDetails?.pre_approval_status   || derivedQual.pre_approval_status || formContact?.pre_approval_status,
    credit_score_range:    parsedAiDetails?.credit_score_range     || derivedQual.credit_score_range || formContact?.credit_score_range,
    employment_status:     parsedAiDetails?.employment_status      || derivedQual.employment_status || formContact?.employment_status,
    household_income:      parsedAiDetails?.household_income        || derivedQual.household_income || formContact?.household_income,
    down_payment_readiness: parsedAiDetails?.down_payment_readiness || derivedQual.down_payment_readiness || formContact?.down_payment_readiness,
    purchase_purpose:      parsedAiDetails?.purchase_purpose       || derivedQual.purchase_purpose || formContact?.purchase_purpose,
    urgency_signal:        parsedAiDetails?.urgency_signal          || derivedQual.urgency_signal || formContact?.urgency_signal,
  }),
};
