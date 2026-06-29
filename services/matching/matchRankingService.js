import { getPlacementPriority } from '../billing/plans.js';

export function calculateFinalMatchScore(icpFitScore, subscription) {
  let score = icpFitScore || 0;

  // Base subscription boost (using bundled approach)
  const planKey = subscription?.plan_key;
  if (planKey) {
    const priority = getPlacementPriority(planKey);
    const boost = Math.min(priority, 20);
    score += boost;
  }

  return Math.min(100, score);
}

export function sortProfessionalsByMatch(professionals) {
  return professionals.sort((a, b) => {
    const scoreA = a.final_match_score || a.icp_fit?.fit_score || 0;
    const scoreB = b.final_match_score || b.icp_fit?.fit_score || 0;

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    const placementA = a.subscription?.placement_priority || 0;
    const placementB = b.subscription?.placement_priority || 0;
    
    if (placementB !== placementA) {
      return placementB - placementA;
    }

    const dateA = new Date(a.createdAt || 0);
    const dateB = new Date(b.createdAt || 0);
    return dateA - dateB;
  });
}

export function enrichMatchWithTierBoost(leadMatch, subscription) {
  if (!leadMatch) return null;

  const icpFitScore = leadMatch.icp_fit?.fit_score || 0;
  const finalScore = calculateFinalMatchScore(icpFitScore, subscription);

  return {
    ...leadMatch,
    final_match_score: finalScore,
    tier_boost: finalScore - icpFitScore,
    subscription_tier: subscription?.plan_key || 'none',
  };
}
