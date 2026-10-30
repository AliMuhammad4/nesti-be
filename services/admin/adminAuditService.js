import mongoose from 'mongoose';
import AdminAuditLog from '../../models/AdminAuditLog.js';
import logger from '../../utils/logger.js';

function toIdString(value) {
  if (value == null) return null;
  if (typeof value === 'object' && value._id != null) return String(value._id);
  const s = String(value).trim();
  return s || null;
}

/**
 * Best-effort admin action audit. Never throws to callers.
 * @param {{
 *   actorUserId: unknown,
 *   onBehalfOfUserId?: unknown,
 *   action: string,
 *   targetType?: string,
 *   targetId?: unknown,
 *   meta?: object,
 *   outcome?: 'ok' | 'error',
 *   errorMessage?: string,
 * }} params
 */
export async function recordAdminAudit({
  actorUserId,
  onBehalfOfUserId = null,
  action,
  targetType = '',
  targetId = null,
  meta = {},
  outcome = 'ok',
  errorMessage = '',
} = {}) {
  try {
    const actorId = toIdString(actorUserId);
    const actionKey = String(action || '').trim().slice(0, 120);
    if (!actorId || !mongoose.Types.ObjectId.isValid(actorId) || !actionKey) {
      return null;
    }

    const onBehalf = toIdString(onBehalfOfUserId);
    const target = toIdString(targetId);

    const doc = await AdminAuditLog.create({
      actor_user_id: actorId,
      on_behalf_of_user_id:
        onBehalf && mongoose.Types.ObjectId.isValid(onBehalf) ? onBehalf : null,
      action: actionKey,
      target_type: String(targetType || '').trim().slice(0, 80),
      target_id: target ? String(target).slice(0, 80) : '',
      meta: meta && typeof meta === 'object' ? meta : {},
      outcome: outcome === 'error' ? 'error' : 'ok',
      error_message: String(errorMessage || '').trim().slice(0, 2000),
    });
    return doc;
  } catch (err) {
    logger.warn('recordAdminAudit failed', { error: err?.message, action });
    return null;
  }
}
