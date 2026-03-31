import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import {
  mergeSignals,
  normalizeTimeline,
  scoreLead,
  mergeQualificationForScoring,
  deriveQualificationFromText,
  buildLeadClassification as buildLeadClass,
  bestGrade,
  createLeadRecords,
} from '../scoring/index.js';
import { buildAgentSystemPrompt } from '../prompts/index.js';
import { partitionBuyerBudgetInputs } from '../../agent/propertyMatch/parsing.js';
import logger from '../../../utils/logger.js';

export const agentFlow = {
  flowRole: PROFESSIONAL_TYPE.AGENT,

  getFormQualification: (storedForm) => storedForm ? {
    mortgage_status:    storedForm.mortgage_status || null,
    realtor_status:     storedForm.realtor_status || null,
    motivation_reason:  storedForm.motivation_reason || null,
    viewing_readiness:  storedForm.viewing_readiness || null,
    living_situation:   storedForm.living_situation || null,
    urgency_readiness:  storedForm.urgency_readiness || null,
  } : {},

  getFormSignals: (storedForm) => {
    if (!storedForm) return {};
    const { budgetStr, financingStr } = partitionBuyerBudgetInputs(
      storedForm.budget,
      storedForm.price
    );
    return {
      timeline: storedForm.timeline || null,
      budget:   budgetStr || null,
      financing_signal: financingStr || null,
      location: storedForm.location || null,
      beds:     storedForm.beds ? (parseInt(storedForm.beds, 10) || null) : null,
      baths:    storedForm.baths ? (parseInt(storedForm.baths, 10) || null) : null,
      area:     null,
    };
  },

  scoreLead,

  mergeQualificationForScoring,

  deriveQualificationFromText,

  buildSystemPrompt: buildAgentSystemPrompt,

  bestGrade,

  createNewLead: async (params) => {
    const { conversation, intent, professionalProfileId, leadScore, leadGrade, leadMeta, sessionId, embedToken, clientIp, userAgent, referer, contactInfo, userId, messageSnippet, formContact, aiDetails } = params;
    return createLeadRecords({
      conversation,
      intent,
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

  getIntentSuffix: (aiIntent) => aiIntent === 'sell' ? 'seller' : 'buyer',

  enhanceWithAi: (formQualification, parsedAiDetails, formSignals) => {
    const aiEnhancedQualification = mergeQualificationForScoring(formQualification, parsedAiDetails);
    const ai = parsedAiDetails || {};
    const { budgetStr, financingStr } = partitionBuyerBudgetInputs(ai.budget);
    const aiExtractedSignals = {
      location:          ai.property_address || null,
      budget:            budgetStr || null,
      financing_signal: financingStr || null,
      timeline:
        normalizeTimeline(ai.timeline) || formSignals.timeline || null,
    };
    const aiEnhancedSignals = mergeSignals(formSignals, aiExtractedSignals);
    return { aiEnhancedQualification, aiEnhancedSignals };
  },

  mergeSignalsForMeta: (leadMetaSignals, parsedAiDetails) => {
    const ai = parsedAiDetails || {};
    const bedsRaw = ai.bedrooms;
    const bedsFromAi =
      bedsRaw != null && String(bedsRaw).trim() !== ''
        ? parseInt(String(bedsRaw), 10)
        : null;

    const out = {
      location: ai.property_address || leadMetaSignals?.location || null,
      timeline: ai.timeline || leadMetaSignals?.timeline || null,
      beds:     Number.isFinite(bedsFromAi) ? bedsFromAi : leadMetaSignals?.beds ?? null,
    };

    if (Object.prototype.hasOwnProperty.call(ai, 'budget')) {
      const { budgetStr, financingStr } = partitionBuyerBudgetInputs(ai.budget);
      out.budget = budgetStr || null;
      out.financing_signal = financingStr || leadMetaSignals?.financing_signal || null;
    } else {
      out.budget = leadMetaSignals?.budget ?? null;
    }

    return out;
  },

  getPersistedGrade: (finalGrade) => finalGrade === 'lukewarm' ? 'warm' : finalGrade,

  getLeadClassification: (finalGrade, aiIntent) => buildLeadClass(finalGrade, aiIntent),

  getMergedAiDetails: (parsedAiDetails, derivedQual) => ({
    ...parsedAiDetails,
    realtor_status:     parsedAiDetails?.realtor_status     || derivedQual.realtor_status || '',
    motivation_reason:  parsedAiDetails?.motivation_reason  || derivedQual.motivation_reason || '',
    viewing_readiness:  parsedAiDetails?.viewing_readiness  || derivedQual.viewing_readiness || '',
    living_situation:   parsedAiDetails?.living_situation   || derivedQual.living_situation || '',
    urgency_readiness:  parsedAiDetails?.urgency_readiness  || derivedQual.urgency_readiness || '',
  }),

  getLeadProfileUpdate: (parsedAiDetails, derivedQual, formContact) => {
    const ai = parsedAiDetails || {};
    const fc = formContact || {};

    const hasAiBudget = Object.prototype.hasOwnProperty.call(ai, 'budget');
    const hasFcBudget = Object.prototype.hasOwnProperty.call(fc, 'budget');
    const { budgetStr, financingStr } = partitionBuyerBudgetInputs(
      hasAiBudget ? ai.budget : undefined,
      hasFcBudget ? fc.budget : undefined
    );
    const mergedMortgage = [ai.mortgage_status, fc.mortgage_status, financingStr].find(
      (x) => x != null && String(x).trim() !== ''
    );

    if ((hasAiBudget || hasFcBudget) && financingStr && !budgetStr) {
      logger.info('Agent LeadProfile update: financing text removed from budget field', {
        financingSnippet: String(financingStr).slice(0, 120),
      });
    }

    return {
      mortgage_status:    mergedMortgage,
      realtor_status:     ai.realtor_status     || derivedQual.realtor_status || fc.realtor_status,
      motivation_reason:  ai.motivation_reason  || derivedQual.motivation_reason || fc.motivation_reason,
      viewing_readiness:  ai.viewing_readiness  || derivedQual.viewing_readiness || fc.viewing_readiness,
      living_situation:   ai.living_situation   || derivedQual.living_situation || fc.living_situation,
      urgency_readiness:  ai.urgency_readiness  || derivedQual.urgency_readiness || fc.urgency_readiness,
      property_address:   ai.property_address   || fc.address,
      location:           ai.property_address   || fc.location,
      ...(hasAiBudget || hasFcBudget ? { budget: budgetStr } : {}),
      ...(hasAiBudget || hasFcBudget
        ? {}
        : {
            expected_price:
              partitionBuyerBudgetInputs(ai.budget, fc.price).budgetStr || fc.price || '',
          }),
      timeline:           ai.timeline           || fc.timeline,
      bedrooms:           ai.bedrooms           || fc.beds,
      bathrooms:          ai.bathrooms          || fc.baths,
      property_type:      ai.property_type      || fc.property_type,
      must_have_features: ai.must_have_features || fc.must_have_features,
      parking_required:   ai.parking_required   || fc.parking_required,
      backyard_needed:    ai.backyard_needed    || fc.backyard_needed,
      school_district_important: ai.school_district_important || fc.school_district_important,
      preferred_contact_method:  ai.preferred_contact_method  || fc.preferred_contact_method,
      best_time_to_contact:     ai.best_time_to_contact     || fc.best_time_to_contact,
    };
  },
};
