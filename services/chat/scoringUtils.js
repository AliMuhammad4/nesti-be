import LeadProfile from '../../models/LeadProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadAttribution from '../../models/LeadAttribution.js';
import logger from '../../utils/logger.js';

export const GRADE_ORDER = { hot: 4, warm: 3, lukewarm: 2, cold: 1, unscored: 0 };

// ─── Signal Extraction ─────────────────────────────────────────────────────────

const KNOWN_CITIES = [
  'lahore', 'karachi', 'islamabad', 'clifton', 'dha', 'london',
  'dubai', 'new york', 'miami', 'los angeles', 'chicago', 'toronto',
];

export const extractSignals = (message = '') => {
  const text = String(message || '').toLowerCase();

  let timeline = null;
  if (/asap|immediately|right away|as soon as possible|urgent/.test(text)) {
    timeline = 'asap';
  } else if (/\b(1|one|2|two|3|three)\s*(week|month)s?\b/.test(text)) {
    timeline = '1-3 months';
  } else if (/\b(3|three|4|four|5|five|6|six)\s*month/.test(text)) {
    timeline = '3-6 months';
  } else if (/6.{0,5}month|half a year|6-12 months|within a year/i.test(text)) {
    timeline = '6-12 months';
  } else if (/\byear\b|12 month|next year|just browsing/i.test(text)) {
    timeline = 'browsing';
  }

  let budget = null;
  if (/pre.?approv|cash buyer|all.?cash/.test(text)) {
    budget = 'pre-approved';
  } else {
    const m = text.match(/\$?([\d,]+)\s*(k|thousand|m|million)?/i);
    if (m) {
      let amount = parseFloat(m[1].replace(/,/g, ''));
      const unit = (m[2] || '').toLowerCase();
      if (unit === 'k' || unit === 'thousand') amount *= 1_000;
      if (unit === 'm' || unit === 'million')  amount *= 1_000_000;
      if (amount >= 1_000) {
        budget = amount >= 1_000_000
          ? `$${(amount / 1_000_000).toFixed(1)}M`
          : `$${Math.round(amount / 1_000)}K`;
      }
    }
  }

  const bedsM  = text.match(/(\d+)\s*(?:bed(?:room)?s?|br)\b/);
  const bathsM = text.match(/(\d+)\s*(?:bath(?:room)?s?|ba)\b/);
  const beds   = bedsM  ? parseInt(bedsM[1],  10) : null;
  const baths  = bathsM ? parseInt(bathsM[1], 10) : null;

  const areaM = text.match(/(\d[\d,]*)\s*(?:sq\.?\s*ft|square\s*feet|sqft|marla)/i);
  const area  = areaM ? `${areaM[1].replace(/,/g, '')} SQFT` : null;

  let location = null;
  const inM = String(message || '').match(/\bin\s+([A-Z][a-zA-Z\s]{2,40})/);
  if (inM) {
    location = inM[1].trim();
  } else {
    for (const city of KNOWN_CITIES) {
      if (text.includes(city)) {
        location = city.charAt(0).toUpperCase() + city.slice(1);
        break;
      }
    }
  }

  return { timeline, budget, beds, baths, area, location };
};

export const mergeSignals = (base, patch) => ({
  timeline: patch?.timeline || base.timeline || null,
  budget:   patch?.budget   || base.budget   || null,
  beds:     patch?.beds     ?? base.beds     ?? null,
  baths:    patch?.baths    ?? base.baths    ?? null,
  area:     patch?.area     || base.area     || null,
  location: patch?.location || base.location || null,
});

