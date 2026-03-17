/**
 * Agent role – Real estate lead flow handler.
 */

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

export const agentFlow = {
  getFormQualification: (storedForm) => storedForm ? {
    mortgage_status:    storedForm.mortgage_status || null,
    realtor_status:     storedForm.realtor_status || null,
    motivation_reason:  storedForm.motivation_reason || null,
    viewing_readiness:  storedForm.viewing_readiness || null,
    living_situation:   storedForm.living_situation || null,
    urgency_readiness:  storedForm.urgency_readiness || null,
  } : {},

  getFormSignals: (storedForm) => storedForm ? {
    timeline: storedForm.timeline || null,
    budget:   storedForm.budget   || storedForm.price || null,
    location: storedForm.location || null,
    beds:     storedForm.beds  ? (parseInt(storedForm.beds, 10)  || null) : null,
    baths:    storedForm.baths ? (parseInt(storedForm.baths, 10) || null) : null,
    area:     null,
  } : {},

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
    const aiExtractedSignals = {
      location: parsedAiDetails.property_address || null,
      budget:   parsedAiDetails.budget           || null,
      timeline: normalizeTimeline(parsedAiDetails.timeline) || formSignals.timeline || null,
    };
    const aiEnhancedSignals = mergeSignals(formSignals, aiExtractedSignals);
    return { aiEnhancedQualification, aiEnhancedSignals };
  },

  mergeSignalsForMeta: (leadMetaSignals, parsedAiDetails) => ({
    location: parsedAiDetails.property_address || null,
    budget:   parsedAiDetails.budget           || null,
    timeline: parsedAiDetails.timeline         || null,
  }),

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
    return {
      mortgage_status:    ai.mortgage_status    || fc.mortgage_status,
      realtor_status:     ai.realtor_status     || derivedQual.realtor_status || fc.realtor_status,
      motivation_reason:  ai.motivation_reason  || derivedQual.motivation_reason || fc.motivation_reason,
      viewing_readiness:  ai.viewing_readiness  || derivedQual.viewing_readiness || fc.viewing_readiness,
      living_situation:   ai.living_situation   || derivedQual.living_situation || fc.living_situation,
      urgency_readiness:  ai.urgency_readiness  || derivedQual.urgency_readiness || fc.urgency_readiness,
      property_address:   ai.property_address   || fc.address,
      location:           ai.property_address   || fc.location,
      budget:             ai.budget             || fc.budget,
      expected_price:     ai.budget             || fc.price,
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
