import mongoose from 'mongoose';
import LeadProfile from '../../models/LeadProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import ClientProfile from '../../models/ClientProfile.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import User from '../../models/User.js';
import { PROFESSIONAL_TYPE, USER_ROLE } from '../../constants/roles.js';
import {
  buildLeadType,
  buildLawyerLeadType,
  buildMortgageBrokerLeadType,
  extractSignals,
  normalizeGradeForLeadType,
} from '../chat/scoring/common.js';
import {
  buildInquiryAgentQualificationFromClientProfile,
  scoreLead as scoreAgentLead,
} from '../chat/scoring/agentScoring.js';
import {
  deriveLawyerQualificationFromText,
  scoreLawyerLead,
} from '../chat/scoring/lawyerScoring.js';
import {
  deriveMortgageQualificationFromText,
  scoreMortgageBrokerLead,
} from '../chat/scoring/mortgageBrokerScoring.js';
import { computeIcpFitForLead } from '../lead/icpScoringService.js';
import { emitNewLeadCreatedNotification } from '../realtime/leadCreatedNotify.js';
import { emitWorkspaceLeadEvent } from '../realtime/workspaceSocket.js';
import { buildWorkspaceLeadConversionPreview } from '../conversion/buildLeadConversionPack.js';
import { postThreadMessage } from '../proChat/messageService.js';
import logger from '../../utils/logger.js';

function clientDisplayName(user = {}) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.email || 'Client';
}

function toText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  const text = toText(value);
  return text ? [text] : [];
}