/** Derive qualification fields from conversation text (for lead profile when AI hasn't extracted) */
export const deriveQualificationFromText = (text = '') => {
  const t = String(text || '').toLowerCase();
  const out = {};

  if (/no (realtor|agent)|don'?t have (a )?(realtor|agent)|not working with (a )?(realtor|agent)/i.test(t)) {
    out.realtor_status = 'no_agent';
  } else if (/have (a )?(realtor|agent) but open|working with.*but open/i.test(t)) {
    out.realtor_status = 'has_agent_but_open';
  } else if (/have (a )?(realtor|agent)|working with (a )?(realtor|agent)/i.test(t)) {
    out.realtor_status = 'has_exclusive_agent';
  }

  if (/relocat|job transfer|new job|moving for work/i.test(t)) out.motivation_reason = 'relocation';
  else if (/divorce/i.test(t)) out.motivation_reason = 'divorce';
  else if (/new baby|growing family|family is growing|expanding family/i.test(t)) out.motivation_reason = 'family_change';
  else if (/investment/i.test(t)) out.motivation_reason = 'investment';
  else if (/upgrad(e|ing)|bigger home|more space/i.test(t)) out.motivation_reason = 'upgrading';
  else if (/downsiz(e|ing)|smaller place/i.test(t)) out.motivation_reason = 'downsizing';
  else if (/just browsing|just looking|just exploring|not sure yet/i.test(t)) out.motivation_reason = 'just_exploring';

  if ((/view(ing)?\s*(homes|properties)|schedule\s*(a\s*)?(tour|viewing)|start viewing/i.test(t)) && /asap|immediately|this week|today/i.test(t)) {
    out.viewing_readiness = 'asap';
  } else if (/view(ing)?\s*(homes|properties)|schedule\s*(a\s*)?(tour|viewing)|within a few weeks/i.test(t)) {
    out.viewing_readiness = 'few_weeks';
  } else if (/maybe later|not ready yet/i.test(t)) {
    out.viewing_readiness = 'maybe_later';
  } else if (/just browsing|just looking/i.test(t)) {
    out.viewing_readiness = 'just_browsing';
  }

  if ((/rent(ing)?|tenant/i.test(t)) && !/own/i.test(t)) out.living_situation = 'renting';
  else if (/own.*need to sell|sell my (current )?home/i.test(t)) out.living_situation = 'own_need_to_sell';
  else if (/own(s|ing)?/i.test(t)) out.living_situation = 'own_not_selling';

  if (/if.*perfect home.*tomorrow.*make an offer|ready to (make an offer|buy|close)/i.test(t)) out.urgency_readiness = 'yes_immediately';
  else if (/might make an offer|maybe make an offer|thinking about it/i.test(t)) out.urgency_readiness = 'maybe';
  else if (/not ready|no rush|take my time/i.test(t)) out.urgency_readiness = 'no';

  return out;
};

// ─── Score Calculation (aligned with 25‑point NESTI spec) ─────────────────────

