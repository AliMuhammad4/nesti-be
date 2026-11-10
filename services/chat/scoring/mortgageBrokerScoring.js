import logger from '../../../utils/logger.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';
import { mergeSignals, buildMortgageBrokerLeadType } from './common.js';
import { partitionBuyerBudgetInputs } from '../../agent/propertyMatch/parsing.js';
import {
  bumpLeadProfileStats,
  createValidatedLeadAttribution,
  createValidatedLeadMatch,
  createOrReuseLeadProfile,
} from './leadPersistence.js';
import { computeIcpFitForLead } from '../../lead/icpScoringService.js';
import { marketChoiceFromForm, marketCountryFromForm, marketCurrency, normalizeMarketRegion } from '../../professionalAssistant/brokerInvestorMarket.js';
const MORTGAGE_GRADE_ORDER = { hot: 3, warm: 2, cold: 1, unscored: 0 };
export const bestMortgageGrade = (a, b) =>
  (MORTGAGE_GRADE_ORDER[a] || 0) >= (MORTGAGE_GRADE_ORDER[b] || 0) ? a : b;
export const deriveMortgageQualificationFromText = (text = '') => {
  const t = String(text || '').toLowerCase();
  const out = {};
  if (/immediately|right away|asap|urgent|apply now/i.test(t)) out.mortgage_timeline = 'immediately';
  else if (/1.?2.?month|within 1.?2 months|next month|next 2 months/i.test(t)) out.mortgage_timeline = '1_2_months';
  else if (/3.?6.?month|within 3.?6|3 to 6 months/i.test(t)) out.mortgage_timeline = '3_6_months';
  else if (/6.?12.?month|within a year|6 to 12|next year/i.test(t)) out.mortgage_timeline = '6_12_months';
  else if (/research|browsing|just looking|exploring|not sure/i.test(t)) out.mortgage_timeline = 'just_researching';
  if (/need pre.?approval|need pre.?approv now|want pre.?approval/i.test(t)) out.pre_approval_status = 'need_now';
  else if (/expired|pre.?approval expired|pre.?approv expired/i.test(t)) out.pre_approval_status = 'expired';
  else if (/in progress|working on pre.?approval/i.test(t)) out.pre_approval_status = 'in_progress';
  else if (/already approved|already pre.?approv|have pre.?approval/i.test(t)) out.pre_approval_status = 'already_approved';
  else if (/just research|researching|exploring/i.test(t)) out.pre_approval_status = 'just_researching';
  // A score only counts next to a credit word, so phone numbers ("+92 300...") and prices ("$700K") are ignored.
  const scoreHit = t.match(/\b(?:credit|score|fico|beacon)\b[^0-9$+]{0,25}\b([3-8]\d{2})\b(?![,.]?\d|\s*k\b)/i)
    || t.match(/(?<![\d$+.,])\b([3-8]\d{2})\b\s*(?:credit|score|fico|beacon)\b/i);
  const score = scoreHit ? Number(scoreHit[1]) : 0;
  if ((score >= 750 && score <= 900) || /excellent credit/i.test(t)) out.credit_score_range = '750_plus';
  else if ((score >= 700 && score < 750) || /good credit/i.test(t)) out.credit_score_range = '700_749';
  else if ((score >= 650 && score < 700) || /fair credit/i.test(t)) out.credit_score_range = '650_699';
  else if (score >= 600 && score < 650) out.credit_score_range = '600_649';
  else if ((score >= 300 && score < 600) || /under 600|below 600|poor credit|bad credit/i.test(t)) out.credit_score_range = 'under_600';
  if (/full.?time|employed full time|permanent job/i.test(t)) out.employment_status = 'full_time';
  else if (/self.?employed|self employed|own business/i.test(t)) out.employment_status = 'self_employed';
  else if (/contract|contractor|temporary/i.test(t)) out.employment_status = 'contract';
  else if (/new job|just started|less than a year/i.test(t)) out.employment_status = 'new_job';
  else if (/unemployed|between jobs|not working/i.test(t)) out.employment_status = 'unemployed';
  if (/\$?200\s*k|\$?200,?000|200k\+|200k plus/i.test(t)) out.household_income = '200k_plus';
  else if (/\$?150\s*k|\$?150,?000|150k\s*[-–]\s*200k|150.?200k/i.test(t)) out.household_income = '150k_200k';
  else if (/\$?100\s*k|\$?100,?000|100k\s*[-–]\s*150k/i.test(t)) out.household_income = '100k_150k';
  else if (/\$?70\s*k|\$?70,?000|70k\s*[-–]\s*100k/i.test(t)) out.household_income = '70k_100k';
  else if (/under 70k|below 70k|less than 70k/i.test(t)) out.household_income = 'under_70k';
  if (/20\s*%|20%|twenty percent|20 percent plus/i.test(t)) out.down_payment_readiness = '20_plus';
  else if (/10\s*[-–]\s*19|10.?19%|10 to 19 percent/i.test(t)) out.down_payment_readiness = '10_19';
  else if (/5\s*[-–]\s*9|5.?9%|5 to 9 percent/i.test(t)) out.down_payment_readiness = '5_9';
  else if (/under 5|below 5%|less than 5/i.test(t)) out.down_payment_readiness = 'under_5';
  else if (/no savings|no down payment|no money saved|haven't saved/i.test(t)) out.down_payment_readiness = 'no_savings';
  if (/refinanc|refi\b/i.test(t)) out.purchase_purpose = 'refinance';
  else if (/primary residence|first home|primary home|main home/i.test(t)) out.purchase_purpose = 'primary_residence';
  else if (/investment|rental property|investment property/i.test(t)) out.purchase_purpose = 'investment';
  else if (/vacation|second home|cottage|vacation home/i.test(t)) out.purchase_purpose = 'vacation_home';
  if (/yes.*approved tomorrow|start house hunting immediately|immediately.*house hunt/i.test(t)) out.urgency_signal = 'yes';
  else if (/maybe|might|consider/i.test(t) && /house hunt|approved/i.test(t)) out.urgency_signal = 'maybe';
  else if (/no.*not yet|not ready|take my time/i.test(t)) out.urgency_signal = 'no';
  if (/\bbrrrr\b/i.test(t)) out.investment_type = 'brrrr';
  else if (/fix.?and.?flip|\bflip/i.test(t)) out.investment_type = 'fix_and_flip';
  else if (/vacation rental|airbnb|short.?term rental/i.test(t)) out.investment_type = 'vacation_rental';
  else if (/rental|cash flow|buy.?to.?let/i.test(t)) out.investment_type = 'rental_property';
  else if (/pre.?construction/i.test(t)) out.investment_type = 'pre_construction';
  else if (/multi.?unit|multi.?family/i.test(t)) out.investment_type = 'multi_unit';
  else if (/commercial/i.test(t)) out.investment_type = 'commercial';
  else if (/vacation rental|airbnb|short.?term rental/i.test(t)) out.investment_type = 'vacation_rental';
  if (/own other (investment )?propert|already (own|have) (an? )?investment|portfolio/i.test(t)) out.owns_investments = 'yes';
  else if (/first investment|no other investment|don'?t own (any )?other/i.test(t)) out.owns_investments = 'no';
  if (/\bdscr\b|debt service coverage/i.test(t)) out.investment_financing = 'dscr';
  else if (/hard money|bridge loan/i.test(t)) out.investment_financing = 'hard_money_bridge';
  else if (/\bb.?lender|private lender|private mortgage/i.test(t)) out.investment_financing = 'b_private_lender';
  else if (/cash.?out refi|equity take.?out|\bheloc\b/i.test(t)) out.investment_financing = 'refinance_equity';
  else if (/portfolio loan/i.test(t)) out.investment_financing = 'portfolio';
  if (/\b(through|under|via) (my |an? |our )?(llc|corporation|holding company|holdco|company)\b/i.test(t)) out.borrower_entity = 'company';
  if (/\bcanada\b|\bcanadian\b|\bcad\b/i.test(t)) out.market_country = 'CA';
  // "USD" says nothing about the market: every market quotes amounts in USD.
  else if (/\busa\b|united states/i.test(t)) out.market_country = 'US';
  if (out.purchase_purpose === 'investment' || out.investment_type || out.investment_financing === 'dscr') out.client_type = 'investor';
  return out;
};

export const mergeMortgageQualificationForScoring = (formQualification = {}, aiDetails = {}) => {
  const fq = formQualification || {};
  const ai = aiDetails || {};
  const pick = (key) => (ai[key] && String(ai[key]).trim() ? ai[key] : fq[key]) || null;
  const purchasePurpose = pick('purchase_purpose');
  const clientType = pick('client_type')
    || (String(purchasePurpose || '').toLowerCase() === 'investment' ? 'investor' : null);
  return {
    mortgage_timeline:      pick('mortgage_timeline'),
    pre_approval_status:    pick('pre_approval_status'),
    credit_score_range:     pick('credit_score_range'),
    employment_status:      pick('employment_status'),
    household_income:       pick('household_income'),
    down_payment_readiness:  pick('down_payment_readiness'),
    property_budget:        pick('property_budget'),
    purchase_purpose:       purchasePurpose,
    urgency_signal:         pick('urgency_signal'),
    budget:                 pick('budget'),
    client_type:            clientType,
    investment_type:        pick('investment_type'),
    owns_investments:       pick('owns_investments'),
    investment_financing:   pick('investment_financing'),
    borrower_entity:        pick('borrower_entity'),
    // Explicit form market wins over a model guess.
    market_country:         fq.market_country || ai.market_country || null,
    market_region:          fq.market_region || ai.market_region || null,
    market_city:            fq.market_city || ai.market_city || null,
    market_country_name:            fq.market_country_name || ai.market_country_name || null,
  };
};

export const scoreMortgageBrokerLead = ({
  message,
  hasContact,
  contactInfo,
  interactionCount,
  seedSignals = {},
  formQualification = {},
}) => {
  const fq = formQualification || {};
  const reasons = [];

  let timelineScore = 0;
  const mt = fq.mortgage_timeline;
  if (mt === 'immediately') { timelineScore = 20; reasons.push('Mortgage timeline: immediately'); }
  else if (mt === '1_2_months') { timelineScore = 18; reasons.push('Mortgage timeline: 1–2 months'); }
  else if (mt === '3_6_months') { timelineScore = 10; reasons.push('Mortgage timeline: 3–6 months'); }
  else if (mt === '6_12_months') { timelineScore = 5; reasons.push('Mortgage timeline: 6–12 months'); }
  else if (mt === 'just_researching') { timelineScore = 0; reasons.push('Mortgage timeline: just researching'); }

  let preApprovalScore = 0;
  const pas = fq.pre_approval_status;
  if (pas === 'need_now') { preApprovalScore = 15; reasons.push('Pre-approval: need now'); }
  else if (pas === 'expired') { preApprovalScore = 12; reasons.push('Pre-approval: expired (high value)'); }
  else if (pas === 'in_progress') { preApprovalScore = 10; reasons.push('Pre-approval: in progress'); }
  else if (pas === 'already_approved') { preApprovalScore = 5; reasons.push('Pre-approval: already approved'); }
  else if (pas === 'just_researching') { preApprovalScore = 0; reasons.push('Pre-approval: just researching'); }
  const cashInvestor = fq.investment_financing === 'cash_purchase' || fq.down_payment_readiness === 'cash_purchase';
  if (!pas && cashInvestor) { preApprovalScore = 5; reasons.push('Pre-approval: not needed (cash purchase)'); }

  let creditScore = 0;
  const cs = fq.credit_score_range;
  if (cs === '750_plus') { creditScore = 15; reasons.push('Credit: 750+'); }
  else if (cs === '700_749') { creditScore = 12; reasons.push('Credit: 700–749'); }
  else if (cs === '650_699') { creditScore = 8; reasons.push('Credit: 650–699'); }
  else if (cs === '600_649') { creditScore = 4; reasons.push('Credit: 600–649'); }
  else if (cs === 'under_600') { creditScore = 1; reasons.push('Credit: under 600'); }

  let employmentScore = 0;
  const es = fq.employment_status;
  if (es === 'full_time') { employmentScore = 10; reasons.push('Employment: full-time'); }
  else if (es === 'self_employed') { employmentScore = 8; reasons.push('Employment: self-employed'); }
  else if (es === 'contract') { employmentScore = 6; reasons.push('Employment: contract'); }
  else if (es === 'new_job') { employmentScore = 4; reasons.push('Employment: new job (<1 year)'); }
  else if (es === 'unemployed') { employmentScore = 0; reasons.push('Employment: unemployed'); }

  let incomeScore = 0;
  const hi = fq.household_income;
  if (hi === '200k_plus') { incomeScore = 10; reasons.push('Income: $200k+'); }
  else if (hi === '150k_200k') { incomeScore = 8; reasons.push('Income: $150k–200k'); }
  else if (hi === '100k_150k') { incomeScore = 6; reasons.push('Income: $100k–150k'); }
  else if (hi === '70k_100k') { incomeScore = 4; reasons.push('Income: $70k–100k'); }
  else if (hi === 'under_70k') { incomeScore = 1; reasons.push('Income: under $70k'); }

  let downPaymentScore = 0;
  const dp = fq.down_payment_readiness;
  if (dp === '20_plus') { downPaymentScore = 15; reasons.push('Down payment: 20%+'); }
  else if (dp === '10_19') { downPaymentScore = 12; reasons.push('Down payment: 10–19%'); }
  else if (dp === '5_9') { downPaymentScore = 8; reasons.push('Down payment: 5–9%'); }
  else if (dp === 'under_5') { downPaymentScore = 3; reasons.push('Down payment: under 5%'); }
  else if (dp === 'no_savings') { downPaymentScore = 0; reasons.push('Down payment: no savings yet'); }
  // Investor capital bands (investment properties need more equity than owner-occupied homes).
  else if (dp === 'cash_purchase') { downPaymentScore = 15; reasons.push('Capital: cash purchase'); }
  else if (dp === '25_plus') { downPaymentScore = 15; reasons.push('Down payment: 25%+'); }
  else if (dp === '20_24') { downPaymentScore = 13; reasons.push('Down payment: 20–24%'); }
  else if (dp === '15_19') { downPaymentScore = 8; reasons.push('Down payment: 15–19%'); }
  else if (dp === 'under_15') { downPaymentScore = 3; reasons.push('Down payment: under 15%'); }
  else if (dp === 'not_sure') { downPaymentScore = 0; reasons.push('Down payment: not sure yet'); }

  let budgetScore = 0;
  const pb = fq.property_budget;
  const hasBudget = seedSignals?.budget || fq.budget;
  if (pb === 'clearly_defined' || (hasBudget && !hasBudget.includes('?'))) { budgetScore = 5; reasons.push('Budget: clearly defined'); }
  else if (pb === 'approximate' || hasBudget) { budgetScore = 3; reasons.push('Budget: approximate range'); }
  else { budgetScore = 0; reasons.push('Budget: not sure yet'); }

  let purposeScore = 0;
  const pp = fq.purchase_purpose;
  if (pp === 'primary_residence' || pp === 'investment') { purposeScore = 5; reasons.push('Purpose: ' + (pp === 'primary_residence' ? 'primary residence' : 'investment')); }
  else if (pp === 'refinance') { purposeScore = 5; reasons.push('Purpose: refinance'); }
  else if (pp === 'vacation_home') { purposeScore = 3; reasons.push('Purpose: vacation home'); }

  let investorScore = 0;
  const isInvestor = String(fq.client_type || '').toLowerCase() === 'investor' || pp === 'investment';
  if (isInvestor) {
    investorScore += 4;
    reasons.push('Client type: investor');
    if (fq.investment_type) {
      investorScore += 3;
      reasons.push(`Investment type: ${String(fq.investment_type).replace(/_/g, ' ')}`);
    }
    if (fq.owns_investments === 'yes') {
      investorScore += 3;
      reasons.push('Owns other investment properties');
    } else if (fq.owns_investments === 'no') {
      investorScore += 1;
      reasons.push('First investment property');
    }
    if (fq.investment_financing && fq.investment_financing !== 'not_sure') {
      investorScore += 2;
      reasons.push(`Financing path: ${String(fq.investment_financing).replace(/_/g, ' ')}`);
    }
    if (fq.borrower_entity === 'company') reasons.push('Borrowing through a company');
  }

  let urgencyScore = 0;
  const us = fq.urgency_signal;
  if (us === 'yes') {
    urgencyScore = 5;
    reasons.push(isInvestor ? 'Urgency: would start on investment deals immediately' : 'Urgency: would start house hunting immediately');
  }
  else if (us === 'maybe') { urgencyScore = 3; reasons.push('Urgency: maybe'); }
  else if (us === 'no') { urgencyScore = 0; reasons.push('Urgency: no'); }

  const finalScore = Math.min(
    timelineScore + preApprovalScore + creditScore + employmentScore +
    incomeScore + downPaymentScore + budgetScore + purposeScore + investorScore + urgencyScore,
    100
  );

  const quality =
    finalScore >= 80 ? 'hot'
    : finalScore >= 60 ? 'warm'
    : 'cold';

  const signals = {
    ...seedSignals,
    timeline: fq.mortgage_timeline,
    budget:   seedSignals?.budget || null,
  };

  return {
    leadScore: finalScore,
    leadGrade: quality,
    leadMeta: {
      qualified:    quality === 'hot' || quality === 'warm',
      lead_reasons: reasons,
      sub_scores:   {
        timelineScore, preApprovalScore, creditScore, employmentScore,
        incomeScore, downPaymentScore, budgetScore, purposeScore, investorScore, urgencyScore,
      },
      signals,
      ...(hasContact && contactInfo ? { contact: contactInfo } : {}),
    },
  };
};

export const createMortgageLeadRecords = async ({
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
  activeIcpProfileId,
  messageSnippet,
  formContact,
  aiDetails,
}) => {
  const signals  = leadMeta.signals || {};
  const now      = new Date();
  const fq       = formContact || {};
  const ai       = aiDetails || {};
  const purchasePurpose = ai.purchase_purpose || fq.purchase_purpose || '';
  const clientType = String(
    fq.client_type || ai.client_type || (purchasePurpose === 'investment' ? 'investor' : ''),
  ).toLowerCase();
  const leadType = buildMortgageBrokerLeadType(leadGrade, clientType);
  const investmentType = ai.investment_type || fq.investment_type || '';
  const ownsInvestments = ai.owns_investments || fq.owns_investments || '';
  const investmentFinancing = fq.investment_financing || ai.investment_financing || '';
  const borrowerEntity = fq.borrower_entity || ai.borrower_entity || '';
  const marketCountry = marketChoiceFromForm(fq) || marketCountryFromForm({
    market_country: ai.market_country,
    market_region: ai.market_region,
    address: ai.property_address,
    location: ai.location,
  });
  const marketRegion = normalizeMarketRegion(fq.market_region || ai.market_region, marketCountry)
    || String(fq.market_region || ai.market_region || '').trim();
  const marketCity = String(fq.market_city || ai.market_city || '').trim();
  const marketCountryName = String(fq.market_country_name || ai.market_country_name || '').trim();

  const bedroomsVal = signals.beds ?? ai.bedrooms ?? fq.beds ?? '';
  const bathroomsVal = signals.baths ?? ai.bathrooms ?? fq.baths ?? '';
  const areaVal = signals.area ?? ai.area ?? fq.area ?? '';
  const locationVal = signals.location || ai.location || ai.property_address || '';
  const addressVal = contactInfo.address || ai.property_address || locationVal || '';

  const { budgetStr: mbBudgetStr } = partitionBuyerBudgetInputs(fq.budget, ai.budget);

  const { leadProfile, reusedExisting } = await createOrReuseLeadProfile({
    payload: {
      intent: 'unspecified',
      identity: {
        full_name: contactInfo.name || 'Unknown',
        email: contactInfo.email || '',
        phone: contactInfo.phone || '',
      },
      contact_preferences: {
        preferred_contact_method: fq.preferred_contact_method || ai.preferred_contact_method || '',
        best_time_to_contact: fq.best_time_to_contact || ai.best_time_to_contact || '',
      },
      property: {
        address: addressVal,
        location: locationVal,
        budget: mbBudgetStr || '',
        expected_price: '',
        timeline: fq.mortgage_timeline || ai.mortgage_timeline || '',
        bedrooms: bedroomsVal ? String(bedroomsVal) : '',
        bathrooms: bathroomsVal ? String(bathroomsVal) : '',
        square_footage: areaVal,
      },
      qualification: {
        mortgage_broker: {
          mortgage_timeline: ai.mortgage_timeline || fq.mortgage_timeline || '',
          pre_approval_status: ai.pre_approval_status || fq.pre_approval_status || '',
          credit_score_range: ai.credit_score_range || fq.credit_score_range || '',
          employment_status: ai.employment_status || fq.employment_status || '',
          household_income: ai.household_income || fq.household_income || '',
          down_payment_readiness: ai.down_payment_readiness || fq.down_payment_readiness || '',
          purchase_purpose: purchasePurpose,
          urgency_signal: ai.urgency_signal || fq.urgency_signal || '',
          property_budget: fq.property_budget || ai.property_budget || '',
          investment_type: investmentType,
          owns_investments: ownsInvestments,
          investment_financing: investmentFinancing,
          borrower_entity: borrowerEntity,
          market_country: marketCountry,
          market_region: marketRegion,
          ...(marketCity ? { market_city: marketCity } : {}),
          ...(marketCountryName ? { market_country_name: marketCountryName } : {}),
        },
      },
      ...(marketCountry ? { budget_profile: { currency: marketCurrency() } } : {}),
      ...(clientType ? { client_type: clientType } : {}),
      ...(clientType === 'investor' || investmentType || ownsInvestments
        ? {
            template_answers: {
              ...(investmentType ? { investment_type: investmentType } : {}),
              ...(ownsInvestments ? { owns_investments: ownsInvestments } : {}),
              ...(purchasePurpose ? { purpose: purchasePurpose } : {}),
              ...(investmentFinancing ? { investment_financing: investmentFinancing } : {}),
              ...(borrowerEntity ? { borrower_entity: borrowerEntity } : {}),
            },
          }
        : {}),
      source: 'chatbot',
      total_score: leadScore,
    },
    userId,
    professionalType: PROFESSIONAL_TYPE.MORTGAGE_BROKER,
    contactInfo,
    leadGrade,
  });

  let icpFit = null;
  try {
    icpFit = await computeIcpFitForLead(leadProfile, userId, { reusedExisting, activeIcpProfileId });
  } catch (err) {
    logger.warn('ICP scoring failed, skipping', { error: err.message });
  }

  const leadMatch = await createValidatedLeadMatch({
    user_id:                 userId,
    professional_profile_id: professionalProfileId,
    conversation_id:         conversation._id,
    lead_type:               leadType,
    lead_profile_id:         leadProfile._id,
    match_score:             leadScore,
    match_status:            'new',
    contact_count:           1,
    first_contact_at:        now,
    last_contact_at:        now,
    compatibility_factors: {
      session_id:      sessionId,
      embed_token:     embedToken,
      agent_type:      conversation.agent_type,
      intent:          'unspecified',
      lead_grade:      leadGrade,
      message_snippet: messageSnippet,
      contact:         contactInfo,
      matched:         leadGrade === 'hot' || leadGrade === 'warm',
      professional_type: PROFESSIONAL_TYPE.MORTGAGE_BROKER,
      repeat_visitor: reusedExisting,
      ...(clientType ? { client_type: clientType } : {}),
      ...(purchasePurpose ? { purchase_purpose: purchasePurpose } : {}),
      ...(investmentType ? { investment_type: investmentType } : {}),
      ...(ownsInvestments ? { owns_investments: ownsInvestments } : {}),
      ...(investmentFinancing ? { investment_financing: investmentFinancing } : {}),
      ...(marketCountry ? { market_country: marketCountry } : {}),
    },
    ...(icpFit
      ? {
          icp_fit: {
            fit_score: icpFit.fit_score,
            fit_tier: icpFit.fit_tier,
            matched_factors: icpFit.matched_factors,
            missing_factors: icpFit.missing_factors,
          },
        }
      : {}),
  });

  await createValidatedLeadAttribution({
    lead_type:       leadType,
    source:          'chatbot',
    converted:       false,
    lead_profile_id: leadProfile._id,
    lead_match_id:   leadMatch._id,
    session_id:     sessionId,
    ip_address:     clientIp  || '',
    user_agent:     userAgent || '',
    referrer_url:   referer   || '',
    initial_score:  leadScore,
    initial_quality: leadGrade,
  });

  await bumpLeadProfileStats(leadProfile._id, 'unspecified', leadType);

  logger.info(`Mortgage lead created: ${leadType} | score: ${leadScore} | conversation: ${conversation._id}`);

  return leadMatch;
};
