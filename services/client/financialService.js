export function calculateHomeownershipMetrics(profile) {
  if (!profile) return null;

  const dreamHomePrice = profile.dream_home_price || 0;
  const currentSavings = profile.current_savings || 0;
  const monthlySavings = profile.monthly_savings || 0;

  const downPaymentGoal = dreamHomePrice * 0.20;
  const remainingAmount = Math.max(0, downPaymentGoal - currentSavings);
  
  const progressScore = downPaymentGoal > 0
    ? Math.min((currentSavings / downPaymentGoal) * 100, 100)
    : 0;

  const monthsToGoal = remainingAmount > 0
    ? (monthlySavings > 0 ? Math.ceil(remainingAmount / monthlySavings) : null)
    : 0;

  return {
    down_payment_goal: Math.round(downPaymentGoal),
    homeownership_progress_score: Math.round(progressScore),
    months_to_goal: monthsToGoal,
    remaining_amount: Math.round(remainingAmount),
  };
}

export function updateClientProfileMetrics(profile) {
  const metrics = calculateHomeownershipMetrics(profile);
  if (!metrics) return profile;

  profile.down_payment_goal = metrics.down_payment_goal;
  profile.homeownership_progress_score = metrics.homeownership_progress_score;
  profile.months_to_goal = metrics.months_to_goal;

  return profile;
}

const ARRAY_FIELDS = new Set([
  'home_goals',
  'preferred_locations',
  'working_styles',
  'priority_tags',
  'languages',
  'comfort_preferences',
]);

const STRING_FIELDS = new Set([
  'home_goal',
  'preferred_location',
  'purchase_timeline',
  'employment_status',
  'mortgage_status',
  'realtor_status',
  'viewing_readiness',
  'offer_readiness',
  'motivation_reason',
  'living_situation',
  'purchase_purpose',
  'preferred_contact_method',
  'best_time_to_contact',
  'preferred_experience',
]);

const PURCHASE_TIMELINE_VALUES = new Set([
  'asap',
  '1-3 months',
  '3-6 months',
  '6-12 months',
  'browsing',
  '1_year',
  '2_years',
  '3_years',
  '5_years',
  'exploring',
]);

const EMPLOYMENT_STATUS_VALUES = new Set([
  'full_time',
  'self_employed',
  'contract',
  'new_job',
  'unemployed',
  'part_time',
  'student',
  'retired',
  'other',
  '',
]);

function normalizeStringArray(value, { max = 12 } = {}) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(
    new Set(
      arr
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

export function sanitizeClientProfileData(data = {}) {
  const out = { ...data };
  for (const field of STRING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(out, field)) {
      out[field] = String(out[field] || '').trim();
    }
  }
  // purchase_timeline enum does not allow "" — empty means "unset" (null).
  if (Object.prototype.hasOwnProperty.call(out, 'purchase_timeline')) {
    out.purchase_timeline = out.purchase_timeline || null;
  }
  for (const field of ARRAY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(out, field)) {
      out[field] = normalizeStringArray(out[field], {
        max: field === 'priority_tags' ? 5 : 12,
      });
    }
  }
  if (Object.prototype.hasOwnProperty.call(out, 'home_goals')) {
    out.home_goal = out.home_goals[0] || '';
  } else if (Object.prototype.hasOwnProperty.call(out, 'home_goal') && out.home_goal) {
    out.home_goals = normalizeStringArray([out.home_goal]);
  }
  if (Object.prototype.hasOwnProperty.call(out, 'preferred_location')) {
    const location = String(out.preferred_location || '').trim();
    if (location && !Array.isArray(out.preferred_locations)) {
      out.preferred_locations = normalizeStringArray([location]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(out, 'preferred_locations')) {
    const first = normalizeStringArray(out.preferred_locations)[0] || '';
    if (first && !String(out.preferred_location || '').trim()) {
      out.preferred_location = first;
    }
  }
  if (
    Object.keys(out).some((key) =>
      [...ARRAY_FIELDS, ...STRING_FIELDS].includes(key)
    )
  ) {
    out.onboarding_autosaved_at = new Date();
  }
  return out;
}

export function validateClientProfileData(data) {
  const errors = [];

  if (data.annual_income != null && data.annual_income < 0) {
    errors.push('Annual income cannot be negative');
  }

  if (data.current_savings != null && data.current_savings < 0) {
    errors.push('Current savings cannot be negative');
  }

  if (data.monthly_savings != null && data.monthly_savings < 0) {
    errors.push('Monthly savings cannot be negative');
  }

  if (data.dream_home_price != null && data.dream_home_price < 0) {
    errors.push('Dream home price cannot be negative');
  }

  if (Array.isArray(data.priority_tags) && data.priority_tags.length > 5) {
    errors.push('Please select up to five priorities');
  }

  if (
    data.purchase_timeline != null &&
    data.purchase_timeline !== '' &&
    !PURCHASE_TIMELINE_VALUES.has(String(data.purchase_timeline).trim())
  ) {
    errors.push('Invalid purchase timeline');
  }

  if (
    data.employment_status != null &&
    !EMPLOYMENT_STATUS_VALUES.has(String(data.employment_status).trim())
  ) {
    errors.push('Invalid employment status');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