function normalizePropertyImages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((image) => {
      if (!image || typeof image !== 'object') return null;
      const url = toText(image.secure_url || image.url);
      if (!url) return null;
      return {
        url,
        secure_url: url,
        public_id: toText(image.public_id),
        width: image.width == null ? null : Number(image.width) || null,
        height: image.height == null ? null : Number(image.height) || null,
        format: toText(image.format),
        bytes: image.bytes == null ? null : Number(image.bytes) || null,
        original_filename: toText(image.original_filename),
        uploaded_at: image.uploaded_at || new Date(),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function mapBudgetToLawyerPropertyValue(rawBudget) {
  const budget = Number(rawBudget);
  if (!Number.isFinite(budget) || budget <= 0) return '';
  if (budget < 400_000) return 'under_400k';
  if (budget < 700_000) return '400k_700k';
  if (budget < 1_000_000) return '700k_1m';
  return '1m_plus';
}

function mapTimelineToLawyerClosing(rawTimeline) {
  const timeline = String(rawTimeline || '').toLowerCase();
  if (!timeline) return '';
  if (timeline.includes('asap') || timeline.includes('1-3') || timeline.includes('1 month')) return 'within_30_days';
  if (timeline.includes('3-6')) return '30_60_days';
  if (timeline.includes('6-12')) return '60_90_days';
  if (timeline.includes('browsing') || timeline.includes('exploring')) return 'unknown';
  return '';
}

function mapMortgageStatusForLawyer(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (!status) return '';
  if (status.includes('fully') || status.includes('approved')) return 'fully_approved';
  if (status.includes('conditional')) return 'conditional_approval';
  if (status.includes('apply') || status.includes('pending') || status.includes('not')) return 'still_applying';
  return '';
}

function mapRealtorInvolved(rawStatus) {
  const value = String(rawStatus || '').toLowerCase();
  if (!value) return '';
  if (value.includes('have') || value.includes('working') || value.includes('yes')) return 'yes';
  if (value.includes('no') || value.includes('not')) return 'no';
  return '';
}

function deriveFirstTimeBuyerFromProfile(clientProfile = {}) {
  const goals = [...toArray(clientProfile?.home_goals), toText(clientProfile?.home_goal)].filter(Boolean);
  const goalText = goals.join(' ').toLowerCase();
  return goalText.includes('first') ? 'yes' : '';
}

function mapTransactionTypeFromProfile(clientProfile = {}) {
  const goals = [...toArray(clientProfile?.home_goals), toText(clientProfile?.home_goal)].filter(Boolean);
  const goalText = goals.join(' ').toLowerCase();
  if (goalText.includes('refinanc')) return 'refinance';
  if (goalText.includes('sale') || goalText.includes('sell')) return 'home_sale';
  return 'home_purchase';
}

export function buildClientProfileSnapshot(clientProfile = {}) {
  return {
    preferred_location: clientProfile?.preferred_location || '',
    preferred_locations: Array.isArray(clientProfile?.preferred_locations) ? clientProfile.preferred_locations : [],
    purchase_timeline: clientProfile?.purchase_timeline || '',
    dream_home_price: clientProfile?.dream_home_price || null,
    mortgage_status: clientProfile?.mortgage_status || '',
    realtor_status: clientProfile?.realtor_status || '',
    offer_readiness: clientProfile?.offer_readiness || '',
    home_goals: Array.isArray(clientProfile?.home_goals) ? clientProfile.home_goals : [],
    home_goal: clientProfile?.home_goal || '',
    annual_income: clientProfile?.annual_income || null,
    employment_status: clientProfile?.employment_status || '',
    current_savings: clientProfile?.current_savings || null,
    monthly_savings: clientProfile?.monthly_savings || null,
    down_payment_goal: clientProfile?.down_payment_goal || null,
  };
}

export function normalizeLawyerInquiryBody(body = {}) {
  return {
    message: toText(body.message),
    transaction_type: toText(body.transaction_type),
    closing_timeline: toText(body.closing_timeline),
    legal_services_needed: toText(body.legal_services_needed),
    property_address: toText(body.property_address || body.location),
    property_value: toText(body.property_value),
  };
}

export function validateLawyerInquiryInput(payload = {}) {
  if (!payload.message) return 'Please enter your question.';
  if (!payload.transaction_type) return 'Transaction type is required.';
  if (!payload.closing_timeline) return 'Closing timeline is required.';
  if (!payload.legal_services_needed) return 'Legal service selection is required.';
  return '';
}

export function normalizeMortgageBrokerInquiryBody(body = {}) {
  return {
    message: toText(body.message),
    mortgage_timeline: toText(body.mortgage_timeline),
    pre_approval_status: toText(body.pre_approval_status),
    credit_score_range: toText(body.credit_score_range),
    employment_status: toText(body.employment_status),
    household_income: toText(body.household_income),
    down_payment_readiness: toText(body.down_payment_readiness),
    purchase_purpose: toText(body.purchase_purpose),
    property_budget: toText(body.property_budget),
    property_address: toText(body.property_address || body.location),
  };
}

export function validateMortgageBrokerInquiryInput(payload = {}) {
  if (!payload.message) return 'Please enter your question.';
  if (!payload.mortgage_timeline) return 'Mortgage timeline is required.';
  if (!payload.pre_approval_status) return 'Pre-approval status is required.';
  if (!payload.purchase_purpose) return 'Financing purpose is required.';
  return '';
}

export function normalizeAgentInquiryBody(body = {}) {
  const rawIntent = toText(body.intent).toLowerCase();
  const intent = rawIntent === 'sell' ? 'sell' : rawIntent === 'buy' ? 'buy' : '';
  const legacyGoal = toText(body.inquiry_goal || body.service_needed);
  const derivedGoal = intent === 'sell' ? 'selling_help' : intent === 'buy' ? 'buying_help' : legacyGoal;
  return {
    message: toText(body.message),
    intent,
    inquiry_goal: derivedGoal,
    timeline: toText(body.timeline || body.purchase_timeline),
    preferred_location: toText(body.preferred_location || body.location || body.property_address),
    budget: toText(body.budget || body.property_budget),
    property_address: toText(body.property_address || body.preferred_location || body.location),
    property_type: toText(body.property_type),
    bedrooms: toText(body.bedrooms || body.beds),
    bathrooms: toText(body.bathrooms || body.baths),
    expected_price: toText(body.expected_price || body.price || body.budget || body.property_budget),
    must_have_features: toText(body.must_have_features || body.property_features || body.features),
    parking_required: toText(body.parking_required),
    backyard_needed: toText(body.backyard_needed),
    school_district_important: toText(body.school_district_important),
    property_images: normalizePropertyImages(body.property_images),
  };
}

export function validateAgentInquiryInput(payload = {}) {
  if (!payload.message) return 'Please enter your question.';
  if (!payload.intent && !payload.inquiry_goal) return 'Intent is required.';
  const isSell = payload.intent === 'sell' || payload.inquiry_goal === 'selling_help' || payload.inquiry_goal === 'home_valuation';
  const isBuy = payload.intent === 'buy' || payload.inquiry_goal === 'buying_help' || payload.inquiry_goal === 'showings';
  if (isSell) {
    if (!payload.property_address) return 'Property address is required.';
    if (!payload.property_type) return 'Property type is required.';
    if (!payload.expected_price) return 'Expected price is required.';
    if (!payload.bedrooms || !payload.bathrooms) return 'Bedrooms and bathrooms are required.';
    if (!payload.must_have_features) return 'Key features are required.';
    if (!payload.property_images.length) return 'At least one property image is required.';
  }
  if (isBuy && !payload.preferred_location && !payload.property_address) {
    return 'Preferred location is required.';
  }
  if (isBuy) {
    if (!payload.budget) return 'Budget is required.';
    if (!payload.property_type) return 'Property type is required.';
    if (!payload.bedrooms || !payload.bathrooms) return 'Bedrooms and bathrooms are required.';
    if (!payload.must_have_features) return 'Must-have features are required.';
    if (!payload.parking_required || !payload.backyard_needed || !payload.school_district_important) {
      return 'Property preference selections are required.';
    }
  }
  return '';
}

function pickPreferredContactMethod(clientProfile = {}) {
  const preferred = toText(clientProfile?.preferred_contact_method).toLowerCase();
  if (preferred) return preferred;
  return 'email';
}

export function resolveLawyerQualification(input, clientProfile = {}) {
  const inferredFromMessage = deriveLawyerQualificationFromText(input.message || '');
  const transactionType =
    input.transaction_type ||
    inferredFromMessage.transaction_type ||
    mapTransactionTypeFromProfile(clientProfile);
  const closingTimeline =
    input.closing_timeline ||
    inferredFromMessage.closing_timeline ||
    mapTimelineToLawyerClosing(clientProfile?.purchase_timeline);
  const propertyValue =
    input.property_value ||
    inferredFromMessage.property_value ||
    mapBudgetToLawyerPropertyValue(clientProfile?.dream_home_price);

  return {
    transaction_stage: inferredFromMessage.transaction_stage || 'pre_approval_stage',
    closing_timeline: closingTimeline,
    transaction_type: transactionType,
    property_value: propertyValue,
    mortgage_status:
      inferredFromMessage.mortgage_status || mapMortgageStatusForLawyer(clientProfile?.mortgage_status),
    realtor_involved:
      inferredFromMessage.realtor_involved || mapRealtorInvolved(clientProfile?.realtor_status),
    first_time_buyer:
      inferredFromMessage.first_time_buyer || deriveFirstTimeBuyerFromProfile(clientProfile),
    legal_services_needed: input.legal_services_needed || inferredFromMessage.legal_services_needed || 'full_closing',
    preferred_contact_method: pickPreferredContactMethod(clientProfile),
    best_time_to_contact: toText(clientProfile?.best_time_to_contact) || 'anytime',
  };
}

function mapClientMortgageTimeline(rawTimeline) {
  const timeline = String(rawTimeline || '').toLowerCase();
  if (!timeline) return '';
  if (timeline.includes('asap') || timeline.includes('1-3') || timeline.includes('1 month')) return 'immediately';
  if (timeline.includes('3-6')) return '3_6_months';
  if (timeline.includes('6-12')) return '6_12_months';
  if (timeline.includes('browsing') || timeline.includes('exploring')) return 'just_researching';
  return '';
}

function mapClientPreApprovalStatus(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (!status) return '';
  if (status.includes('fully') || status.includes('approved')) return 'already_approved';
  if (status.includes('conditional') || status.includes('progress')) return 'in_progress';
  if (status.includes('apply') || status.includes('pending') || status.includes('not')) return 'need_now';
  return '';
}

function mapClientDownPaymentReadiness(clientProfile = {}) {
  const savings = Number(clientProfile?.current_savings || 0);
  const price = Number(clientProfile?.dream_home_price || 0);
  if (!Number.isFinite(savings) || !Number.isFinite(price) || savings <= 0 || price <= 0) return '';
  const ratio = savings / price;
  if (ratio >= 0.2) return '20_plus';
  if (ratio >= 0.1) return '10_19';
  if (ratio >= 0.05) return '5_9';
  return 'under_5';
}

function mapClientHouseholdIncome(clientProfile = {}) {
  const income = Number(clientProfile?.annual_income || 0);
  if (!Number.isFinite(income) || income <= 0) return '';
  if (income >= 200_000) return '200k_plus';
  if (income >= 150_000) return '150k_200k';
  if (income >= 100_000) return '100k_150k';
  if (income >= 70_000) return '70k_100k';
  return 'under_70k';
}

function mapClientPurchasePurpose(clientProfile = {}) {
  const text = [...toArray(clientProfile?.home_goals), toText(clientProfile?.home_goal)].join(' ').toLowerCase();
  if (text.includes('refinanc')) return 'refinance';
  if (text.includes('invest')) return 'investment';
  if (text.includes('vacation') || text.includes('second')) return 'vacation_home';
  return 'primary_residence';
}

export function resolveMortgageBrokerQualification(input, clientProfile = {}) {
  const inferred = deriveMortgageQualificationFromText(input.message || '');
  return {
    mortgage_timeline:
      input.mortgage_timeline || inferred.mortgage_timeline || mapClientMortgageTimeline(clientProfile?.purchase_timeline),
    pre_approval_status:
      input.pre_approval_status || inferred.pre_approval_status || mapClientPreApprovalStatus(clientProfile?.mortgage_status),
    credit_score_range: input.credit_score_range || inferred.credit_score_range || '',
    employment_status: input.employment_status || inferred.employment_status || toText(clientProfile?.employment_status),
    household_income: input.household_income || inferred.household_income || mapClientHouseholdIncome(clientProfile),
    down_payment_readiness:
      input.down_payment_readiness || inferred.down_payment_readiness || mapClientDownPaymentReadiness(clientProfile),
    property_budget: input.property_budget || inferred.property_budget || (clientProfile?.dream_home_price ? 'clearly_defined' : ''),
    purchase_purpose: input.purchase_purpose || inferred.purchase_purpose || mapClientPurchasePurpose(clientProfile),
    urgency_signal: inferred.urgency_signal || '',
    preferred_contact_method: pickPreferredContactMethod(clientProfile),
    best_time_to_contact: toText(clientProfile?.best_time_to_contact) || 'anytime',
  };
}

function resolveAgentQualification(input, clientProfile = {}) {
  const fromProfile = buildInquiryAgentQualificationFromClientProfile(clientProfile);
  return {
    ...fromProfile,
    intent: input.intent || '',
    inquiry_goal: input.inquiry_goal || '',
    timeline: input.timeline || clientProfile?.purchase_timeline || '',
    buy_property_location: input.preferred_location || input.property_address || fromProfile.buy_property_location || '',
    budget: input.budget || input.expected_price || (clientProfile?.dream_home_price ? String(clientProfile.dream_home_price) : ''),
    property_address: input.property_address || input.preferred_location || '',
    property_type: input.property_type || '',
    bedrooms: input.bedrooms || '',
    bathrooms: input.bathrooms || '',
    expected_price: input.expected_price || input.budget || '',
    must_have_features: input.must_have_features || input.message || '',
    parking_required: input.parking_required || '',
    backyard_needed: input.backyard_needed || '',
    school_district_important: input.school_district_important || '',
    property_images: input.property_images || [],
    preferred_contact_method: pickPreferredContactMethod(clientProfile),
    best_time_to_contact: toText(clientProfile?.best_time_to_contact) || 'anytime',
  };
}

function buildLawyerInquiryNotificationDetails({
  clientName,
  normalizedInput,
  qualification,
  clientProfileSnapshot,
}) {
  return {
    type: 'lawyer_inquiry',
    client_name: clientName,
    inquiry_message: normalizedInput.message,
    transaction_type: qualification.transaction_type || '',
    closing_timeline: qualification.closing_timeline || '',
    legal_services_needed: qualification.legal_services_needed || '',
    property_address: normalizedInput.property_address || '',
    property_value: qualification.property_value || '',
    mortgage_status: qualification.mortgage_status || '',
    realtor_involved: qualification.realtor_involved || '',
    first_time_buyer: qualification.first_time_buyer || '',
    preferred_contact_method: qualification.preferred_contact_method || '',
    best_time_to_contact: qualification.best_time_to_contact || '',
    client_profile: clientProfileSnapshot || {},
  };
}

function brokerInquiryTitle(qualification = {}) {
  if (qualification.purchase_purpose === 'primary_residence') return 'Primary residence';
  if (qualification.purchase_purpose === 'investment') return 'Investment property';
  if (qualification.purchase_purpose === 'refinance') return 'Refinance';
  if (qualification.purchase_purpose === 'vacation_home') return 'Vacation / second home';
  if (qualification.pre_approval_status === 'need_now') return 'Pre-approval guidance';
  return 'Mortgage inquiry';
}

function buildMortgageBrokerInquiryNotificationDetails({
  clientName,
  normalizedInput,
  qualification,
  clientProfileSnapshot,
}) {
  return {
    type: 'mortgage_broker_inquiry',
    client_name: clientName,
    inquiry_message: normalizedInput.message,
    mortgage_timeline: qualification.mortgage_timeline || '',
    pre_approval_status: qualification.pre_approval_status || '',
    credit_score_range: qualification.credit_score_range || '',
    employment_status: qualification.employment_status || '',
    household_income: qualification.household_income || '',
    down_payment_readiness: qualification.down_payment_readiness || '',
    purchase_purpose: qualification.purchase_purpose || '',
    property_budget: qualification.property_budget || '',
    property_address: normalizedInput.property_address || '',
    preferred_contact_method: qualification.preferred_contact_method || '',
    best_time_to_contact: qualification.best_time_to_contact || '',
    client_profile: clientProfileSnapshot || {},
  };
}

function agentInquiryTitle(qualification = {}) {
  if (qualification.intent === 'buy') return 'Buying help';
  if (qualification.intent === 'sell') return 'Selling help';
  if (qualification.inquiry_goal === 'buying_help') return 'Buying help';
  if (qualification.inquiry_goal === 'selling_help') return 'Selling help';
  if (qualification.inquiry_goal === 'home_valuation') return 'Home valuation';
  if (qualification.inquiry_goal === 'showings') return 'Showings / tours';
  if (qualification.inquiry_goal === 'market_advice') return 'Market advice';
  return 'Agent inquiry';
}

function buildAgentInquiryNotificationDetails({
  clientName,
  normalizedInput,
  qualification,
  clientProfileSnapshot,
}) {
  return {
    type: 'agent_inquiry',
    client_name: clientName,
    inquiry_message: normalizedInput.message,
    intent: qualification.intent || '',
    timeline: qualification.timeline || '',
    preferred_location: qualification.buy_property_location || '',
    budget: qualification.budget || '',
    property_address: qualification.property_address || '',
    property_type: qualification.property_type || '',
    bedrooms: qualification.bedrooms || '',
    bathrooms: qualification.bathrooms || '',
    expected_price: qualification.expected_price || '',
    must_have_features: qualification.must_have_features || '',
    parking_required: qualification.parking_required || '',
    backyard_needed: qualification.backyard_needed || '',
    school_district_important: qualification.school_district_important || '',
    property_images: qualification.property_images || [],
    mortgage_status: qualification.mortgage_status || '',
    realtor_status: qualification.realtor_status || '',
    preferred_contact_method: qualification.preferred_contact_method || '',
    best_time_to_contact: qualification.best_time_to_contact || '',
    client_profile: clientProfileSnapshot || {},
  };
}

async function createLeadScopedProfessionalInquiryThread({
  clientUserId,
  professionalUserId,
  leadMatchId,
  message,
  title = 'Professional inquiry',
  clientIdPrefix = 'professional-inquiry',
}) {
  const clientId = String(clientUserId || '').trim();
  const professionalId = String(professionalUserId || '').trim();
  const leadId = String(leadMatchId || '').trim();
  if (!clientId || !professionalId || !leadId) return null;

  let thread = null;
  try {
    thread = await ProfessionalChatThread.create({
      thread_type: 'group',
      title,
      participants: [professionalId, clientId],
      participants_key: `lead:${leadId}:${String(new mongoose.Types.ObjectId())}`,
      created_by: professionalId,
    });
  } catch (error) {
    logger.warn('client professional inquiry thread create failed', {
      lead_match_id: leadId,
      client_user_id: clientId,
      professional_user_id: professionalId,
      message: error?.message,
    });
    return null;
  }

  const threadId = String(thread._id);
  const text = String(message || '').trim();
  if (text) {
    try {
      await postThreadMessage({
        currentUserId: clientId,
        threadId,
        body: text,
        attachments: [],
        clientId: `${clientIdPrefix}:${leadId}`,
      });
    } catch (error) {
      logger.warn('client professional inquiry initial message failed', {
        lead_match_id: leadId,
        thread_id: threadId,
        client_user_id: clientId,
        professional_user_id: professionalId,
        message: error?.message,
      });
    }
  }

  return threadId;
}

export async function submitClientAgentInquiry({
  clientUserId,
  professionalUserId,
  body = {},
}) {
  const clientUser = await User.findById(clientUserId).select('first_name last_name email role phone').lean();
  if (!clientUser || String(clientUser.role || '').toLowerCase() !== USER_ROLE.CLIENT) {
    return { status: 403, body: { success: false, message: 'Only clients can submit agent inquiries' } };
  }

  if (!professionalUserId || String(professionalUserId) === String(clientUserId)) {
    return { status: 400, body: { success: false, message: 'Invalid agent profile' } };
  }

  const [professionalUser, professionalProfile, clientProfile] = await Promise.all([
    User.findById(professionalUserId).select('first_name last_name email role').lean(),
    ProfessionalProfile.findOne({ user_id: professionalUserId })
      .select('_id professional_type active_icp_profile_id location')
      .lean(),
    ClientProfile.findOne({ user_id: clientUserId }).lean(),
  ]);

  const professionalType = professionalProfile?.professional_type || professionalUser?.role || '';
  if (!professionalUser || String(professionalType).toLowerCase() !== PROFESSIONAL_TYPE.AGENT) {
    return { status: 400, body: { success: false, message: 'Inquiry is only supported for agents' } };
  }

  const normalizedInput = normalizeAgentInquiryBody(body);
  const validationError = validateAgentInquiryInput(normalizedInput);
  if (validationError) {
    return { status: 400, body: { success: false, message: validationError } };
  }

  const clientName = clientDisplayName(clientUser);
  const clientProfileSnapshot = buildClientProfileSnapshot(clientProfile || {});
  const qualification = resolveAgentQualification(normalizedInput, clientProfile || {});
  const isSellerInquiry =
    qualification.intent === 'sell' || qualification.inquiry_goal === 'selling_help' || qualification.inquiry_goal === 'home_valuation';
  const contactInfo = {
    name: clientName,
    email: toText(clientUser.email),
    phone: toText(clientUser.phone),
    address: isSellerInquiry
      ? qualification.property_address || qualification.buy_property_location || ''
      : qualification.buy_property_location || '',
  };
  const hasContact = Boolean(contactInfo.email || contactInfo.phone);
  if (!hasContact) {
    return { status: 400, body: { success: false, message: 'Please add email or phone in your profile first.' } };
  }

  const scoringText = [
    normalizedInput.message,
    qualification.intent,
    qualification.timeline,
    qualification.buy_property_location,
    qualification.budget,
    qualification.property_address,
    qualification.property_type,
    qualification.expected_price,
    qualification.must_have_features,
  ].filter(Boolean).join(' ');
  const scored = scoreAgentLead({
    message: scoringText,
    hasContact,
    contactInfo,
    interactionCount: 1,
    seedSignals: {
      ...(qualification.timeline ? { timeline: qualification.timeline } : {}),
      ...(qualification.buy_property_location ? { location: qualification.buy_property_location } : {}),
      ...(qualification.budget ? { budget: qualification.budget } : {}),
      ...(qualification.property_type ? { property_type: qualification.property_type } : {}),
    },
    formQualification: {
      ...qualification,
      price: qualification.expected_price || qualification.budget || '',
      beds: qualification.bedrooms || '',
      baths: qualification.bathrooms || '',
      location: qualification.property_address || qualification.buy_property_location || '',
    },
  });
  const leadScore = Number(scored.leadScore || 0);
  const leadGrade = normalizeGradeForLeadType(scored.leadGrade || 'cold');
  const leadMeta = scored.leadMeta || {};

  const dedupeKey = `client_professional_inquiry:${String(clientUserId)}:${String(professionalUserId)}`;
  let leadProfile = await LeadProfile.findOne({ 'ownership.dedupe_key': dedupeKey });
  const profilePayload = {
    intent: isSellerInquiry ? 'sell' : 'buy',
    ownership: {
      user_id: professionalUserId,
      professional_type: PROFESSIONAL_TYPE.AGENT,
      dedupe_key: dedupeKey,
    },
    identity: {
      full_name: clientName,
      email: contactInfo.email || '',
      phone: contactInfo.phone || '',
      canonical_email: contactInfo.email ? contactInfo.email.toLowerCase() : '',
      canonical_phone: contactInfo.phone || '',
    },
    lifecycle: {
      status: 'new',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      last_inquiry_at: new Date(),
    },
    contact_preferences: {
      preferred_contact_method: qualification.preferred_contact_method || '',
      best_time_to_contact: qualification.best_time_to_contact || '',
    },
    intent_summary: {
      primary_intent: 'client',
      buy_count: isSellerInquiry ? 0 : 1,
      sell_count: isSellerInquiry ? 1 : 0,
      client_count: 1,
    },
    property: {
      address: qualification.property_address || qualification.buy_property_location || '',
      location: qualification.property_address || qualification.buy_property_location || clientProfile?.preferred_location || '',
      budget: isSellerInquiry ? '' : qualification.budget || '',
      expected_price: isSellerInquiry ? qualification.expected_price || qualification.budget || '' : '',
      timeline: qualification.timeline || '',
      bedrooms: qualification.bedrooms || '',
      bathrooms: qualification.bathrooms || '',
      property_type: qualification.property_type || '',
      must_have_features: qualification.must_have_features || normalizedInput.message,
      parking_required: qualification.parking_required || '',
      backyard_needed: qualification.backyard_needed || '',
      school_district_important: qualification.school_district_important || '',
      images: isSellerInquiry ? qualification.property_images || [] : [],
    },
    qualification: {
      agent: {
        mortgage_status: qualification.mortgage_status || '',
        realtor_status: qualification.realtor_status || '',
        motivation_reason: qualification.motivation_reason || '',
        viewing_readiness: qualification.viewing_readiness || '',
        living_situation: qualification.living_situation || '',
        urgency_readiness: qualification.urgency_readiness || '',
        buy_property_location: qualification.buy_property_location || '',
        property_address: qualification.property_address || '',
        property_type: qualification.property_type || '',
        bedrooms: qualification.bedrooms || '',
        bathrooms: qualification.bathrooms || '',
        parking_required: qualification.parking_required || '',
        backyard_needed: qualification.backyard_needed || '',
        school_district_important: qualification.school_district_important || '',
        intent: qualification.intent || '',
      },
      mortgage_broker: {},
      lawyer: {},
    },
    source: 'client_professional_inquiry',
    scoring: {
      current_score: leadScore,
      current_grade: leadGrade,
      score_trend: 'stable',
      last_scored_at: new Date(),
      components: leadMeta.sub_scores || {},
    },
    total_score: leadScore,
    stats: {
      total_inquiries: 1,
      total_sessions: 1,
      total_matches: 1,
      buy_matches: isSellerInquiry ? 0 : 1,
      sell_matches: isSellerInquiry ? 1 : 0,
      client_matches: 1,
      last_seen_at: new Date(),
    },
  };

  if (leadProfile) {
    leadProfile.set({
      ownership: profilePayload.ownership,
      identity: profilePayload.identity,
      lifecycle: {
        ...(leadProfile.lifecycle?.toObject?.() || leadProfile.lifecycle || {}),
        last_seen_at: new Date(),
        last_inquiry_at: new Date(),
      },
      contact_preferences: profilePayload.contact_preferences,
      property: profilePayload.property,
      qualification: profilePayload.qualification,
      scoring: profilePayload.scoring,
      total_score: profilePayload.total_score,
      source: 'client_professional_inquiry',
    });
    leadProfile.stats = {
      ...(leadProfile.stats?.toObject?.() || leadProfile.stats || {}),
      total_inquiries: Number(leadProfile.stats?.total_inquiries || 0) + 1,
      last_seen_at: new Date(),
    };
    await leadProfile.save();
  } else {
    leadProfile = await LeadProfile.create(profilePayload);
  }

  let icpFit = null;
  try {
    icpFit = await computeIcpFitForLead(leadProfile, professionalUserId, {
      activeIcpProfileId: professionalProfile?.active_icp_profile_id || null,
    });
  } catch {
    // non-fatal
  }

  const agentServiceLabel = agentInquiryTitle(qualification);
  const leadMatchPayload = {
    user_id: professionalUserId,
    professional_profile_id: professionalProfile?._id || undefined,
    lead_type: buildLeadType(leadGrade, isSellerInquiry ? 'sell' : 'buy'),
    lead_profile_id: leadProfile._id,
    match_score: leadScore,
    match_status: 'new',
    compatibility_factors: {
      source: 'client_professional_inquiry',
      professional_type: PROFESSIONAL_TYPE.AGENT,
      lead_grade: leadGrade,
      lead_reasons: leadMeta.lead_reasons || [],
      sub_scores: leadMeta.sub_scores || {},
      inquiry_message: normalizedInput.message,
      intent: qualification.intent || '',
      agent_service_label: agentServiceLabel,
      timeline: qualification.timeline || '',
      preferred_location: qualification.buy_property_location || '',
      budget: qualification.budget || '',
      property_address: qualification.property_address || '',
      property_type: qualification.property_type || '',
      bedrooms: qualification.bedrooms || '',
      bathrooms: qualification.bathrooms || '',
      expected_price: qualification.expected_price || '',
      must_have_features: qualification.must_have_features || '',
      parking_required: qualification.parking_required || '',
      backyard_needed: qualification.backyard_needed || '',
      school_district_important: qualification.school_district_important || '',
      property_images: isSellerInquiry ? qualification.property_images || [] : [],
      client_user_id: String(clientUserId),
      client_profile: clientProfileSnapshot,
      contact_preference: qualification.preferred_contact_method || '',
      best_time_to_contact: qualification.best_time_to_contact || '',
    },
    icp_fit: icpFit
      ? {
          fit_score: icpFit.fit_score,
          fit_tier: icpFit.fit_tier,
          matched_factors: icpFit.matched_factors,
          missing_factors: icpFit.missing_factors,
        }
      : undefined,
    last_contact_at: new Date(),
  };

  const leadMatch = await LeadMatch.create({
    ...leadMatchPayload,
    first_contact_at: new Date(),
    contact_count: 1,
  });

  const chatThreadId = await createLeadScopedProfessionalInquiryThread({
    clientUserId,
    professionalUserId,
    leadMatchId: leadMatch._id,
    message: normalizedInput.message,
    title: agentServiceLabel || 'Agent inquiry',
    clientIdPrefix: 'agent-inquiry',
  });

  if (chatThreadId) {
    leadMatch.compatibility_factors = {
      ...(leadMatch.compatibility_factors?.toObject?.() || leadMatch.compatibility_factors || {}),
      chat_thread_id: chatThreadId,
    };
    await LeadMatch.updateOne(
      { _id: leadMatch._id },
      { $set: { 'compatibility_factors.chat_thread_id': chatThreadId } },
    );
  }

  await LeadProfile.updateOne({ _id: leadProfile._id }, { $addToSet: { lead_refs: leadMatch._id } });

  const conversionPreview = buildWorkspaceLeadConversionPreview({
    leadMatch,
    conversation: null,
    intent: isSellerInquiry ? 'sell' : 'buy',
  });
  const agentInquiryDetails = buildAgentInquiryNotificationDetails({
    clientName,
    normalizedInput,
    qualification,
    clientProfileSnapshot,
  });

  emitWorkspaceLeadEvent(professionalUserId, {
    kind: 'lead_created',
    lead_match_id: String(leadMatch._id),
    lead_profile_id: String(leadProfile._id),
    conversation_id: null,
    session_id: null,
    grade: leadGrade,
    score: Number(leadMatch.match_score ?? leadScore),
    intent: isSellerInquiry ? 'sell' : 'buy',
    appointment_status: 'none',
    high_intent: leadGrade === 'hot' || leadGrade === 'warm',
    conversion_preview: conversionPreview,
  });

  await emitNewLeadCreatedNotification(professionalUserId, {
    newLeadMatch: leadMatch,
    conversationId: null,
    sessionId: null,
    persistedGrade: leadGrade,
    finalScore: leadScore,
    socketIntent: isSellerInquiry ? 'sell' : 'buy',
    appointment_status: 'none',
    conversion_preview: conversionPreview,
    details: agentInquiryDetails,
  });

  return {
    status: 201,
    body: {
      success: true,
      message: 'Inquiry sent to agent successfully',
      data: {
        lead_match_id: String(leadMatch._id),
        lead_profile_id: String(leadProfile._id),
        lead_score: leadScore,
        lead_grade: leadGrade,
        chat_thread_id: chatThreadId,
      },
    },
  };
}

export async function submitClientLawyerInquiry({
  clientUserId,
  professionalUserId,
  body = {},
}) {
  const clientUser = await User.findById(clientUserId).select('first_name last_name email role phone').lean();
  if (!clientUser || String(clientUser.role || '').toLowerCase() !== USER_ROLE.CLIENT) {
    return { status: 403, body: { success: false, message: 'Only clients can submit lawyer inquiries' } };
  }

  if (!professionalUserId || String(professionalUserId) === String(clientUserId)) {
    return { status: 400, body: { success: false, message: 'Invalid lawyer profile' } };
  }

  const [professionalUser, professionalProfile, clientProfile] = await Promise.all([
    User.findById(professionalUserId).select('first_name last_name email role').lean(),
    ProfessionalProfile.findOne({ user_id: professionalUserId })
      .select('_id professional_type active_icp_profile_id location')
      .lean(),
    ClientProfile.findOne({ user_id: clientUserId }).lean(),
  ]);

  const professionalType = professionalProfile?.professional_type || professionalUser?.role || '';
  if (!professionalUser || String(professionalType).toLowerCase() !== PROFESSIONAL_TYPE.LAWYER) {
    return { status: 400, body: { success: false, message: 'Inquiry is only supported for lawyers' } };
  }

  const normalizedInput = normalizeLawyerInquiryBody(body);
  const validationError = validateLawyerInquiryInput(normalizedInput);
  if (validationError) {
    return { status: 400, body: { success: false, message: validationError } };
  }

  const clientName = clientDisplayName(clientUser);
  const clientProfileSnapshot = buildClientProfileSnapshot(clientProfile || {});
  const qualification = resolveLawyerQualification(normalizedInput, clientProfile || {});
  const contactInfo = {
    name: clientName,
    email: toText(clientUser.email),
    phone: toText(clientUser.phone),
    address: normalizedInput.property_address,
  };
  const hasContact = Boolean(contactInfo.email || contactInfo.phone);
  if (!hasContact) {
    return { status: 400, body: { success: false, message: 'Please add email or phone in your profile first.' } };
  }

  const scored = scoreLawyerLead({
    message: normalizedInput.message,
    hasContact,
    contactInfo,
    interactionCount: 1,
    seedSignals: {},
    formQualification: qualification,
  });
  const leadScore = Number(scored.leadScore || 0);
  const leadGrade = normalizeGradeForLeadType(scored.leadGrade || 'cold');
  const leadMeta = scored.leadMeta || {};

  const dedupeKey = `client_professional_inquiry:${String(clientUserId)}:${String(professionalUserId)}`;
  let leadProfile = await LeadProfile.findOne({ 'ownership.dedupe_key': dedupeKey });
  const profilePayload = {
    intent: 'unspecified',
    ownership: {
      user_id: professionalUserId,
      professional_type: PROFESSIONAL_TYPE.LAWYER,
      dedupe_key: dedupeKey,
    },
    identity: {
      full_name: clientName,
      email: contactInfo.email || '',
      phone: contactInfo.phone || '',
      canonical_email: contactInfo.email ? contactInfo.email.toLowerCase() : '',
      canonical_phone: contactInfo.phone || '',
    },
    lifecycle: {
      status: 'new',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      last_inquiry_at: new Date(),
    },
    contact_preferences: {
      preferred_contact_method: qualification.preferred_contact_method || '',
      best_time_to_contact: qualification.best_time_to_contact || '',
    },
    intent_summary: {
      primary_intent: 'client',
      buy_count: 0,
      sell_count: 0,
      client_count: 1,
    },
    property: {
      address: normalizedInput.property_address || '',
      location: normalizedInput.property_address || clientProfile?.preferred_location || '',
      budget: clientProfile?.dream_home_price ? String(clientProfile.dream_home_price) : '',
      expected_price: '',
      timeline: qualification.closing_timeline || '',
      must_have_features: normalizedInput.message,
    },
    qualification: {
      agent: {},
      mortgage_broker: {},
      lawyer: {
        transaction_stage: qualification.transaction_stage || '',
        closing_timeline: qualification.closing_timeline || '',
        transaction_type: qualification.transaction_type || '',
        property_value: qualification.property_value || '',
        mortgage_status: qualification.mortgage_status || '',
        realtor_involved: qualification.realtor_involved || '',
        first_time_buyer: qualification.first_time_buyer || '',
        legal_services_needed: qualification.legal_services_needed || '',
      },
    },
    source: 'client_professional_inquiry',
    scoring: {
      current_score: leadScore,
      current_grade: leadGrade,
      score_trend: 'stable',
      last_scored_at: new Date(),
      components: leadMeta.sub_scores || {},
    },
    total_score: leadScore,
    stats: {
      total_inquiries: 1,
      total_sessions: 1,
      total_matches: 1,
      buy_matches: 0,
      sell_matches: 0,
      client_matches: 1,
      last_seen_at: new Date(),
    },
  };

  if (leadProfile) {
    leadProfile.set({
      ownership: profilePayload.ownership,
      identity: profilePayload.identity,
      lifecycle: {
        ...(leadProfile.lifecycle?.toObject?.() || leadProfile.lifecycle || {}),
        last_seen_at: new Date(),
        last_inquiry_at: new Date(),
      },
      contact_preferences: profilePayload.contact_preferences,
      property: profilePayload.property,
      qualification: profilePayload.qualification,
      scoring: profilePayload.scoring,
      total_score: profilePayload.total_score,
      source: 'client_professional_inquiry',
    });
    leadProfile.stats = {
      ...(leadProfile.stats?.toObject?.() || leadProfile.stats || {}),
      total_inquiries: Number(leadProfile.stats?.total_inquiries || 0) + 1,
      last_seen_at: new Date(),
    };
    await leadProfile.save();
  } else {
    leadProfile = await LeadProfile.create(profilePayload);
  }

  let icpFit = null;
  try {
    icpFit = await computeIcpFitForLead(leadProfile, professionalUserId, {
      activeIcpProfileId: professionalProfile?.active_icp_profile_id || null,
    });
  } catch {
    // non-fatal
  }

  const leadMatchPayload = {
    user_id: professionalUserId,
    professional_profile_id: professionalProfile?._id || undefined,
    lead_type: buildLawyerLeadType(leadGrade),
    lead_profile_id: leadProfile._id,
    match_score: leadScore,
    match_status: 'new',
    compatibility_factors: {
      source: 'client_professional_inquiry',
      professional_type: PROFESSIONAL_TYPE.LAWYER,
      lead_grade: leadGrade,
      lead_reasons: leadMeta.lead_reasons || [],
      sub_scores: leadMeta.sub_scores || {},
      inquiry_message: normalizedInput.message,
      transaction_type: qualification.transaction_type || '',
      closing_timeline: qualification.closing_timeline || '',
      legal_services_needed: qualification.legal_services_needed || '',
      property_address: normalizedInput.property_address || '',
      property_value: qualification.property_value || '',
      client_user_id: String(clientUserId),
      client_profile: clientProfileSnapshot,
      contact_preference: qualification.preferred_contact_method || '',
      best_time_to_contact: qualification.best_time_to_contact || '',
    },
    icp_fit: icpFit
      ? {
          fit_score: icpFit.fit_score,
          fit_tier: icpFit.fit_tier,
          matched_factors: icpFit.matched_factors,
          missing_factors: icpFit.missing_factors,
        }
      : undefined,
    last_contact_at: new Date(),
  };

  const leadMatch = await LeadMatch.create({
    ...leadMatchPayload,
    first_contact_at: new Date(),
    contact_count: 1,
  });

  const chatThreadId = await createLeadScopedProfessionalInquiryThread({
    clientUserId,
    professionalUserId,
    leadMatchId: leadMatch._id,
    message: normalizedInput.message,
    title: 'Legal inquiry',
    clientIdPrefix: 'lawyer-inquiry',
  });

  if (chatThreadId) {
    leadMatch.compatibility_factors = {
      ...(leadMatch.compatibility_factors?.toObject?.() || leadMatch.compatibility_factors || {}),
      chat_thread_id: chatThreadId,
    };
    await LeadMatch.updateOne(
      { _id: leadMatch._id },
      { $set: { 'compatibility_factors.chat_thread_id': chatThreadId } },
    );
  }

  await LeadProfile.updateOne({ _id: leadProfile._id }, { $addToSet: { lead_refs: leadMatch._id } });

  const conversionPreview = buildWorkspaceLeadConversionPreview({
    leadMatch,
    conversation: null,
    intent: null,
  });
  const lawyerInquiryDetails = buildLawyerInquiryNotificationDetails({
    clientName,
    normalizedInput,
    qualification,
    clientProfileSnapshot,
  });

  emitWorkspaceLeadEvent(professionalUserId, {
    kind: 'lead_created',
    lead_match_id: String(leadMatch._id),
    lead_profile_id: String(leadProfile._id),
    conversation_id: null,
    session_id: null,
    grade: leadGrade,
    score: Number(leadMatch.match_score ?? leadScore),
    appointment_status: 'none',
    high_intent: leadGrade === 'hot' || leadGrade === 'warm',
    conversion_preview: conversionPreview,
  });

  await emitNewLeadCreatedNotification(professionalUserId, {
    newLeadMatch: leadMatch,
    conversationId: null,
    sessionId: null,
    persistedGrade: leadGrade,
    finalScore: leadScore,
    socketIntent: null,
    appointment_status: 'none',
    conversion_preview: conversionPreview,
    details: lawyerInquiryDetails,
  });

  return {
    status: 201,
    body: {
      success: true,
      message: 'Inquiry sent to lawyer successfully',
      data: {
        lead_match_id: String(leadMatch._id),
        lead_profile_id: String(leadProfile._id),
        lead_score: leadScore,
        lead_grade: leadGrade,
        chat_thread_id: chatThreadId,
      },
    },
  };
}

export async function submitClientMortgageBrokerInquiry({
  clientUserId,
  professionalUserId,
  body = {},
}) {
  const clientUser = await User.findById(clientUserId).select('first_name last_name email role phone').lean();
  if (!clientUser || String(clientUser.role || '').toLowerCase() !== USER_ROLE.CLIENT) {
    return { status: 403, body: { success: false, message: 'Only clients can submit mortgage broker inquiries' } };
  }

  if (!professionalUserId || String(professionalUserId) === String(clientUserId)) {
    return { status: 400, body: { success: false, message: 'Invalid mortgage broker profile' } };
  }

  const [professionalUser, professionalProfile, clientProfile] = await Promise.all([
    User.findById(professionalUserId).select('first_name last_name email role').lean(),
    ProfessionalProfile.findOne({ user_id: professionalUserId })
      .select('_id professional_type active_icp_profile_id location')
      .lean(),
    ClientProfile.findOne({ user_id: clientUserId }).lean(),
  ]);

  const professionalType = professionalProfile?.professional_type || professionalUser?.role || '';
  if (!professionalUser || String(professionalType).toLowerCase() !== PROFESSIONAL_TYPE.MORTGAGE_BROKER) {
    return { status: 400, body: { success: false, message: 'Inquiry is only supported for mortgage brokers' } };
  }

  const normalizedInput = normalizeMortgageBrokerInquiryBody(body);
  const validationError = validateMortgageBrokerInquiryInput(normalizedInput);
  if (validationError) {
    return { status: 400, body: { success: false, message: validationError } };
  }

  const clientName = clientDisplayName(clientUser);
  const clientProfileSnapshot = buildClientProfileSnapshot(clientProfile || {});
  const qualification = resolveMortgageBrokerQualification(normalizedInput, clientProfile || {});
  const contactInfo = {
    name: clientName,
    email: toText(clientUser.email),
    phone: toText(clientUser.phone),
    address: normalizedInput.property_address,
  };
  const hasContact = Boolean(contactInfo.email || contactInfo.phone);
  if (!hasContact) {
    return { status: 400, body: { success: false, message: 'Please add email or phone in your profile first.' } };
  }

  const signals = extractSignals(`${normalizedInput.message} ${normalizedInput.property_address}`.trim());
  const scored = scoreMortgageBrokerLead({
    message: normalizedInput.message,
    hasContact,
    contactInfo,
    interactionCount: 1,
    seedSignals: signals,
    formQualification: qualification,
  });
  const leadScore = Number(scored.leadScore || 0);
  const leadGrade = normalizeGradeForLeadType(scored.leadGrade || 'cold');
  const leadMeta = scored.leadMeta || {};

  const dedupeKey = `client_professional_inquiry:${String(clientUserId)}:${String(professionalUserId)}`;
  let leadProfile = await LeadProfile.findOne({ 'ownership.dedupe_key': dedupeKey });
  const profilePayload = {
    intent: 'unspecified',
    ownership: {
      user_id: professionalUserId,
      professional_type: PROFESSIONAL_TYPE.MORTGAGE_BROKER,
      dedupe_key: dedupeKey,
    },
    identity: {
      full_name: clientName,
      email: contactInfo.email || '',
      phone: contactInfo.phone || '',
      canonical_email: contactInfo.email ? contactInfo.email.toLowerCase() : '',
      canonical_phone: contactInfo.phone || '',
    },
    lifecycle: {
      status: 'new',
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      last_inquiry_at: new Date(),
    },
    contact_preferences: {
      preferred_contact_method: qualification.preferred_contact_method || '',
      best_time_to_contact: qualification.best_time_to_contact || '',
    },
    intent_summary: {
      primary_intent: 'client',
      buy_count: 0,
      sell_count: 0,
      client_count: 1,
    },
    property: {
      address: normalizedInput.property_address || '',
      location: normalizedInput.property_address || clientProfile?.preferred_location || '',
      budget: clientProfile?.dream_home_price ? String(clientProfile.dream_home_price) : '',
      expected_price: '',
      timeline: qualification.mortgage_timeline || '',
      must_have_features: normalizedInput.message,
    },
    qualification: {
      agent: {},
      mortgage_broker: {
        mortgage_timeline: qualification.mortgage_timeline || '',
        pre_approval_status: qualification.pre_approval_status || '',
        credit_score_range: qualification.credit_score_range || '',
        employment_status: qualification.employment_status || '',
        household_income: qualification.household_income || '',
        down_payment_readiness: qualification.down_payment_readiness || '',
        property_budget: qualification.property_budget || '',
        purchase_purpose: qualification.purchase_purpose || '',
        urgency_signal: qualification.urgency_signal || '',
      },
      lawyer: {},
    },
    source: 'client_professional_inquiry',
    scoring: {
      current_score: leadScore,
      current_grade: leadGrade,
      score_trend: 'stable',
      last_scored_at: new Date(),
      components: leadMeta.sub_scores || {},
    },
    total_score: leadScore,
    stats: {
      total_inquiries: 1,
      total_sessions: 1,
      total_matches: 1,
      buy_matches: 0,
      sell_matches: 0,
      client_matches: 1,
      last_seen_at: new Date(),
    },
  };

  if (leadProfile) {
    leadProfile.set({
      ownership: profilePayload.ownership,
      identity: profilePayload.identity,
      lifecycle: {
        ...(leadProfile.lifecycle?.toObject?.() || leadProfile.lifecycle || {}),
        last_seen_at: new Date(),
        last_inquiry_at: new Date(),
      },
      contact_preferences: profilePayload.contact_preferences,
      property: profilePayload.property,
      qualification: profilePayload.qualification,
      scoring: profilePayload.scoring,
      total_score: profilePayload.total_score,
      source: 'client_professional_inquiry',
    });
    leadProfile.stats = {
      ...(leadProfile.stats?.toObject?.() || leadProfile.stats || {}),
      total_inquiries: Number(leadProfile.stats?.total_inquiries || 0) + 1,
      last_seen_at: new Date(),
    };
    await leadProfile.save();
  } else {
    leadProfile = await LeadProfile.create(profilePayload);
  }

  let icpFit = null;
  try {
    icpFit = await computeIcpFitForLead(leadProfile, professionalUserId, {
      activeIcpProfileId: professionalProfile?.active_icp_profile_id || null,
    });
  } catch {
    // non-fatal
  }

  const mortgageServiceLabel = brokerInquiryTitle(qualification);
  const leadMatchPayload = {
    user_id: professionalUserId,
    professional_profile_id: professionalProfile?._id || undefined,
    lead_type: buildMortgageBrokerLeadType(leadGrade),
    lead_profile_id: leadProfile._id,
    match_score: leadScore,
    match_status: 'new',
    compatibility_factors: {
      source: 'client_professional_inquiry',
      professional_type: PROFESSIONAL_TYPE.MORTGAGE_BROKER,
      lead_grade: leadGrade,
      lead_reasons: leadMeta.lead_reasons || [],
      sub_scores: leadMeta.sub_scores || {},
      inquiry_message: normalizedInput.message,
      mortgage_timeline: qualification.mortgage_timeline || '',
      pre_approval_status: qualification.pre_approval_status || '',
      credit_score_range: qualification.credit_score_range || '',
      employment_status: qualification.employment_status || '',
      household_income: qualification.household_income || '',
      down_payment_readiness: qualification.down_payment_readiness || '',
      property_budget: qualification.property_budget || '',
      purchase_purpose: qualification.purchase_purpose || '',
      mortgage_service_label: mortgageServiceLabel,
      property_address: normalizedInput.property_address || '',
      client_user_id: String(clientUserId),
      client_profile: clientProfileSnapshot,
      contact_preference: qualification.preferred_contact_method || '',
      best_time_to_contact: qualification.best_time_to_contact || '',
    },
    icp_fit: icpFit
      ? {
          fit_score: icpFit.fit_score,
          fit_tier: icpFit.fit_tier,
          matched_factors: icpFit.matched_factors,
          missing_factors: icpFit.missing_factors,
        }
      : undefined,
    last_contact_at: new Date(),
  };

  const leadMatch = await LeadMatch.create({
    ...leadMatchPayload,
    first_contact_at: new Date(),
    contact_count: 1,
  });

  const chatThreadId = await createLeadScopedProfessionalInquiryThread({
    clientUserId,
    professionalUserId,
    leadMatchId: leadMatch._id,
    message: normalizedInput.message,
    title: 'Mortgage inquiry',
    clientIdPrefix: 'mortgage-broker-inquiry',
  });

  if (chatThreadId) {
    leadMatch.compatibility_factors = {
      ...(leadMatch.compatibility_factors?.toObject?.() || leadMatch.compatibility_factors || {}),
      chat_thread_id: chatThreadId,
    };
    await LeadMatch.updateOne(
      { _id: leadMatch._id },
      { $set: { 'compatibility_factors.chat_thread_id': chatThreadId } },
    );
  }

  await LeadProfile.updateOne({ _id: leadProfile._id }, { $addToSet: { lead_refs: leadMatch._id } });

  const conversionPreview = buildWorkspaceLeadConversionPreview({
    leadMatch,
    conversation: null,
    intent: null,
  });
  const mortgageInquiryDetails = buildMortgageBrokerInquiryNotificationDetails({
    clientName,
    normalizedInput,
    qualification,
    clientProfileSnapshot,
  });

  emitWorkspaceLeadEvent(professionalUserId, {
    kind: 'lead_created',
    lead_match_id: String(leadMatch._id),
    lead_profile_id: String(leadProfile._id),
    conversation_id: null,
    session_id: null,
    grade: leadGrade,
    score: Number(leadMatch.match_score ?? leadScore),
    appointment_status: 'none',
    high_intent: leadGrade === 'hot' || leadGrade === 'warm',
    conversion_preview: conversionPreview,
  });

  await emitNewLeadCreatedNotification(professionalUserId, {
    newLeadMatch: leadMatch,
    conversationId: null,
    sessionId: null,
    persistedGrade: leadGrade,
    finalScore: leadScore,
    socketIntent: null,
    appointment_status: 'none',
    conversion_preview: conversionPreview,
    details: mortgageInquiryDetails,
  });

  return {
    status: 201,
    body: {
      success: true,
      message: 'Inquiry sent to mortgage broker successfully',
      data: {
        lead_match_id: String(leadMatch._id),
        lead_profile_id: String(leadProfile._id),
        lead_score: leadScore,
        lead_grade: leadGrade,
        chat_thread_id: chatThreadId,
      },
    },
  };
}
