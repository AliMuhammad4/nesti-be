function text(value) {
  return String(value || '').trim();
}

const PAINS = {
  agent: [
    { id: 'missed', label: 'missed opportunities', feature: 'pipeline', pattern: /miss(ed|ing)? (a )?lead|lost lead|slip(ped)? through/i },
    { id: 'follow_up', label: 'lead follow-up', feature: 'pipeline', pattern: /follow[- ]?up|can't keep up with leads|not calling (them )?back/i },
    { id: 'crm', label: 'CRM', feature: 'pipeline', pattern: /\bcrm\b|scattered leads|lead inbox/i },
    { id: 'booking', label: 'booking', feature: 'voice agent', pattern: /\bbook(ing| a)?\b|appointment|schedule a (call|showing)|calendar/i },
    { id: 'nurturing', label: 'nurturing', feature: 'nurture', pattern: /nurtur|stay in touch|drip/i },
    { id: 'website', label: 'website', feature: 'storefront', pattern: /website|web page|storefront|own page/i },
    { id: 'organization', label: 'organization', feature: 'pipeline', pattern: /organiz|too many leads|can't keep track/i },
  ],
  broker: [
    { id: 'rates', label: 'rate questions', feature: 'chatbot', pattern: /rate question|interest rate|same rate|repetitive.*(rate|mortgage)|rate.*(again|over and over)/i },
    { id: 'qualification', label: 'qualification', feature: 'chatbot', pattern: /qualif|pre-?approv|who qualifies/i },
    { id: 'affordability', label: 'affordability', feature: 'chatbot', pattern: /afford/i },
    { id: 'education', label: 'client education', feature: 'chatbot', pattern: /educat|explain (the |a )?mortgage|don't understand/i },
    { id: 'follow_up', label: 'follow-up', feature: 'nurture', pattern: /follow[- ]?up/i },
  ],
  lawyer: [
    { id: 'closing', label: 'closing inquiries', feature: 'chatbot', pattern: /closing (question|inquir)|repetitive closing|same closing/i },
    { id: 'repetitive', label: 'repetitive inquiries', feature: 'chatbot', pattern: /repetit|same question|over and over|again and again/i },
    { id: 'intake', label: 'client intake', feature: 'chatbot', pattern: /\bintake\b|onboard/i },
    { id: 'booking', label: 'consultation booking', feature: 'voice agent', pattern: /consult|appointment|\bbook(ing)?\b/i },
    { id: 'organization', label: 'organization', feature: 'pipeline', pattern: /organiz|files everywhere|can't find the file/i },
  ],
  client: [
    { id: 'investing', label: 'investing', feature: 'match', pattern: /invest/i },
    { id: 'finding', label: 'finding professionals', feature: 'match', pattern: /find (an |a )?(agent|broker|lawyer)|compar(e|ing) (professionals|agents)|which professional/i },
    { id: 'affordability', label: 'affordability', feature: 'budget tools', pattern: /afford|budget|how much can i/i },
    { id: 'uncertainty', label: 'uncertainty', feature: 'support', pattern: /overwhelm|unsure|first[- ]time|don't know where|nervous|hesitant/i },
    { id: 'buying', label: 'buying or selling', feature: 'match', pattern: /\b(buy|buying|sell|selling|purchase)\b/i },
  ],
};

const FEATURE_WORDS = {
  pipeline: /pipeline|follow-up|follow up|crm/i,
  nurture: /nurtur/i,
  storefront: /storefront|web page|website/i,
  chatbot: /chatbot/i,
  'voice agent': /voice agent|answers calls/i,
  match: /match|agent, a mortgage|professionals/i,
  'budget tools': /budget/i,
  support: /support/i,
};

export function roleKey(role) {
  const raw = text(role)
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

  if (raw.includes('mortgage') || raw.includes('broker')) return 'broker';
  if (raw.includes('lawyer')) return 'lawyer';
  if (raw.includes('agent') || raw.includes('realtor')) return 'agent';
  return 'client';
}

export function detectPain(role, value) {
  const spoken = text(value);
  if (!spoken) return null;
  return (PAINS[roleKey(role)] || []).find((item) => item.pattern.test(spoken)) || null;
}

export function painById(role, id) {
  const key = text(id);
  if (!key) return null;
  return (PAINS[roleKey(role)] || []).find((item) => item.id === key) || null;
}

export function featurePattern(feature) {
  return FEATURE_WORDS[text(feature)] || null;
}

export function mentionsPricing(value) {
  return /\b(price|pricing|plans?|subscri|cost|how much|packages?)\b/i.test(text(value));
}

export function agreesToWalkthrough(value) {
  return /^(yes|yeah|yep|sure|okay|ok|please)\b/i.test(text(value));
}

export function askedForWalkthrough(value) {
  return /walk (you |me )?through/i.test(text(value));
}

export function roleFallbackQuestion(role) {
  const key = roleKey(role);
  if (key === 'agent') return 'Are you trying to follow up with leads, or set up your own page?';
  if (key === 'broker') return 'Are the repetitive questions about rates, or about who qualifies?';
  if (key === 'lawyer') return 'Are the repeat questions about closing, or about booking a consultation?';
  return 'Are you trying to figure out what you can afford, or who should help you buy or sell?';
}
