import CalendarIntegration from '../../models/CalendarIntegration.js';
import logger from '../../utils/logger.js';
import {
  CALENDLY_WEBHOOK_ERROR_KINDS,
  calendlyWebhookErrorKind,
  userFacingCalendlyRegisterError,
} from '../../utils/calendlyWebhookErrors.js';
import {
  notifyCalendlyPlanBlocked,
  notifyCalendlyReconnectNeeded,
  notifyCalendlySyncRestored,
} from './calendlyNotifications.js';
import { isTransientCalendlyError } from './calendlyHttp.js';
import { CALENDLY_ACCESS_KIND, ensureFreshCalendlyAccess } from './calendlyTokenService.js';
import {
  deleteCalendlyWebhookSubscription,
  listCalendlyWebhookSubscriptions,
  registerCalendlyInviteeWebhook,
} from './registerInviteeWebhook.js';

export const CALENDLY_HEALTH_RECHECK_MS = 60 * 60 * 1000;

export async function persistCalendlyWebhookState(userId, { targetUrl, error, kind: forcedKind } = {}) {
  const prev = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' })
    .select('calendly_webhook_error_kind')
    .lean();
  if (!prev) return;
  const previousKind = prev?.calendly_webhook_error_kind || null;

  const urlSet = targetUrl === undefined ? {} : { calendly_webhook_url: String(targetUrl || '').trim() || null };
  if (error) {
    const kind = forcedKind || calendlyWebhookErrorKind(String(error));
    const msg = userFacingCalendlyRegisterError(kind, String(error));
    await CalendarIntegration.updateOne(
      { user_id: userId, provider: 'calendly' },
      { $set: { ...urlSet, calendly_webhook_register_error: msg, calendly_webhook_error_kind: kind, calendly_webhook_registered_at: null } }
    );
    if (kind === CALENDLY_WEBHOOK_ERROR_KINDS.plan) {
      await notifyCalendlyPlanBlocked(userId, { errorMessage: String(error), previousKind });
    } else if (kind === CALENDLY_WEBHOOK_ERROR_KINDS.reconnect || kind === CALENDLY_WEBHOOK_ERROR_KINDS.permission) {
      await notifyCalendlyReconnectNeeded(userId, { kind, previousKind });
    }
  } else {
    await CalendarIntegration.updateOne(
      { user_id: userId, provider: 'calendly' },
      { $set: { ...urlSet, calendly_webhook_register_error: null, calendly_webhook_error_kind: null, calendly_webhook_registered_at: new Date() } }
    );
    await notifyCalendlySyncRestored(userId, { previousKind });
  }
}

export async function markCalendlyReconnectRequired(userId, reason = '') {
  try {
    await persistCalendlyWebhookState(userId, {
      error: reason || 'Calendly access expired',
      kind: CALENDLY_WEBHOOK_ERROR_KINDS.reconnect,
    });
  } catch (err) {
    logger.warn('Calendly reconnect state not stored', { user_id: String(userId), error: err?.message });
  }
}

export function attentionKindForCalendlyError(err) {
  if (!err || isTransientCalendlyError(err)) return null;
  const status = Number(err.status) || 0;
  const kind = calendlyWebhookErrorKind(err.message);
  if (kind !== CALENDLY_WEBHOOK_ERROR_KINDS.other) return kind;
  if (status === 401) return CALENDLY_WEBHOOK_ERROR_KINDS.reconnect;
  if (status === 403) return CALENDLY_WEBHOOK_ERROR_KINDS.permission;
  return null;
}

function normalizeUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

function collectSubscriptions(list) {
  const byUri = new Map();
  for (const scoped of [list?.user_scope_list, list?.organization_scope_list]) {
    if (!Array.isArray(scoped?.collection)) continue;
    for (const s of scoped.collection) byUri.set(String(s?.uri || byUri.size), s);
  }
  return [...byUri.values()];
}