const calculateScore = ({ message, signals, interactionCount, hasContact, formQualification }) => {
  const text = String(message || '').toLowerCase();
  const fq   = formQualification || {};
  const reasons = [];

  // 1. Timeline to Buy/Sell (max 20)
  let timelineScore = 0;
  switch (signals.timeline) {
    case 'asap':
      timelineScore = 20;
      reasons.push('Timeline: 0–1 month (immediate)');
      break;
    case '1-3 months':
      timelineScore = 18;
      reasons.push('Timeline: 1–3 months');
      break;
    case '3-6 months':
      timelineScore = 12;
      reasons.push('Timeline: 3–6 months');
      break;
    case '6-12 months':
      timelineScore = 6;
      reasons.push('Timeline: 6–12 months');
      break;
    default:
      break;
  }

  // 2. Mortgage / Financing Status (max 15)
  // Check structured form data first, then fall back to regex on message text
  let mortgageScore = 0;
  const ms = fq.mortgage_status;
  if (ms === 'fully_pre_approved') {
    mortgageScore = 15;
    reasons.push('Financing: fully pre-approved');
  } else if (ms === 'paying_cash') {
    mortgageScore = 15;
    reasons.push('Financing: paying cash');
  } else if (ms === 'in_progress') {
    mortgageScore = 10;
    reasons.push('Financing: pre-approval in progress');
  } else if (ms === 'not_yet') {
    mortgageScore = 3;
    reasons.push('Financing: not yet started');
  } else if (ms === 'unsure') {
    mortgageScore = 0;
    reasons.push('Financing: unsure');
  } else if (/fully pre.?approv|pre.?approv(ed)?/.test(text)) {
    mortgageScore = 15;
    reasons.push('Financing: fully pre-approved');
  } else if (/cash buyer|all cash|paying cash/.test(text)) {
    mortgageScore = 15;
    reasons.push('Financing: paying cash');
  } else if (/pre.?approval in progress|working on pre.?approval/.test(text)) {
    mortgageScore = 10;
    reasons.push('Financing: pre-approval in progress');
  } else if (/not yet pre.?approv|no pre.?approval/.test(text)) {
    mortgageScore = 3;
    reasons.push('Financing: not yet started');
  } else if (/unsure|not sure|don'?t know/i.test(text) && /mortgage|financ|pre.?approv/i.test(text)) {
    mortgageScore = 0;
    reasons.push('Financing: unsure');
  }

  // 3. Budget Defined (max 10)
  let budgetScore = 0;
  if (signals.budget) {
    if (signals.budget.includes('-')) {
      budgetScore = 7;
      reasons.push('Budget: approximate range provided');
    } else {
      budgetScore = 10;
      reasons.push('Budget: exact budget defined');
    }
  } else if (/budget|price range|how much/i.test(text)) {
    budgetScore = 2;
    reasons.push('Budget: discussed but not clearly defined');
  }

  // 4. Realtor Status (max 10) — form first, then regex
  let realtorScore = 0;
  const rs = fq.realtor_status;
  if (rs === 'no_agent') {
    realtorScore = 10;
    reasons.push('Realtor: no agent (highest value)');
  } else if (rs === 'has_agent_but_open') {
    realtorScore = 5;
    reasons.push('Realtor: has agent but open to others');
  } else if (rs === 'has_exclusive_agent') {
    realtorScore = 0;
    reasons.push('Realtor: exclusively working with an agent');
  } else if (/no (realtor|agent)|don'?t have (a )?(realtor|agent)|not working with (a )?(realtor|agent)/i.test(text)) {
    realtorScore = 10;
    reasons.push('Realtor: no agent (highest value)');
  } else if (/have (a )?(realtor|agent) but open|working with.*but open/i.test(text)) {
    realtorScore = 5;
    reasons.push('Realtor: has agent but open to others');
  } else if (/have (a )?(realtor|agent)|working with (a )?(realtor|agent)/i.test(text)) {
    realtorScore = 0;
    reasons.push('Realtor: exclusively working with an agent');
  }

  // 5. Motivation Reason (max 10) — form first, then regex
  let motivationScore = 0;
  const mr = fq.motivation_reason;
  if (['relocation', 'family_change', 'divorce', 'investment'].includes(mr)) {
    motivationScore = 10;
    reasons.push('Motivation: strong (relocation/family/divorce/investment)');
  } else if (['upgrading', 'downsizing'].includes(mr)) {
    motivationScore = 6;
    reasons.push('Motivation: medium (upgrading/downsizing)');
  } else if (mr === 'just_exploring') {
    motivationScore = 0;
    reasons.push('Motivation: low (just exploring)');
  } else if (/relocat|job transfer|new job|moving for work/.test(text)
    || /divorce/.test(text)
    || /new baby|growing family|family is growing|expanding family/.test(text)
    || /investment/.test(text)) {
    motivationScore = 10;
    reasons.push('Motivation: strong (relocation/family/divorce/investment)');
  } else if (/upgrad(e|ing)|bigger home|more space/.test(text)
    || /downsiz(e|ing)|smaller place/.test(text)) {
    motivationScore = 6;
    reasons.push('Motivation: medium (upgrading/downsizing)');
  } else if (/just browsing|just looking|just exploring|not sure yet/.test(text)) {
    motivationScore = 0;
    reasons.push('Motivation: low (just exploring)');
  }

  // 6. Property Viewing Readiness (max 10) — form first, then regex
  let viewingScore = 0;
  const vr = fq.viewing_readiness;
  if (vr === 'asap') {
    viewingScore = 10;
    reasons.push('Viewing: wants to start ASAP');
  } else if (vr === 'few_weeks') {
    viewingScore = 8;
    reasons.push('Viewing: within a few weeks');
  } else if (vr === 'maybe_later') {
    viewingScore = 3;
    reasons.push('Viewing: maybe later');
  } else if ((/view(ing)?\s*(homes|properties)|schedule\s*(a\s*)?(tour|viewing)|start viewing/i.test(text))
    && (/asap|immediately|this week|today/i.test(text))) {
    viewingScore = 10;
    reasons.push('Viewing: wants to start ASAP');
  } else if (/view(ing)?\s*(homes|properties)|schedule\s*(a\s*)?(tour|viewing)|within a few weeks/i.test(text)) {
    viewingScore = 8;
    reasons.push('Viewing: within a few weeks');
  } else if (/maybe later|not ready yet/i.test(text)) {
    viewingScore = 3;
    reasons.push('Viewing: maybe later');
  }

  // 7. Current Living Situation (max 5) — form first, then regex
  let livingScore = 0;
  const ls = fq.living_situation;
  if (ls === 'renting') {
    livingScore = 5;
    reasons.push('Living: currently renting');
  } else if (ls === 'own_need_to_sell') {
    livingScore = 3;
    reasons.push('Living: owns and needs to sell');
  } else if (ls === 'own_not_selling') {
    livingScore = 1;
    reasons.push('Living: owns property');
  } else if ((/rent(ing)?|tenant/i.test(text)) && !/own/i.test(text)) {
    livingScore = 5;
    reasons.push('Living: currently renting');
  } else if (/own.*need to sell|sell my (current )?home/.test(text)) {
    livingScore = 3;
    reasons.push('Living: owns and needs to sell');
  } else if (/own(s|ing)?/i.test(text)) {
    livingScore = 1;
    reasons.push('Living: owns property');
  }

  // 8. Area / Location Defined (max 5)
  let areaScore = 0;
  if (signals.location) {
    if (/\b(neighbourhood|neighborhood|area|block|sector|phase|street)\b/i.test(signals.location)
      || /\d/.test(signals.location)) {
      areaScore = 5;
      reasons.push('Location: specific neighbourhood/area');
    } else {
      areaScore = 3;
      reasons.push('Location: general area');
    }
  }

  // 9. Urgency Behaviour (max 5) — form first, then regex
  let urgencyScore = 0;
  const ur = fq.urgency_readiness;
  if (ur === 'yes_immediately') {
    urgencyScore = 5;
    reasons.push('Urgency: would make an offer immediately');
  } else if (ur === 'maybe') {
    urgencyScore = 3;
    reasons.push('Urgency: maybe would make an offer');
  } else if (/if.*perfect home.*tomorrow.*make an offer|ready to (make an offer|buy|close)/i.test(text)) {
    urgencyScore = 5;
    reasons.push('Urgency: would make an offer immediately');
  } else if (/might make an offer|maybe make an offer|thinking about it/i.test(text)) {
    urgencyScore = 3;
    reasons.push('Urgency: maybe would make an offer');
  }

  // 10. Engagement Score (max 5)
  let engagementScore = 0;
  if (interactionCount >= 10) {
    engagementScore = 5;
    reasons.push('Engagement: very high (10+ messages)');
  } else if (interactionCount >= 5) {
    engagementScore = 4;
    reasons.push('Engagement: high (5+ messages)');
  } else if (interactionCount >= 2) {
    engagementScore = 3;
    reasons.push('Engagement: moderate');
  } else if (interactionCount >= 1) {
    engagementScore = 1;
    reasons.push('Engagement: initial');
  }

  // 11. Contact completeness boost (max 5)
  const contactBoost = hasContact ? 5 : 0;
  if (hasContact) {
    reasons.push('Contact: details provided');
  }

  const finalScore = Math.min(
    timelineScore + mortgageScore + budgetScore + realtorScore +
    motivationScore + viewingScore + livingScore + areaScore +
    urgencyScore + engagementScore + contactBoost,
    100
  );

  // Temperature bands: 80-100 HOT, 60-79 WARM, 40-59 LUKEWARM, 0-39 COLD
  const quality =
    finalScore >= 80 ? 'hot'
    : finalScore >= 60 ? 'warm'
    : finalScore >= 40 ? 'lukewarm'
    : 'cold';

  return {
    finalScore,
    quality,
    reasons,
    subScores: {
      timelineScore,
      mortgageScore,
      budgetScore,
      realtorScore,
      motivationScore,
      viewingScore,
      livingScore,
      areaScore,
      urgencyScore,
      engagementScore,
      contactBoost,
    },
  };
};

