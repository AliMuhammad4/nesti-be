const SEMANTIC_GROUPS = Object.freeze({
  first_time: ['first_time', 'first time', 'first_time_buyer', 'first_time_buyers', 'beginner', 'starter', 'new buyer'],
  investor: ['investor', 'investment', 'investors', 'rental', 'commercial', 'commercial_investor', 'first_time_investor'],
  luxury: ['luxury', 'luxury_buyer', 'elite', 'upscale', 'premium', 'high_end'],
  move_up: ['move_up', 'move up', 'upgrading', 'upsizing', 'move_up_buyer'],
  family: ['family', 'family_neighbourhoods', 'schools', 'great_schools', 'neighbourhood', 'neighborhood'],
  fast: ['fast', 'quick', 'asap', 'immediate', 'closing_quickly', 'fast_efficient', 'quick_responder'],
  negotiator: ['negotiat', 'best_deal', 'strong_negotiator', 'deal'],
  analytical: ['analytical', 'data_driven', 'data driven'],
  patient: ['patient', 'supportive', 'patient_supportive', 'educational', 'explains_clearly'],
  relationship: ['relationship', 'friendly', 'approachable', 'friendly_approachable'],
  downtown: ['downtown', 'downtown_living', 'urban', 'city'],
  waterfront: ['waterfront', 'water', 'lakefront'],
  eco: ['eco', 'eco_friendly', 'green', 'sustainable'],
  pet: ['pet', 'pet_friendly'],
  transit: ['transit', 'transit_access', 'walkable', 'walkable_communities'],
  newcomer: ['newcomer', 'immigrant', 'relocation', 'new_to_canada'],
  commercial: ['commercial', 'commercial_client', 'commercial_deal'],
  financing: ['finance', 'financing', 'mortgage', 'credit'],
});

const WORKING_STYLE_TO_PRO = Object.freeze({
  explains_clearly: ['educational_advisor', 'educational', 'advisor', 'patient', 'support'],
  patient_supportive: ['educational_advisor', 'relationship_focused', 'patient', 'support'],
  fast_efficient: ['fast_deal_closer', 'fast', 'quick', 'efficient'],
  strong_negotiator: ['fast_deal_closer', 'negotiat', 'deal'],
  investment_focused: ['investor_oriented', 'investment', 'investor'],
  analytical: ['data_driven', 'analytical', 'data'],
  friendly_approachable: ['relationship_focused', 'friendly', 'approachable'],
  quick_responder: ['fast_deal_closer', 'fast', 'quick', '24', 'same day'],
  straight_to_point: ['fast_deal_closer', 'direct', 'straight', 'efficient'],
  educational_advisor: ['educational_advisor', 'educational', 'advisor', 'guide'],
  fast_deal_closer: ['fast_deal_closer', 'fast', 'quick', 'closer', 'efficient'],
  data_driven_strategist: ['data_driven', 'data', 'analytical', 'strategist'],
  relationship_focused: ['relationship_focused', 'relationship', 'friendly', 'warm'],
  investor_oriented: ['investor_oriented', 'investor', 'investment'],
  analytical_decision_maker: ['analytical', 'data', 'decision'],
  transactional_efficient: ['transactional', 'efficient', 'direct'],
  high_responsiveness: ['responsive', 'quick', 'same day', '24'],
  calm_patient_guide: ['calm', 'patient', 'guide', 'educational'],
});

export const toText = (value) => String(value || '').toLowerCase();

