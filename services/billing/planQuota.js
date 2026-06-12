import LeadMatch from '../../models/LeadMatch.js';
import NurtureLog from '../../models/NurtureLog.js';
import { getEffectivePlan, getPlanLimits } from './entitlements.js';

export class PlanQuotaError extends Error {
  constructor({ limitKey, used, max }) {
    super(`Plan limit reached for ${limitKey}`);
    this.name = 'PlanQuotaError';
    this.code = 'PLAN_LIMIT_REACHED';
    this.limitKey = limitKey;
    this.used = used;
    this.max = max;
  }
}

export function resolvePlanLimit(subscription, limitKey) {
  const planKey = getEffectivePlan(subscription);
  const limits = getPlanLimits(planKey);
  return limits?.[limitKey] ?? null;
}

export async function countCapturedLeads(userId) {
  return LeadMatch.countDocuments({ user_id: userId });
}

export async function countNurtureSends(userId) {
  return NurtureLog.countDocuments({ user_id: userId, status: 'sent' });
}

const COUNT_FNS = Object.freeze({
  captured_leads: countCapturedLeads,
  followup_actions: countNurtureSends,
});

export async function assertWithinPlanQuota({ userId, subscription, limitKey }) {
  const max = resolvePlanLimit(subscription, limitKey);
  if (max == null) return { used: 0, max: null };

  const countFn = COUNT_FNS[limitKey];
  if (!countFn) return { used: 0, max };

  const used = await countFn(userId);
  if (used >= max) {
    throw new PlanQuotaError({ limitKey, used, max });
  }
  return { used, max };
}

export async function getPlanUsageForUser(userId) {
  const [captured_leads, followup_actions] = await Promise.all([
    countCapturedLeads(userId),
    countNurtureSends(userId),
  ]);
  return { captured_leads, followup_actions };
}

/**
 * LeadMatch ids the workspace may list/open for this plan (newest first within cap).
 * Returns null when the plan has no captured_leads cap (enterprise / unlimited).
 */
export async function getPlanVisibleLeadMatchIds(userId, subscription) {
  const max = resolvePlanLimit(subscription, 'captured_leads');
  if (max == null) return null;
  if (max <= 0) return [];

  const rows = await LeadMatch.find({ user_id: userId })
    .sort({ createdAt: -1 })
    .limit(max)
    .select('_id')
    .lean();

  return rows.map((row) => row._id);
}

/** Mongo filter limiting list/detail queries to plan-visible leads. Null = no cap. */
export function planVisibleLeadMongoFilter(visibleIds) {
  if (visibleIds == null) return null;
  return { _id: { $in: visibleIds } };
}

export function mergeLeadQueryWithPlanVisibility(baseQuery, visibilityFilter) {
  if (!visibilityFilter) return baseQuery;
  return { $and: [baseQuery, visibilityFilter] };
}

export async function loadPlanVisibleLeadFilter(userId, subscription) {
  const visibleIds = await getPlanVisibleLeadMatchIds(userId, subscription);
  return planVisibleLeadMongoFilter(visibleIds);
}

export async function assertLeadMatchPlanVisible(userId, leadMatchId, subscription) {
  const visibilityFilter = await loadPlanVisibleLeadFilter(userId, subscription);
  if (!visibilityFilter) return true;

  const allowed = new Set(
    visibilityFilter._id.$in.map((id) => String(id)),
  );
  if (!allowed.has(String(leadMatchId))) {
    const err = new Error(
      'This lead is saved on your account but hidden by your plan limit. Upgrade your plan to view and manage it.',
    );
    err.statusCode = 403;
    err.code = 'PLAN_LEAD_HIDDEN';
    throw err;
  }
  return true;
}

async function dispatchPlanLimitNotification(userId, err) {
  const { notifyPlanLimitReachedIfNeeded } = await import('./planLimitNotifications.js');
  return notifyPlanLimitReachedIfNeeded(userId, err);
}

/** After a lead is stored, notify the professional when usage exceeds the visible cap. */
export async function notifyCapturedLeadsOverQuotaIfNeeded(userId, subscription) {
  const max = resolvePlanLimit(subscription, 'captured_leads');
  if (max == null) return null;

  const used = await countCapturedLeads(userId);
  if (used <= max) return null;

  return dispatchPlanLimitNotification(
    userId,
    new PlanQuotaError({ limitKey: 'captured_leads', used, max }),
  );
}

/** Load subscription and notify when captured leads exceed the plan workspace cap. */
export async function afterLeadCapturedNotifyOverQuota(userId) {
  const { getOrCreateSubscriptionForUser } = await import('./subscriptionService.js');
  const subscription = await getOrCreateSubscriptionForUser({ _id: userId });
  return notifyCapturedLeadsOverQuotaIfNeeded(userId, subscription);
}

const LIMIT_USER_MESSAGES = Object.freeze({
  captured_leads:
    'Your current plan displays up to {max} {maxLeadLabel} in the workspace, while {used} {usedLeadLabel} are saved from your chatbot. Upgrade to view and manage all captured leads.',
  followup_actions:
    'You have reached your nurture email limit ({used}/{max} {usedEmailLabel} sent). Upgrade your plan to send additional follow-up emails.',
});

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

export function planQuotaErrorResponse(err) {
  if (!(err instanceof PlanQuotaError)) return null;
  const maxLeadLabel = pluralize(err.max, 'lead');
  const usedLeadLabel = pluralize(err.used, 'lead');
  const usedEmailLabel = pluralize(err.used, 'email');
  const template =
    LIMIT_USER_MESSAGES[err.limitKey] ||
    `You have reached your plan limit for ${err.limitKey.replace(/_/g, ' ')} ({used}/{max}). Please upgrade to continue.`;
  const message = template
    .replace('{used}', String(err.used))
    .replace('{max}', String(err.max))
    .replace('{maxLeadLabel}', maxLeadLabel)
    .replace('{usedLeadLabel}', usedLeadLabel)
    .replace('{usedEmailLabel}', usedEmailLabel);
  return {
    success: false,
    code: err.code,
    limit: err.limitKey,
    used: err.used,
    max: err.max,
    message,
  };
}

/** Notify once and return a workspace-safe 403 payload for plan quota errors. */
export async function handleWorkspacePlanQuotaError(userId, err) {
  if (!(err instanceof PlanQuotaError)) return null;
  await dispatchPlanLimitNotification(userId, err);
  return planQuotaErrorResponse(err);
}
