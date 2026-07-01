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

export function calculateClientProfileCompleteness(client = {}) {
  const signals = [
    Boolean((client.home_goals || []).length || client.home_goal),
    Boolean(client.dream_home_price),
    Boolean((client.preferred_locations || []).length || client.preferred_location),
    Boolean(client.purchase_timeline),
    Boolean((client.working_styles || []).length),
    Boolean((client.priority_tags || []).length),
    Boolean((client.languages || []).length),
    Boolean(client.preferred_experience),
  ];
  const filled = signals.filter(Boolean).length;
  return Math.round((filled / signals.length) * 100);
}
