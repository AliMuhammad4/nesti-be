import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import logger from '../../utils/logger.js';
import { emitNotification } from '../realtime/workspaceSocket.js';
import { PlanQuotaError, planQuotaErrorResponse } from './planQuota.js';

const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function titleForLimitKey(limitKey) {
  if (limitKey === 'captured_leads') return 'Lead capture limit reached';
  if (limitKey === 'followup_actions') return 'Nurture email limit reached';
  return 'Plan limit reached';
}

/**
 * Notify the professional once per limit key per week. Visitor-facing flows must not surface quota errors.
 */
export async function notifyPlanLimitReachedIfNeeded(userId, err) {
  if (!(err instanceof PlanQuotaError) || !userId) return null;

  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const existing = await ProfessionalNotification.findOne({
    user_id: userId,
    notification_type: 'plan_limit_reached',
    'action.limit_key': err.limitKey,
    created_at: { $gte: since },
  })
    .select('_id')
    .lean();
  if (existing?._id) return null;

  const payload = planQuotaErrorResponse(err);
  const title = titleForLimitKey(err.limitKey);
  const body =
    payload?.message ||
    `You have reached your plan limit for ${String(err.limitKey).replace(/_/g, ' ')} (${err.used}/${err.max}). Please upgrade to continue.`;

  try {
    const doc = await ProfessionalNotification.create({
      user_id: userId,
      notification_type: 'plan_limit_reached',
      title,
      body,
      severity: 'high',
      action: {
        type: 'open_billing',
        href: '/checkout',
        limit_key: err.limitKey,
        used: err.used,
        max: err.max,
      },
    });

    emitNotification(userId, {
      notification_id: String(doc._id),
      notification_type: 'plan_limit_reached',
      title,
      body,
      severity: 'high',
      action: doc.action,
    });

    return doc;
  } catch (e) {
    logger.warn('Plan-limit notification persist failed', {
      error: e.message,
      user_id: String(userId),
      limit_key: err.limitKey,
    });
    return null;
  }
}
