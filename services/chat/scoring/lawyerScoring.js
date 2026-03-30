import LeadProfile from '../../../models/LeadProfile.js';
import LeadMatch from '../../../models/LeadMatch.js';
import LeadAttribution from '../../../models/LeadAttribution.js';
import logger from '../../../utils/logger.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import { mergeSignals } from './common.js';
const LAWYER_GRADE_ORDER = { hot: 3, warm: 2, cold: 1, unscored: 0 };
export const bestLawyerGrade = (a, b) =>
  (LAWYER_GRADE_ORDER[a] || 0) >= (LAWYER_GRADE_ORDER[b] || 0) ? a : b;
const buildLawyerLeadType = (grade) => `${grade}_client`;
export const deriveLawyerQualificationFromText = (text = '') => {
  const t = String(text || '').toLowerCase();
  const out = {};
  if (/offer accepted|offer was accepted|accepted an offer|we have an offer/i.test(t)) out.transaction_stage = 'offer_accepted';
  else if (/actively submitting|submitting offers|putting in offers|making offers/i.test(t)) out.transaction_stage = 'actively_submitting';
  else if (/pre.?approval|pre.?approv stage|getting pre.?approv|mortgage stage/i.test(t)) out.transaction_stage = 'pre_approval_stage';
  else if (/just research|researching|exploring|browsing|not sure yet/i.test(t)) out.transaction_stage = 'just_researching';
  if (/within 30 days|30 days|this month|closing this month|next month closing/i.test(t)) out.closing_timeline = 'within_30_days';
  else if (/30.?60 days|30 to 60|1.?2 months|60 days/i.test(t)) out.closing_timeline = '30_60_days';
  else if (/60.?90 days|60 to 90|2.?3 months|90 days/i.test(t)) out.closing_timeline = '60_90_days';
  else if (/unknown|not sure|don'?t know|tbd/i.test(t) && /closing|date/i.test(t)) out.closing_timeline = 'unknown';
  if (/home purchase|buying a home|purchasing|purchase/i.test(t)) out.transaction_type = 'home_purchase';
  else if (/home sale|selling|sale of|selling my home/i.test(t)) out.transaction_type = 'home_sale';
  else if (/refinanc|refi/i.test(t)) out.transaction_type = 'refinance';
  else if (/title transfer|transfer title|estate transfer/i.test(t)) out.transaction_type = 'title_transfer';
  if (/\$?1\s*m|\$?1,?000,?000|1m\+|million plus|over a million/i.test(t)) out.property_value = '1m_plus';
  else if (/\$?700k|\$?700,?000|700k.?1m|700.?1\s*m|700k to 1m/i.test(t)) out.property_value = '700k_1m';
  else if (/\$?400k|\$?400,?000|400k.?700k|400.?700/i.test(t)) out.property_value = '400k_700k';
  else if (/under 400|below 400|less than 400k/i.test(t)) out.property_value = 'under_400k';
  if (/fully approved|mortgage approved|loan approved|approved/i.test(t)) out.mortgage_status = 'fully_approved';
  else if (/conditional|conditions|subject to/i.test(t)) out.mortgage_status = 'conditional_approval';
  else if (/still applying|in progress|applying|working on/i.test(t)) out.mortgage_status = 'still_applying';
  if (/yes.*realtor|working with (a )?realtor|have (a )?realtor|have (an )?agent/i.test(t)) out.realtor_involved = 'yes';
  else if (/no (realtor|agent)|don'?t have (a )?(realtor|agent)/i.test(t)) out.realtor_involved = 'no';
  if (/first time|first.?time buyer|first home|never bought/i.test(t)) out.first_time_buyer = 'yes';
  else if (/no.*second|not first|bought before|previous home/i.test(t)) out.first_time_buyer = 'no';
  if (/full closing|complete closing|full legal|closing services/i.test(t)) out.legal_services_needed = 'full_closing';
  else if (/title transfer|transfer services/i.test(t)) out.legal_services_needed = 'title_transfer';
  else if (/document review|review documents|contract review/i.test(t)) out.legal_services_needed = 'document_review';
  return out;
};

export const mergeLawyerQualificationForScoring = (formQualification = {}, aiDetails = {}) => {
  const fq = formQualification || {};
  const ai = aiDetails || {};
  const pick = (key) => (ai[key] && String(ai[key]).trim() ? ai[key] : fq[key]) || null;
  return {
    transaction_stage:    pick('transaction_stage'),
    closing_timeline:     pick('closing_timeline'),
    transaction_type:     pick('transaction_type'),
    property_value:       pick('property_value'),
    mortgage_status:      pick('mortgage_status'),
    realtor_involved:     pick('realtor_involved'),
    first_time_buyer:     pick('first_time_buyer'),
    legal_services_needed: pick('legal_services_needed'),
    preferred_contact_method: pick('preferred_contact_method'),
    best_time_to_contact: pick('best_time_to_contact'),
  };
};

export const scoreLawyerLead = ({
  message,
  hasContact,
  contactInfo,
  interactionCount,
  seedSignals = {},
  formQualification = {},
}) => {
  const fq = formQualification || {};
  const reasons = [];

  let transactionStageScore = 0;
  const ts = fq.transaction_stage;
  if (ts === 'offer_accepted') { transactionStageScore = 25; reasons.push('Transaction stage: offer accepted (extremely hot)'); }
  else if (ts === 'actively_submitting') { transactionStageScore = 18; reasons.push('Transaction stage: actively submitting offers'); }
  else if (ts === 'pre_approval_stage') { transactionStageScore = 10; reasons.push('Transaction stage: pre-approval stage'); }
  else if (ts === 'just_researching') { transactionStageScore = 0; reasons.push('Transaction stage: just researching'); }

  let closingTimelineScore = 0;
  const ct = fq.closing_timeline;
  if (ct === 'within_30_days') { closingTimelineScore = 20; reasons.push('Closing: within 30 days'); }
  else if (ct === '30_60_days') { closingTimelineScore = 15; reasons.push('Closing: 30–60 days'); }
  else if (ct === '60_90_days') { closingTimelineScore = 10; reasons.push('Closing: 60–90 days'); }
  else if (ct === 'unknown') { closingTimelineScore = 0; reasons.push('Closing: unknown'); }

  let transactionTypeScore = 0;
  const tt = fq.transaction_type;
  if (tt === 'home_purchase' || tt === 'home_sale') { transactionTypeScore = 10; reasons.push('Transaction type: ' + (tt === 'home_purchase' ? 'home purchase' : 'home sale')); }
  else if (tt === 'refinance' || tt === 'title_transfer') { transactionTypeScore = 6; reasons.push('Transaction type: ' + (tt === 'refinance' ? 'refinance' : 'title transfer')); }

  let propertyValueScore = 0;
  const pv = fq.property_value;
  if (pv === '1m_plus') { propertyValueScore = 10; reasons.push('Property value: $1M+'); }
  else if (pv === '700k_1m') { propertyValueScore = 8; reasons.push('Property value: $700k–$1M'); }
  else if (pv === '400k_700k') { propertyValueScore = 6; reasons.push('Property value: $400k–$700k'); }
  else if (pv === 'under_400k') { propertyValueScore = 4; reasons.push('Property value: under $400k'); }

  let mortgageStatusScore = 0;
  const ms = fq.mortgage_status;
  if (ms === 'fully_approved') { mortgageStatusScore = 10; reasons.push('Mortgage: fully approved'); }
  else if (ms === 'conditional_approval') { mortgageStatusScore = 7; reasons.push('Mortgage: conditional approval'); }
  else if (ms === 'still_applying') { mortgageStatusScore = 3; reasons.push('Mortgage: still applying'); }

  let realtorScore = 0;
  const ri = fq.realtor_involved;
  if (ri === 'yes') { realtorScore = 5; reasons.push('Realtor: yes'); }
  else if (ri === 'no') { realtorScore = 2; reasons.push('Realtor: no'); }

  let firstTimeBuyerScore = 0;
  const ftb = fq.first_time_buyer;
  if (ftb === 'yes') { firstTimeBuyerScore = 5; reasons.push('First-time buyer: yes'); }
  else if (ftb === 'no') { firstTimeBuyerScore = 3; reasons.push('First-time buyer: no'); }

  let legalServicesScore = 0;
  const lsn = fq.legal_services_needed;
  if (lsn === 'full_closing') { legalServicesScore = 10; reasons.push('Legal services: full closing'); }
  else if (lsn === 'title_transfer') { legalServicesScore = 7; reasons.push('Legal services: title transfer'); }
  else if (lsn === 'document_review') { legalServicesScore = 5; reasons.push('Legal services: document review'); }

  const finalScore = Math.min(
    transactionStageScore + closingTimelineScore + transactionTypeScore +
    propertyValueScore + mortgageStatusScore + realtorScore +
    firstTimeBuyerScore + legalServicesScore,
    100
  );

  const quality =
    finalScore >= 80 ? 'hot'
    : finalScore >= 60 ? 'warm'
    : 'cold';

  const signals = {
    ...seedSignals,
    closing_timeline: fq.closing_timeline,
    property_value:  fq.property_value,
  };

  return {
    leadScore: finalScore,
    leadGrade: quality,
    leadMeta: {
      qualified:    quality === 'hot' || quality === 'warm',
      lead_reasons: reasons,
      sub_scores:   {
        transactionStageScore, closingTimelineScore, transactionTypeScore,
        propertyValueScore, mortgageStatusScore, realtorScore,
        firstTimeBuyerScore, legalServicesScore,
      },
      signals,
      ...(hasContact && contactInfo ? { contact: contactInfo } : {}),
    },
  };
};

export const createLawyerLeadRecords = async ({
  conversation,
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
  professionalProfileId,
  messageSnippet,
  formContact,
  aiDetails,
}) => {
  const leadType = buildLawyerLeadType(leadGrade);
  const signals  = leadMeta.signals || {};
  const now      = new Date();
  const fq       = formContact || {};
  const ai       = aiDetails || {};

  const leadProfile = await LeadProfile.create({
    intent:                   'buy',
    full_name:                contactInfo.name    || 'Unknown',
    email:                    contactInfo.email   || '',
    phone:                    contactInfo.phone   || '',
    property_address:        contactInfo.address || ai.property_address || '',
    location:                 ai.location || ai.property_address || '',
    budget:                   signals.budget || fq.budget || '',
    expected_price:           ai.property_value || fq.property_value || '',
    timeline:                 fq.closing_timeline || ai.closing_timeline || '',
    preferred_contact_method:  fq.preferred_contact_method || ai.preferred_contact_method || '',
    best_time_to_contact:     fq.best_time_to_contact || ai.best_time_to_contact || '',
    transaction_stage:        ai.transaction_stage || fq.transaction_stage || '',
    closing_timeline:         ai.closing_timeline || fq.closing_timeline || '',
    transaction_type:        ai.transaction_type || fq.transaction_type || '',
    property_value:           ai.property_value || fq.property_value || '',
    mortgage_status:         ai.mortgage_status || fq.mortgage_status || '',
    realtor_involved:         ai.realtor_involved || fq.realtor_involved || '',
    first_time_buyer:         ai.first_time_buyer || fq.first_time_buyer || '',
    legal_services_needed:   ai.legal_services_needed || fq.legal_services_needed || '',
    source:                   'chatbot',
    total_score:              leadScore,
  });

  const leadMatch = await LeadMatch.create({
    user_id:                 userId,
    professional_profile_id: professionalProfileId,
    conversation_id:         conversation._id,
    lead_type:              leadType,
    lead_profile_id:         leadProfile._id,
    match_score:             leadScore,
    match_status:            'new',
    contact_count:           1,
    first_contact_at:        now,
    last_contact_at:         now,
    compatibility_factors: {
      session_id:      sessionId,
      embed_token:     embedToken,
      agent_type:      conversation.agent_type,
      intent:          'buy',
      lead_grade:      leadGrade,
      message_snippet: messageSnippet,
      contact:         contactInfo,
      matched:         leadGrade === 'hot' || leadGrade === 'warm',
      professional_type: PROFESSIONAL_TYPE.LAWYER,
    },
  });

  await LeadAttribution.create({
    lead_type:       leadType,
    source:          'chatbot',
    converted:       false,
    lead_profile_id: leadProfile._id,
    session_id:      sessionId,
    ip_address:      clientIp  || '',
    user_agent:      userAgent || '',
    referrer_url:    referer   || '',
    initial_score:   leadScore,
    initial_quality: leadGrade,
  });

  logger.info(`Lawyer lead created: ${leadType} | score: ${leadScore} | conversation: ${conversation._id}`);

  return leadMatch;
};
