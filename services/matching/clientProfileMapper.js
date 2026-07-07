/**
 * Maps a ClientProfile document into the lead-shaped structure used by ICP scoring.
 * Keeps client recommendation scoring aligned with lead capture / ICP fit logic.
 */
function mapTimelineToViewingReadiness(timeline) {
  const value = String(timeline || '').toLowerCase();
  if (!value) return '';
  if (value === 'asap' || value.includes('1-3')) return 'asap';
  if (value.includes('3-6') || value.includes('6-12')) return 'few_weeks';
  if (value.includes('browsing') || value.includes('exploring')) return 'just_browsing';
  return 'maybe_later';
}

function mapHomeGoalsToPurchasePurpose(homeGoals = []) {
  const goals = homeGoals.map((g) => String(g || '').toLowerCase());
  if (goals.some((g) => g.includes('investor') || g.includes('commercial'))) return 'investment';
  if (goals.some((g) => g.includes('renting') || g.includes('leasing'))) return 'rental';
  return 'primary_residence';
}

function mapHomeGoalsToTransactionType(homeGoals = []) {
  const goals = homeGoals.map((g) => String(g || '').toLowerCase());
  if (goals.some((g) => g.includes('investor') || g.includes('commercial'))) return 'investment';
  return 'home_purchase';
}

function mapBudgetToPropertyValue(budget) {
  const value = Number(budget);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 400_000) return 'under_400k';
  if (value < 700_000) return '400k_700k';
  if (value < 1_000_000) return '700k_1m';
  return '1m_plus';
}

export function mapClientProfileToLeadShape(client = {}) {
  const homeGoals = [...(client.home_goals || []), client.home_goal].filter(Boolean);
  const locations = [...(client.preferred_locations || []), client.preferred_location].filter(Boolean);

  return {
    intent: 'buy',
    budget_profile: {
      min_budget: null,
      max_budget: client.dream_home_price ?? null,
    },
    property: {
      location: locations.join(', '),
      timeline: client.purchase_timeline || '',
    },
    qualification: {
      agent: {
        motivation_reason: client.motivation_reason || '',
        viewing_readiness: mapTimelineToViewingReadiness(client.purchase_timeline),
        living_situation: client.living_situation || '',
        buy_property_location: locations[0] || '',
      },
      mortgage_broker: {
        employment_status: client.employment_status || '',
        purchase_purpose: mapHomeGoalsToPurchasePurpose(homeGoals),
        property_budget: client.dream_home_price ? String(client.dream_home_price) : '',
        mortgage_timeline: client.purchase_timeline || '',
        household_income: client.annual_income ? String(client.annual_income) : '',
        down_payment_readiness: client.current_savings ? String(client.current_savings) : '',
      },
      lawyer: {
        transaction_type: mapHomeGoalsToTransactionType(homeGoals),
        property_value: mapBudgetToPropertyValue(client.dream_home_price),
        closing_timeline: client.purchase_timeline || '',
        first_time_buyer: homeGoals.some((g) => String(g).includes('first_time')) ? 'yes' : '',
      },
    },
    preferences: {
      language_preference: client.languages || [],
      working_style_preference: (client.working_styles || [])[0] || '',
      experience_preference: client.preferred_experience || '',
    },
    _client_meta: {
      home_goals: homeGoals,
      priority_tags: client.priority_tags || [],
      comfort_preferences: client.comfort_preferences || [],
      working_styles: client.working_styles || [],
      languages: client.languages || [],
      preferred_experience: client.preferred_experience || '',
      annual_income: client.annual_income,
      current_savings: client.current_savings,
      purchase_timeline: client.purchase_timeline || '',
      preferred_locations: locations,
      dream_home_price: client.dream_home_price,
    },
  };
}

function hasLocation(client = {}) {
  const locations = [...(client.preferred_locations || []), client.preferred_location].filter(Boolean);
  return locations.some((entry) => String(entry).trim());
}

function hasNumericValue(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

const CLIENT_PROFILE_COMPLETION_FIELDS = [
  { key: 'annual_income', label: 'Annual Income', complete: (client) => Number(client.annual_income) > 0 },
  { key: 'employment_status', label: 'Employment Status', complete: (client) => Boolean(client.employment_status) },
  {
    key: 'current_savings',
    label: 'Current Savings',
    complete: (client) => hasNumericValue(client.current_savings),
  },
  {
    key: 'monthly_savings',
    label: 'Monthly Savings',
    complete: (client) => hasNumericValue(client.monthly_savings),
  },
  { key: 'mortgage_status', label: 'Mortgage Status', complete: (client) => Boolean(client.mortgage_status) },
  {
    key: 'home_goal',
    label: 'Home Goal',
    complete: (client) => Boolean(client.home_goal) || (Array.isArray(client.home_goals) && client.home_goals.length > 0),
  },
  { key: 'dream_home_price', label: 'Target Home Price', complete: (client) => Number(client.dream_home_price) > 0 },
  { key: 'preferred_location', label: 'Preferred Location', complete: hasLocation },
  { key: 'purchase_timeline', label: 'Purchase Timeline', complete: (client) => Boolean(client.purchase_timeline) },
  { key: 'realtor_status', label: 'Realtor Status', complete: (client) => Boolean(client.realtor_status) },
  { key: 'viewing_readiness', label: 'Viewing Readiness', complete: (client) => Boolean(client.viewing_readiness) },
  { key: 'living_situation', label: 'Living Situation', complete: (client) => Boolean(client.living_situation) },
  { key: 'offer_readiness', label: 'Offer Readiness', complete: (client) => Boolean(client.offer_readiness) },
  { key: 'motivation_reason', label: 'Search Motivation', complete: (client) => Boolean(client.motivation_reason) },
  {
    key: 'working_styles',
    label: 'Working Style',
    complete: (client) => Array.isArray(client.working_styles) && client.working_styles.length > 0,
  },
  {
    key: 'priority_tags',
    label: 'What Matters Most',
    complete: (client) => Array.isArray(client.priority_tags) && client.priority_tags.length > 0,
  },
  {
    key: 'languages',
    label: 'Languages',
    complete: (client) => Array.isArray(client.languages) && client.languages.length > 0,
  },
  { key: 'preferred_experience', label: 'Preferred Experience', complete: (client) => Boolean(client.preferred_experience) },
  {
    key: 'preferred_contact_method',
    label: 'Preferred Contact Method',
    complete: (client) => Boolean(client.preferred_contact_method),
  },
  {
    key: 'best_time_to_contact',
    label: 'Best Time to Contact',
    complete: (client) => Boolean(client.best_time_to_contact),
  },
];

export function getClientProfileCompleteness(client = {}) {
  const fields = CLIENT_PROFILE_COMPLETION_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    complete: field.complete(client),
  }));
  const completed = fields.filter((field) => field.complete);
  const missing = fields.filter((field) => !field.complete);
  const total = fields.length;
  const percentage = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  return {
    percentage,
    completed,
    missing,
    fields,
    total,
  };
}

export function calculateClientProfileCompleteness(client = {}) {
  return getClientProfileCompleteness(client).percentage;
}
