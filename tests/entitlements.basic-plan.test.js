import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURES,
  SUBSCRIPTION_PLAN,
  BASIC_FEATURES,
  STANDARD_FEATURES,
  hasFeature,
  getPlanLimits,
  getPlanLimitsForSubscription,
  getEffectivePlan,
} from '../services/billing/entitlements.js';

function mockSubscription(planKey, status = 'active') {
  return { plan_key: planKey, status };
}

test('Basic plan limits are 50 leads and 50 nurture emails', () => {
  const limits = getPlanLimits(SUBSCRIPTION_PLAN.BASIC);
  assert.equal(limits.captured_leads, 50);
  assert.equal(limits.followup_actions, 50);
});

test('Standard plan limits are 150 leads and 500 nurture emails', () => {
  const limits = getPlanLimits(SUBSCRIPTION_PLAN.STANDARD);
  assert.equal(limits.captured_leads, 150);
  assert.equal(limits.followup_actions, 500);
});

test('Enterprise plan limits are unlimited', () => {
  const limits = getPlanLimits(SUBSCRIPTION_PLAN.ENTERPRISE);
  assert.equal(limits.captured_leads, null);
  assert.equal(limits.followup_actions, null);
});

test('Basic includes PRO_CHAT_DM but not Standard-only features', () => {
  assert.equal(BASIC_FEATURES.has(FEATURES.PRO_CHAT_DM), true);
  assert.equal(BASIC_FEATURES.has(FEATURES.REFERRALS_MANUAL), true);
  assert.equal(BASIC_FEATURES.has(FEATURES.REFERRALS_INVITES), false);
  assert.equal(BASIC_FEATURES.has(FEATURES.CRM_LEAD_CONVERSATION), false);
  assert.equal(BASIC_FEATURES.has(FEATURES.PUBLIC_PROFILE), false);
  assert.equal(BASIC_FEATURES.has(FEATURES.DASHBOARD_ANALYTICS), true);
  assert.equal(BASIC_FEATURES.has(FEATURES.WORKSPACE_ANALYTICS_PAGE), false);
  assert.equal(BASIC_FEATURES.has(FEATURES.REPORTS_AI_MONTHLY), false);
  assert.equal(BASIC_FEATURES.has(FEATURES.PRO_CHAT), false);
  assert.equal(BASIC_FEATURES.has(FEATURES.LEADS_INSIGHTS_ADVANCED), false);
});

test('Standard includes moved features and group chat', () => {
  assert.equal(STANDARD_FEATURES.has(FEATURES.REFERRALS_MANUAL), true);
  assert.equal(STANDARD_FEATURES.has(FEATURES.REFERRALS_INVITES), true);
  assert.equal(STANDARD_FEATURES.has(FEATURES.CRM_LEAD_CONVERSATION), true);
  assert.equal(STANDARD_FEATURES.has(FEATURES.PUBLIC_PROFILE), true);
  assert.equal(STANDARD_FEATURES.has(FEATURES.DASHBOARD_ANALYTICS), true);
  assert.equal(STANDARD_FEATURES.has(FEATURES.WORKSPACE_ANALYTICS_PAGE), true);
  assert.equal(STANDARD_FEATURES.has(FEATURES.REPORTS_AI_MONTHLY), true);
  assert.equal(STANDARD_FEATURES.has(FEATURES.PRO_CHAT), true);
  assert.equal(STANDARD_FEATURES.has(FEATURES.LEADS_FOLLOWUP_AUTOMATED), true);
});

test('hasFeature gates lead conversation and public profile by plan', () => {
  const basicSub = mockSubscription('basic');
  const standardSub = mockSubscription('standard');

  assert.equal(hasFeature(basicSub, FEATURES.CRM_LEAD_CONVERSATION), false);
  assert.equal(hasFeature(standardSub, FEATURES.CRM_LEAD_CONVERSATION), true);
  assert.equal(hasFeature(basicSub, FEATURES.PUBLIC_PROFILE), false);
  assert.equal(hasFeature(standardSub, FEATURES.PUBLIC_PROFILE), true);
  assert.equal(hasFeature(basicSub, FEATURES.PRO_CHAT_DM), true);
  assert.equal(hasFeature(basicSub, FEATURES.PRO_CHAT), false);
  assert.equal(hasFeature(basicSub, FEATURES.REFERRALS_MANUAL), true);
  assert.equal(hasFeature(basicSub, FEATURES.REFERRALS_INVITES), false);
  assert.equal(hasFeature(standardSub, FEATURES.REFERRALS_INVITES), true);
});

test('free trial effective plan is enterprise', () => {
  const trialSub = {
    status: 'free_trial',
    plan_key: 'basic',
    trial_end: new Date(Date.now() + 86400000),
  };
  assert.equal(getEffectivePlan(trialSub), SUBSCRIPTION_PLAN.ENTERPRISE);
  assert.equal(hasFeature(trialSub, FEATURES.PUBLIC_PROFILE), true);
  const trialLimits = getPlanLimitsForSubscription(trialSub);
  assert.equal(trialLimits.captured_leads, 10);
  assert.equal(trialLimits.followup_actions, null);
});
