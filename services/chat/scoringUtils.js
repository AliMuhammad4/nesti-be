import LeadProfile from '../../models/LeadProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadAttribution from '../../models/LeadAttribution.js';
import logger from '../../utils/logger.js';

export const GRADE_ORDER = { hot: 3, warm: 2, cold: 1, unscored: 0 };
const KNOWN_CITIES = [
  'lahore', 'karachi', 'islamabad', 'clifton', 'dha', 'london',
  'dubai', 'new york', 'miami', 'los angeles', 'chicago', 'toronto',
];
export const extractSignals = (message = '') => {
  const text = String(message || '').toLowerCase();
  let timeline = null;
  if (/asap|immediately|right away|as soon as possible|urgent/.test(text)) {
    timeline = 'asap';
  } else if (/\d+\s*(week|month)s?/.test(text)) {
    const m = text.match(/(\d+)\s*(week|month)/);
    if (m) {
      const months = m[2] === 'week'
        ? Math.ceil(parseInt(m[1], 10) / 4)
        : parseInt(m[1], 10);
      if (months <= 3)       timeline = 'asap';
      else if (months <= 12) timeline = '6-12 months';
      else                   timeline = '12+';
    }
  } else if (/6.{0,5}month|half a year/.test(text)) {
    timeline = '6-12 months';
  } else if (/\byear\b|12 month|next year/.test(text)) {
    timeline = '12+';
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
  const bedsM  = text.match(/(\d+)\s*(?:bed(?:room)?s?|br)/);
  const bathsM = text.match(/(\d+)\s*(?:bath(?:room)?s?|ba)/);
  const beds   = bedsM  ? parseInt(bedsM[1],  10) : null;
  const baths  = bathsM ? parseInt(bathsM[1], 10) : null;
  const areaM = text.match(/(\d[\d,]*)\s*(?:sq\.?\s*ft|square\s*feet|sqft|marla)/i);
  const area  = areaM ? `${areaM[1].replace(/,/g, '')} SQFT` : null;
  let location = null;
  const inM = String(message || '').match(/\bin\s+([A-Z][a-zA-Z\s]{2,20})/);
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
const calculateScore = ({ timeline, budget, interactionCount, hasContact }) => {
  let timelineScore   = 0;
  let budgetScore     = 0;
  let engagementScore = 0;
  let contactBoost    = 0;
  const reasons       = [];
  if (timeline === 'asap') {
    timelineScore = 30;
    reasons.push('Urgent timeline (ASAP)');
  } else if (timeline === '6-12 months') {
    timelineScore = 20;
    reasons.push('Timeline within 6–12 months');
  } else if (timeline === '12+') {
    timelineScore = 10;
    reasons.push('Long-term timeline (12+ months)');
  }
  if (budget === 'pre-approved') {
    budgetScore = 25;
    reasons.push('Pre-approved or cash buyer');
  } else if (budget) {
    const numM = budget.match(/[\d.]+/);
    const num  = numM ? parseFloat(numM[0]) : 0;
    const val  = budget.includes('M') ? num * 1_000_000 : num * 1_000;
    if (val >= 500_000)      { budgetScore = 20; reasons.push(`High budget: ${budget}`); }
    else if (val >= 200_000) { budgetScore = 15; reasons.push(`Moderate budget: ${budget}`); }
    else if (val > 0)        { budgetScore =  8; reasons.push(`Budget stated: ${budget}`); }
  }
  if (interactionCount >= 10)     { engagementScore = 20; reasons.push('Highly engaged (10+ messages)'); }
  else if (interactionCount >= 5) { engagementScore = 15; reasons.push('Engaged (5+ messages)'); }
  else if (interactionCount >= 2) { engagementScore =  8; reasons.push('Initial engagement'); }
  if (hasContact) {
    contactBoost = 15;
    reasons.push('Contact information provided');
  }
  const finalScore = Math.min(timelineScore + budgetScore + engagementScore + contactBoost, 100);
  const quality    = finalScore >= 70 ? 'hot' : finalScore >= 40 ? 'warm' : 'cold';
  return {
    finalScore,
    quality,
    reasons,
    subScores: { timelineScore, budgetScore, engagementScore, contactBoost },
  };
};
export const scoreLead = ({ message, hasContact, contactInfo, interactionCount, seedSignals = {} }) => {
  const rawSignals  = extractSignals(message);
  const signals     = mergeSignals(rawSignals, seedSignals);
  const { finalScore, quality, reasons, subScores } = calculateScore({
    timeline:         signals.timeline,
    budget:           signals.budget,
    interactionCount,
    hasContact,
  });
  return {
    leadScore: finalScore,
    leadGrade: quality,
    leadMeta: {
      qualified:    quality === 'hot' || quality === 'warm',
      lead_reasons: reasons,
      sub_scores: {
        timeline_score:   subScores.timelineScore,
        budget_score:     subScores.budgetScore,
        engagement_score: subScores.engagementScore,
        contact_boost:    subScores.contactBoost,
      },
      signals,
      ...(hasContact && contactInfo ? { contact: contactInfo } : {}),
    },
  };
};
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
    property_type:    null,
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

