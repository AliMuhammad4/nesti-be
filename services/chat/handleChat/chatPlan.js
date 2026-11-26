import Subscription from '../../../models/Subscription.js';
import { FEATURES, hasFeature } from '../../billing/entitlements.js';
import { supportsPropertyMatches } from '../flows/flowRoleMeta.js';

export function propertyMatchesEnabledForPlan(flow, subscription, assistantSetting = null) {
  if (assistantSetting?.offer_property_matches === false) return false;
  return Boolean(
    supportsPropertyMatches(flow) && hasFeature(subscription, FEATURES.LEADS_INSIGHTS_ADVANCED),
  );
}

/** Read the saved plan. A chat turn must not create a trial or mark a subscription expired. */
export function readSavedPlan(userId) {
  return Subscription.findOne({ user_id: userId })
    .select('plan_key status trial_end current_period_end cancel_at_period_end')
    .lean();
}

export function normalizePersistedGradeByScore(grade, score) {
  const normalizedGrade = String(grade || '').toLowerCase();
  const normalizedScore = Number(score);
  if (normalizedGrade === 'warm' && Number.isFinite(normalizedScore) && normalizedScore >= 40 && normalizedScore < 60) {
    return 'interested';
  }
  return normalizedGrade || grade;
}