const TIMELINE_ALIASES = {
  asap: ['asap', 'immediately', 'urgent', 'within 1 month', 'this month', 'right away', 'as soon as possible'],
  '1-3 months': ['1-3 months', '1 to 3 months', 'within 2 months', 'within 3 months', '2 months', '3 months'],
  '3-6 months': ['3-6 months', '3 to 6 months', '4 months', '5 months', '6 months'],
  '6-12 months': ['6-12 months', '6 to 12 months', 'within a year', 'next year'],
  browsing: ['browsing', 'just looking', 'exploring', 'no rush', 'not sure'],
};

export const normalizeTimeline = (v) => {
  if (!v || typeof v !== 'string') return null;
  const t = v.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(TIMELINE_ALIASES)) {
    if (t === canonical || aliases.some((a) => t.includes(a))) return canonical;
  }
  return null;
};

/** Merge AI-extracted details with form qualification for scoring. AI values take precedence when non-empty. */
export const mergeQualificationForScoring = (formQualification = {}, aiDetails = {}) => {
  const fq = formQualification || {};
  const ai = aiDetails || {};
  const pick = (key) => (ai[key] && String(ai[key]).trim() ? ai[key] : fq[key]) || null;
  return {
    mortgage_status:    pick('mortgage_status'),
    realtor_status:     pick('realtor_status'),
    motivation_reason:  pick('motivation_reason'),
    viewing_readiness:  pick('viewing_readiness'),
    living_situation:   pick('living_situation'),
    urgency_readiness:  pick('urgency_readiness'),
  };
};

