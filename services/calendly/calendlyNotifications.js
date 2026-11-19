import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import logger from '../../utils/logger.js';
import { CALENDLY_WEBHOOK_ERROR_KINDS } from '../../utils/calendlyWebhookErrors.js';
import { emitNotification } from '../realtime/workspaceSocket.js';

const CALENDLY_BILLING_URL = 'https://calendly.com/app/admin/billing';
const PLAN_BLOCKED_TYPE = 'calendly_plan_blocked';
const SYNC_RESTORED_TYPE = 'calendly_sync_restored';
const RECONNECT_NEEDED_TYPE = 'calendly_reconnect_needed';
const ATTENTION_KINDS = new Set([
  CALENDLY_WEBHOOK_ERROR_KINDS.plan,
  CALENDLY_WEBHOOK_ERROR_KINDS.reconnect,
  CALENDLY_WEBHOOK_ERROR_KINDS.permission,
]);

const SYNC_IMPACT =
  'New Calendly bookings will not sync to Nesti (webhooks are disabled). ' +
  'Appointments may not appear on your calendar, lead records may not update, and booking-related emails may not send until sync is restored.';

function inferPlanBlockReason(errorMessage = '') {
  const m = String(errorMessage || '').toLowerCase();
  if (/free trial|trial expired|trial ended|trial has ended/.test(m)) return 'trial_expired';
  if (/subscription expired|subscription has expired|billing issue|payment failed|past due/.test(m)) {
    return 'subscription_expired';
  }
  return 'plan_limit';
}

function planBlockedCopy(reason) {
  if (reason === 'trial_expired') {
    return {
      title: 'Calendly trial expired — booking sync paused',
      body: `Your Calendly free trial has ended. ${SYNC_IMPACT} Renew or upgrade your Calendly plan, then reconnect Calendly in Nesti.`,
      severity: 'high',
    };
  }
  if (reason === 'subscription_expired') {
    return {
      title: 'Calendly subscription expired — booking sync paused',
      body: `Your Calendly subscription has expired or has a billing issue. ${SYNC_IMPACT} Renew your Calendly subscription, then reconnect Calendly in Nesti.`,
      severity: 'critical',
    };
  }
  return {
    title: 'Calendly plan upgrade needed — booking sync paused',
    body: `Calendly webhooks require a Standard (or higher) plan. ${SYNC_IMPACT} Upgrade your Calendly account, then reconnect in Nesti.`,
    severity: 'high',
  };
}

async function persistAndEmit(userId, payload) {
  if (!userId) return null;

  const doc = await ProfessionalNotification.create({
    user_id: userId,
    notification_type: payload.notification_type,
    title: payload.title,
    body: payload.body,
    severity: payload.severity || 'info',
    action: payload.action || null,
  });

  emitNotification(userId, {
    notification_id: String(doc._id),
    notification_type: payload.notification_type,
    title: payload.title,
    body: payload.body,
    severity: payload.severity || 'info',
    action: doc.action,
  });

  return doc;
}

/**
 * Notify when Calendly OAuth connected but webhook registration is blocked by plan/subscription.
 * Skips duplicate unread notifications and re-notifies only when transitioning into plan-blocked state.
 */
export async function notifyCalendlyPlanBlocked(userId, { errorMessage = '', previousKind = null } = {}) {
  if (!userId) return null;
  if (previousKind === CALENDLY_WEBHOOK_ERROR_KINDS.plan) return null;

  const reason = inferPlanBlockReason(errorMessage);
  const copy = planBlockedCopy(reason);
  const idempotencyKey = `calendly:plan_blocked:${String(userId)}`;

  const unread = await ProfessionalNotification.findOne({
    user_id: userId,
    notification_type: PLAN_BLOCKED_TYPE,
    'action.idempotency_key': idempotencyKey,
    read_at: null,
  })
    .select('_id')
    .lean();
  if (unread?._id) return null;

  try {
    return await persistAndEmit(userId, {
      notification_type: PLAN_BLOCKED_TYPE,
      ...copy,
      action: {
        type: 'open_calendly_billing',
        href: CALENDLY_BILLING_URL,
        external: true,
        reason,
        calendar_href: '/calendar',
        idempotency_key: idempotencyKey,
      },
    });
  } catch (err) {
    logger.warn('Calendly plan-block notification failed', {
      user_id: String(userId),
      error: err?.message,
    });
    return null;
  }
}

/**
 * Notify once when Calendly access is lost (revoked/expired) or Calendly refuses booking-sync permission.
 * Only fires on the transition into that state, and never while an identical unread notice exists.
 */
export async function notifyCalendlyReconnectNeeded(userId, { kind = CALENDLY_WEBHOOK_ERROR_KINDS.reconnect, previousKind = null } = {}) {
  if (!userId) return null;
  if (previousKind === kind) return null;

  const idempotencyKey = `calendly:reconnect_needed:${String(userId)}`;
  const unread = await ProfessionalNotification.findOne({
    user_id: userId,
    notification_type: RECONNECT_NEEDED_TYPE,
    'action.idempotency_key': idempotencyKey,
    read_at: null,
  })
    .select('_id')
    .lean();
  if (unread?._id) return null;

  const permission = kind === CALENDLY_WEBHOOK_ERROR_KINDS.permission;
  try {
    return await persistAndEmit(userId, {
      notification_type: RECONNECT_NEEDED_TYPE,
      title: permission
        ? 'Calendly access needs approval — booking sync paused'
        : 'Calendly needs to be reconnected — booking sync paused',
      body: permission
        ? `Calendly did not allow Nesti to set up booking sync. ${SYNC_IMPACT} Reconnect Calendly in Settings and approve the requested access.`
        : `Calendly access expired or was removed. ${SYNC_IMPACT} Reconnect Calendly in Settings to resume booking sync.`,
      severity: 'high',
      action: {
        type: 'open_url',
        href: '/settings',
        reason: permission ? 'permission' : 'reconnect',
        idempotency_key: idempotencyKey,
      },
    });
  } catch (err) {
    logger.warn('Calendly reconnect notification failed', {
      user_id: String(userId),
      error: err?.message,
    });
    return null;
  }
}

/** Notify when booking sync works again after a prior plan-block / reconnect / permission state. */
export async function notifyCalendlySyncRestored(userId, { previousKind = null } = {}) {
  if (!userId || !ATTENTION_KINDS.has(previousKind)) return null;

  const idempotencyKey = `calendly:sync_restored:${String(userId)}:${Date.now()}`;

  try {
    return await persistAndEmit(userId, {
      notification_type: SYNC_RESTORED_TYPE,
      title: 'Calendly booking sync restored',
      body:
        'Calendly webhooks are active again. New bookings will appear on your calendar, update leads, and trigger booking emails as usual.',
      severity: 'info',
      action: {
        type: 'open_calendar',
        href: '/calendar',
        idempotency_key: idempotencyKey,
      },
    });
  } catch (err) {
    logger.warn('Calendly sync-restored notification failed', {
      user_id: String(userId),
      error: err?.message,
    });
    return null;
  }
}
