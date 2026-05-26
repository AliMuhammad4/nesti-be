import logger from '../../utils/logger.js';
import { createLeadLifecycleNotification } from '../notifications/notificationService.js';
import { emitNotification } from '../realtime/workspaceSocket.js';

function userDisplayName(doc) {
  if (!doc) return 'A colleague';
  const o = doc.toObject ? doc.toObject() : doc;
  const full = String(o.full_name || '').trim();
  if (full) return full;
  const fn = [o.first_name, o.last_name].filter(Boolean).join(' ').trim();
  return fn || 'A colleague';
}

function referralIdOf(doc) {
  const o = doc?.toObject ? doc.toObject() : doc;
  return String(o._id || '').trim();
}

function leadMatchIdStr(doc) {
  const o = doc?.toObject ? doc.toObject() : doc;
  const lid = o.lead_match_id;
  if (!lid) return null;
  return String(lid);
}

async function persistAndEmit(recipientUserId, payload) {
  const uid = recipientUserId?._id || recipientUserId;
  if (!uid) return;
  let notification_id = null;
  try {
    const doc = await createLeadLifecycleNotification(uid, payload);
    notification_id = doc?._id ? String(doc._id) : null;
  } catch (e) {
    logger.warn('Referral notification persist failed', {
      error: e?.message,
      user_id: String(uid),
      type: payload?.notification_type,
    });
  }
  emitNotification(uid, {
    notification_id,
    notification_type: payload.notification_type,
    title: payload.title,
    body: payload.body,
    severity: payload.severity || 'info',
    lead_match_id: payload.lead_match_id ? String(payload.lead_match_id) : null,
    action: payload.action || null,
  });
}

/** Target user: someone referred a lead to you (pending review). */
export async function notifyReferralReceived(referralDoc) {
  try {
    const targetId = referralDoc.target_user_id?._id || referralDoc.target_user_id;
    const referrer = referralDoc.user_id;
    const rid = referralIdOf(referralDoc);
    if (!targetId || !rid) return;
    const name = userDisplayName(referrer);
    const body = `${name} referred a lead to you. Open Referrals → Inbound to accept or decline.`;
    await persistAndEmit(targetId, {
      notification_type: 'referral_received',
      title: 'New referral',
      body,
      severity: 'high',
      lead_match_id: leadMatchIdStr(referralDoc),
      action: { type: 'open_referral', referral_id: rid, direction: 'inbound' },
    });
  } catch (e) {
    logger.warn('notifyReferralReceived failed', { error: e?.message });
  }
}

/** Referrer: recipient accepted the referral. */
export async function notifyReferralAccepted(referralDoc, targetUserDoc) {
  try {
    const referrerId = referralDoc.user_id?._id || referralDoc.user_id;
    const rid = referralIdOf(referralDoc);
    if (!referrerId || !rid) return;
    const name = userDisplayName(targetUserDoc);
    const body = `${name} accepted your referral.`;
    await persistAndEmit(referrerId, {
      notification_type: 'referral_accepted',
      title: 'Referral accepted',
      body,
      severity: 'info',
      lead_match_id: leadMatchIdStr(referralDoc),
      action: { type: 'open_referral', referral_id: rid, direction: 'outbound' },
    });
  } catch (e) {
    logger.warn('notifyReferralAccepted failed', { error: e?.message });
  }
}

/** Notify the *other* party when status becomes rejected (recipient declined or referrer withdrew). */
export async function notifyReferralRejected(referralDoc, actorUserId, actorUserDoc) {
  try {
    const referrerId = referralDoc.user_id?._id || referralDoc.user_id;
    const targetId = referralDoc.target_user_id?._id || referralDoc.target_user_id;
    const rid = referralIdOf(referralDoc);
    if (!rid) return;
    const actorStr = String(actorUserId);
    const actorIsTarget = actorStr === String(targetId);
    const recipientId = actorIsTarget ? referrerId : targetId;
    if (!recipientId) return;
    const name = userDisplayName(actorUserDoc);
    const body = actorIsTarget
      ? `${name} declined your referral.`
      : `${name} withdrew the referral.`;
    await persistAndEmit(recipientId, {
      notification_type: 'referral_rejected',
      title: 'Referral declined',
      body,
      severity: 'info',
      lead_match_id: leadMatchIdStr(referralDoc),
      action: {
        type: 'open_referral',
        referral_id: rid,
        direction: actorIsTarget ? 'outbound' : 'inbound',
      },
    });
  } catch (e) {
    logger.warn('notifyReferralRejected failed', { error: e?.message });
  }
}