export const scoreLead = ({ message, hasContact, contactInfo, interactionCount, seedSignals = {}, formQualification = {} }) => {
  const rawSignals = extractSignals(message);
  const signals    = mergeSignals(rawSignals, seedSignals);

  const { finalScore, quality, reasons, subScores } = calculateScore({
    message,
    signals,
    interactionCount,
    hasContact,
    formQualification,
  });

  return {
    leadScore: finalScore,
    leadGrade: quality,
    leadMeta: {
      qualified:    quality === 'hot' || quality === 'warm',
      lead_reasons: reasons,
      sub_scores:   subScores,
      signals,
      ...(hasContact && contactInfo ? { contact: contactInfo } : {}),
    },
  };
};

// ─── Classification & persistence helpers ─────────────────────────────────────

export const buildLeadType = (grade, intent) =>
  `${grade}_${intent === 'sell' ? 'seller' : 'buyer'}`;

export const buildLeadClassification = (grade, intent) => {
  const g = grade.charAt(0).toUpperCase() + grade.slice(1);
  const i = intent === 'sell' ? 'Seller' : 'Buyer';
  return `${g} ${i}`;
};

export const bestGrade = (a, b) =>
  (GRADE_ORDER[a] || 0) >= (GRADE_ORDER[b] || 0) ? a : b;

export const createLeadRecords = async ({
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
}) => {
  const leadType = buildLeadType(leadGrade, intent);
  const signals  = leadMeta.signals || {};
  const now      = new Date();

  const leadProfile = await LeadProfile.create({
    intent,
    full_name:        contactInfo.name    || 'Unknown',
    email:            contactInfo.email   || '',
    phone:            contactInfo.phone   || '',
    property_address: contactInfo.address || '',
    location:         signals.location    || '',
    budget:           signals.budget      || '',
    expected_price:   intent === 'sell' ? (signals.budget || '') : '',
    timeline:         signals.timeline    || '',
    bedrooms:         signals.beds  != null ? String(signals.beds)  : '',
    bathrooms:        signals.baths != null ? String(signals.baths) : '',
    square_footage:   signals.area        || '',
    property_type:    formContact?.property_type || aiDetails?.property_type || '',
    must_have_features:      formContact?.must_have_features || '',
    parking_required:        formContact?.parking_required || '',
    backyard_needed:         formContact?.backyard_needed || '',
    school_district_important: formContact?.school_district_important || '',
    preferred_contact_method: formContact?.preferred_contact_method || '',
    best_time_to_contact:     formContact?.best_time_to_contact || '',
    mortgage_status:    aiDetails?.mortgage_status || formContact?.mortgage_status || '',
    realtor_status:     formContact?.realtor_status || aiDetails?.realtor_status || '',
    motivation_reason:  formContact?.motivation_reason || aiDetails?.motivation_reason || '',
    viewing_readiness:  formContact?.viewing_readiness || aiDetails?.viewing_readiness || '',
    living_situation:   formContact?.living_situation || aiDetails?.living_situation || '',
    urgency_readiness:  formContact?.urgency_readiness || aiDetails?.urgency_readiness || '',
    source:           'chatbot',
    total_score:      leadScore,
  });

  const leadMatch = await LeadMatch.create({
    user_id:                 userId,
    professional_profile_id: professionalProfileId,
    conversation_id:         conversation._id,
    lead_type:               leadType,
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
      intent,
      lead_grade:      leadGrade,
      message_snippet: messageSnippet,
      contact:         contactInfo,
      matched:         leadGrade === 'hot' || leadGrade === 'warm',
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

  logger.info(`Lead created: ${leadType} | score: ${leadScore} | conversation: ${conversation._id}`);

  return leadMatch;
};
