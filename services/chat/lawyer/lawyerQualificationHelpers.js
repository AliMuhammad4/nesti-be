import { mergeLawyerQualificationForScoring } from '../scoring/index.js';
import { mergeSignals } from '../scoring/index.js';
export function pickLawyerFormQualification(storedForm) {
  if (!storedForm) return {};
  return {
    transaction_stage: storedForm.transaction_stage || null,
    closing_timeline: storedForm.closing_timeline || null,
    transaction_type: storedForm.transaction_type || null,
    property_value: storedForm.property_value || null,
    mortgage_status: storedForm.mortgage_status || null,
    realtor_involved: storedForm.realtor_involved || null,
    first_time_buyer: storedForm.first_time_buyer || null,
    legal_services_needed: storedForm.legal_services_needed || null,
    preferred_contact_method: storedForm.preferred_contact_method || null,
    best_time_to_contact: storedForm.best_time_to_contact || null,
  };
}
export function pickLawyerFormSignals(storedForm) {
  if (!storedForm) return {};
  return {
    timeline: storedForm.closing_timeline || storedForm.timeline || null,
    budget: storedForm.budget || storedForm.property_value || null,
    location: storedForm.location || storedForm.address || null,
    beds: null,
    baths: null,
    area: null,
  };
}
export function lawyerEnhanceWithAi(formQualification, parsedAiDetails, formSignals) {
  const aiEnhancedQualification = mergeLawyerQualificationForScoring(formQualification, parsedAiDetails);
  const aiExtractedSignals = {
    timeline: parsedAiDetails?.closing_timeline || null,
    budget: parsedAiDetails?.budget || parsedAiDetails?.property_value || null,
    location: parsedAiDetails?.location || parsedAiDetails?.property_address || null,
  };
  const aiEnhancedSignals = mergeSignals(formSignals, aiExtractedSignals);
  return { aiEnhancedQualification, aiEnhancedSignals };
}

export function lawyerMergeSignalsForMeta(leadMetaSignals, parsedAiDetails) {
  const ai = parsedAiDetails || {};
  const base = leadMetaSignals || {};
  return {
    timeline: ai.closing_timeline || base.timeline || null,
    budget: ai.budget || ai.property_value || base.budget || null,
    location: ai.location || ai.property_address || base.location || null,
    beds: base.beds ?? null,
    baths: base.baths ?? null,
    area: base.area || null,
  };
}

export function mergeLawyerAiDetailsForMeta(parsedAiDetails, derivedQual) {
  return {
    ...parsedAiDetails,
    transaction_stage: parsedAiDetails?.transaction_stage || derivedQual.transaction_stage || '',
    closing_timeline: parsedAiDetails?.closing_timeline || derivedQual.closing_timeline || '',
    transaction_type: parsedAiDetails?.transaction_type || derivedQual.transaction_type || '',
    property_value: parsedAiDetails?.property_value || derivedQual.property_value || '',
    mortgage_status: parsedAiDetails?.mortgage_status || derivedQual.mortgage_status || '',
    realtor_involved: parsedAiDetails?.realtor_involved || derivedQual.realtor_involved || '',
    first_time_buyer: parsedAiDetails?.first_time_buyer || derivedQual.first_time_buyer || '',
    legal_services_needed: parsedAiDetails?.legal_services_needed || derivedQual.legal_services_needed || '',
    preferred_contact_method:
      parsedAiDetails?.preferred_contact_method || derivedQual.preferred_contact_method || '',
    best_time_to_contact: parsedAiDetails?.best_time_to_contact || derivedQual.best_time_to_contact || '',
  };
}

export function buildLawyerLeadProfileUpdate(parsedAiDetails, derivedQual, formContact) {
  return {
    transaction_stage:
      parsedAiDetails?.transaction_stage || derivedQual.transaction_stage || formContact?.transaction_stage,
    closing_timeline:
      parsedAiDetails?.closing_timeline || derivedQual.closing_timeline || formContact?.closing_timeline,
    transaction_type:
      parsedAiDetails?.transaction_type || derivedQual.transaction_type || formContact?.transaction_type,
    property_value:
      parsedAiDetails?.property_value || derivedQual.property_value || formContact?.property_value,
    mortgage_status:
      parsedAiDetails?.mortgage_status || derivedQual.mortgage_status || formContact?.mortgage_status,
    realtor_involved:
      parsedAiDetails?.realtor_involved || derivedQual.realtor_involved || formContact?.realtor_involved,
    first_time_buyer:
      parsedAiDetails?.first_time_buyer || derivedQual.first_time_buyer || formContact?.first_time_buyer,
    legal_services_needed:
      parsedAiDetails?.legal_services_needed ||
      derivedQual.legal_services_needed ||
      formContact?.legal_services_needed,
    preferred_contact_method:
      parsedAiDetails?.preferred_contact_method ||
      derivedQual.preferred_contact_method ||
      formContact?.preferred_contact_method,
    best_time_to_contact:
      parsedAiDetails?.best_time_to_contact ||
      derivedQual.best_time_to_contact ||
      formContact?.best_time_to_contact,
    property_address: parsedAiDetails?.property_address || formContact?.address,
    location:
      parsedAiDetails?.location ||
      parsedAiDetails?.property_address ||
      formContact?.location,
    budget:
      parsedAiDetails?.budget || parsedAiDetails?.property_value || formContact?.budget,
  };
}