export const toArray = (value) => {
  if (Array.isArray(value)) return value.map((item) => toText(item)).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(/[,/|]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

export const clampScore = (value, max = 100) => Math.max(0, Math.min(max, Math.round(value)));

export function expandSemanticTokens(...values) {
  const tokens = new Set();
  const raw = values.flatMap((v) => (Array.isArray(v) ? v : [v])).map(toText).filter(Boolean);

  for (const item of raw) {
    tokens.add(item.replace(/[\s-]+/g, '_'));
    item
      .split(/[\s_-]+/)
      .filter((word) => word.length >= 3)
      .forEach((word) => tokens.add(word));

    for (const [group, synonyms] of Object.entries(SEMANTIC_GROUPS)) {
      if (synonyms.some((syn) => item.includes(syn) || syn.includes(item))) {
        tokens.add(group);
        synonyms.forEach((syn) => tokens.add(syn.replace(/[\s-]+/g, '_')));
      }
    }
  }
  return tokens;
}

export function tokenOverlapScore(clientTokens, professionalTokens) {
  if (!clientTokens.size) return null;
  if (!professionalTokens.size) return 0;
  const overlap = [...clientTokens].filter((token) => professionalTokens.has(token)).length;
  if (overlap >= 3) return 1;
  if (overlap === 2) return 0.75;
  if (overlap === 1) return 0.45;
  return 0;
}

export function parsePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '').replace(/,/g, '').toLowerCase();
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  if (raw.includes('m')) return number * 1_000_000;
  if (raw.includes('k')) return number * 1_000;
  return number > 10_000 ? number : null;
}

export function locationMatchScore(clientLocations = [], professionalText = '') {
  const locations = clientLocations.map(toText).filter(Boolean);
  const proText = toText(professionalText);
  if (!locations.length) return null;
  if (!proText.trim()) return 0;

  if (locations.some((loc) => proText.includes(loc) || loc.includes(proText.trim()))) return 1;

  const clientWords = expandSemanticTokens(...locations);
  const proWords = expandSemanticTokens(proText);
  const overlap = [...clientWords].filter((word) => proWords.has(word)).length;
  if (overlap >= 2) return 0.8;
  if (overlap === 1) return 0.5;
  return 0;
}

export function scoreWorkingStyleMatch(clientStyles = [], professional = {}) {
  if (!clientStyles.length) return null;
  const proText = toText(
    `${professional.working_style_structured || ''} ${professional.working_style_tags || ''} ${professional.personality_style_tags || ''} ${professional.communication_channels || ''} ${professional.support_level || ''} ${professional.bio || ''}`,
  );
  if (!proText.trim()) return 0;

  let best = 0;
  for (const style of clientStyles) {
    const mapped = WORKING_STYLE_TO_PRO[style] || [style];
    const hit = mapped.some((token) => proText.includes(toText(token)));
    if (hit) best = Math.max(best, 1);
    else if (expandSemanticTokens(style).size && [...expandSemanticTokens(style)].some((t) => proText.includes(t))) {
      best = Math.max(best, 0.6);
    }
  }
  return best;
}

export function normalizeProfessionalLanguages(proLanguages = []) {
  const pro = toArray(proLanguages);
  return pro.length ? pro : ['english'];
}

export function passesLanguageRequirement(clientLanguages = [], proLanguages = []) {
  const client = toArray(clientLanguages).filter((lang) => lang && lang !== 'other');
  if (!client.length) return true;

  const pro = normalizeProfessionalLanguages(proLanguages);
  return client.some((lang) => pro.includes(lang));
}

export function calculateProfessionalDataConfidence(professional = {}) {
  const signals = [
    Boolean(professional.location || professional.target_neighborhoods),
    Boolean(professional.specializations?.length || professional.preferred_clients?.length),
    Boolean(professional.languages_spoken?.length),
    Boolean(professional.experience_level || professional.experience),
    Boolean(professional.working_style_structured || professional.bio),
    Boolean(parsePrice(professional.avg_home_price) || parsePrice(professional.avg_sale_price)),
    Boolean(professional.availability || professional.response_time),
  ];
  const filled = signals.filter(Boolean).length;
  return Math.round((filled / signals.length) * 100);
}

export function scoreCategory({ clientReady, proReady, ratio }) {
  if (!clientReady) return { score: null, applicable: false, reason: 'client_missing' };
  if (!proReady) return { score: 0, applicable: true, reason: 'pro_missing' };
  return { score: clampScore(ratio * 100), applicable: true, reason: 'scored' };
}
