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

  return {
    valid: errors.length === 0,
    errors,
  };
}