function listFailure(list) {
  const userErr = list?.user_scope_list?._error;
  const orgList = list?.organization_scope_list;
  const orgErr = orgList ? orgList._error : null;
  if (!userErr || (orgList && !orgErr)) return null;
  const status = Number(userErr) || Number(orgErr) || 0;
  const body = list?.user_scope_list?._body || orgList?._body || '';
  const err = new Error(`Calendly webhook_subscriptions list failed (${status}): ${body}`);
  err.status = status;
  err.transient = status === 429 || status >= 500;
  return err;
}

export async function checkCalendlyConnectionHealth(userId, { force = false } = {}) {
  const integ = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' });
  if (!integ?.access_token) return { checked: false, reason: 'not_connected' };

  const now = Date.now();
  const lastChecked = integ.calendly_health_checked_at ? new Date(integ.calendly_health_checked_at).getTime() : 0;
  if (!force && lastChecked && now - lastChecked < CALENDLY_HEALTH_RECHECK_MS) {
    return { checked: false, reason: 'recent' };
  }
  const claim = await CalendarIntegration.updateOne(
    { _id: integ._id, calendly_health_checked_at: integ.calendly_health_checked_at ?? null },
    { $set: { calendly_health_checked_at: new Date(now) } }
  );
  if (!claim.modifiedCount) return { checked: false, reason: 'in_progress' };

  const previousKind = integ.calendly_webhook_error_kind || null;

  let fresh;
  try {
    fresh = await ensureFreshCalendlyAccess(integ);
  } catch (err) {
    if (err?.kind === CALENDLY_ACCESS_KIND.reconnect) {
      await markCalendlyReconnectRequired(userId, err.message);
      return { checked: true, state: 'reconnect_required' };
    }
    return { checked: true, state: 'unavailable' };
  }

  const targetUrl = String(fresh.calendly_webhook_url || process.env.CALENDLY_WEBHOOK_TARGET_URL || '').trim();
  try {
    const list = await listCalendlyWebhookSubscriptions(fresh.access_token);
    const failed = listFailure(list);
    if (failed) throw failed;

    if (!targetUrl) {
      if (previousKind === CALENDLY_WEBHOOK_ERROR_KINDS.reconnect) {
        await CalendarIntegration.updateOne(
          { _id: integ._id },
          { $set: { calendly_webhook_register_error: null, calendly_webhook_error_kind: null } }
        );
        await notifyCalendlySyncRestored(userId, { previousKind });
      }
      return { checked: true, state: 'ok_no_webhook_target' };
    }

    const mine = collectSubscriptions(list).filter((s) => normalizeUrl(s?.callback_url) === normalizeUrl(targetUrl));
    const active = mine.find((s) => String(s?.state || '').toLowerCase() === 'active');
    if (active) {
      if (previousKind || !fresh.calendly_webhook_registered_at) {
        await persistCalendlyWebhookState(userId, { targetUrl, error: null });
      }
      return { checked: true, state: 'ok' };
    }

    for (const s of mine) {
      await deleteCalendlyWebhookSubscription(fresh.access_token, s?.uri);
    }
    await registerCalendlyInviteeWebhook(fresh.access_token, targetUrl);
    await persistCalendlyWebhookState(userId, { targetUrl, error: null });
    logger.info('Calendly health: booking-sync webhook re-registered', {
      op: 'calendly.health',
      user_id: String(userId),
      replaced_disabled: mine.length,
    });
    return { checked: true, state: 'repaired' };
  } catch (err) {
    const kind = attentionKindForCalendlyError(err);
    if (!kind) {
      logger.warn('Calendly health check: Calendly unavailable', { op: 'calendly.health', user_id: String(userId), error: err?.message });
      return { checked: true, state: 'unavailable' };
    }
    await persistCalendlyWebhookState(userId, { error: err.message, kind });
    return { checked: true, state: kind };
  }
}
