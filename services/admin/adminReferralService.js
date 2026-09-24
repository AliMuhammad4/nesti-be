import mongoose from 'mongoose';
import Referral from '../../models/Referral.js';
import {
  USER_LIST,
  USER_PUBLIC,
  parsePaging,
  applyDateRange,
  parseSort,
  findUserIdsBySearch,
  ok,
  fail,
  serializeUser,
} from './adminCommon.js';
import {
  mapReferralsListToApiItems,
  patchReferralForUser as patchReferralForUserImpl,
  processReferralForTarget as processReferralForTargetImpl,
} from '../referral/referralService.js';
import { recordAdminAudit as recordAdminAuditImpl } from './adminAuditService.js';

/** Mutable for tests — production uses the real implementations. */
export const adminReferralDeps = {
  patchReferralForUser: patchReferralForUserImpl,
  processReferralForTarget: processReferralForTargetImpl,
  recordAdminAudit: recordAdminAuditImpl,
};

const REFERRAL_LIST_POPULATE =
  'first_name last_name full_name email role profile_image';

export async function listAdminReferralsService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  applyDateRange(filter, query, 'createdAt');

  const ownerUserIdRaw = query.user_id != null ? String(query.user_id).trim() : '';
  if (ownerUserIdRaw) {
    if (!mongoose.Types.ObjectId.isValid(ownerUserIdRaw)) {
      return fail(400, 'Invalid owner user id');
    }
  }
  const ownerUserId = ownerUserIdRaw;
  const ownerScoped = Boolean(ownerUserId);
  const direction = String(query.direction || '').trim().toLowerCase();

  if (ownerScoped) {
    // Same inbound/outbound split as GET /api/referrals?direction=
    if (direction === 'outbound') {
      filter.user_id = ownerUserId;
    } else if (direction === 'inbound') {
      filter.target_user_id = ownerUserId;
    } else {
      filter.$or = [{ user_id: ownerUserId }, { target_user_id: ownerUserId }];
    }
  } else if (query.q) {
    const userIds = await findUserIdsBySearch(query.q);
    if (!userIds?.length) {
      return ok({
        items: [],
        pagination: { page, limit, total: 0, pages: 1 },
      });
    }
    filter.$or = [{ user_id: { $in: userIds } }, { target_user_id: { $in: userIds } }];
  }

  const sort = parseSort(query, ['createdAt', 'updatedAt'], { createdAt: -1 });

  const [items, total] = await Promise.all([
    Referral.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('user_id', ownerScoped ? REFERRAL_LIST_POPULATE : USER_LIST)
      .populate('target_user_id', ownerScoped ? REFERRAL_LIST_POPULATE : USER_LIST)
      .lean(),
    Referral.countDocuments(filter),
  ]);

  let counts;
  if (ownerScoped) {
    const [inbound_total, outbound_total, inbound_pending_total] = await Promise.all([
      Referral.countDocuments({ target_user_id: ownerUserId }),
      Referral.countDocuments({ user_id: ownerUserId }),
      Referral.countDocuments({ target_user_id: ownerUserId, status: 'pending' }),
    ]);
    counts = { inbound_total, outbound_total, inbound_pending_total };
  }

  // Owner-scoped lists use the same row shape as the professional referrals table.
  const mappedItems = ownerScoped
    ? await mapReferralsListToApiItems(items, ownerUserId)
    : items.map((row) => ({
      id: String(row._id),
      status: row.status,
      target_vertical: row.target_vertical,
      notes: row.notes || '',
      lead_match_id: row.lead_match_id ? String(row.lead_match_id) : null,
      from_user: serializeUser(row.user_id),
      to_user: serializeUser(row.target_user_id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

  return ok({
    items: mappedItems,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    ...(counts ? { counts } : {}),
  });
}

export async function getAdminReferralService(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid referral id');
  const row = await Referral.findById(id)
    .populate('user_id', USER_PUBLIC)
    .populate('target_user_id', USER_PUBLIC)
    .lean();
  if (!row) return fail(404, 'Referral not found');
  return ok({
    referral: {
      ...row,
      id: String(row._id),
      from_user: serializeUser(row.user_id),
      to_user: serializeUser(row.target_user_id),
    },
  });
}

/**
 * Admin referral patch — status changes go through professional referral helpers
 * (patchReferralForUser / processReferralForTarget), not a direct status save.
 */
export async function patchAdminReferralService(id, patch = {}, actorUser = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid referral id');
  const row = await Referral.findById(id);
  if (!row) return fail(404, 'Referral not found');

  const actorId = actorUser?._id || actorUser?.id || null;
  const prevStatus = String(row.status || '');
  const nextStatus =
    patch.status !== undefined && patch.status !== null && String(patch.status).trim() !== ''
      ? String(patch.status).trim()
      : '';
  const notesProvided = patch.notes !== undefined;
  const { processReferralForTarget, patchReferralForUser, recordAdminAudit } = adminReferralDeps;

  try {
    if (nextStatus === 'accepted') {
      const processed = await processReferralForTarget(row, row.target_user_id);
      if (!processed.ok) {
        await recordAdminAudit({
          actorUserId: actorId,
          onBehalfOfUserId: row.target_user_id,
          action: 'referral.patch',
          targetType: 'Referral',
          targetId: id,
          meta: { status: nextStatus, via: 'processReferralForTarget' },
          outcome: 'error',
          errorMessage: processed.message,
        });
        return fail(processed.code || 400, processed.message || 'Could not process referral');
      }
      if (notesProvided) {
        const notesResult = await patchReferralForUser(row.target_user_id, id, {
          notes: patch.notes,
        });
        if (!notesResult.ok) {
          await recordAdminAudit({
            actorUserId: actorId,
            onBehalfOfUserId: row.target_user_id,
            action: 'referral.patch',
            targetType: 'Referral',
            targetId: id,
            meta: { notes: true, via: 'patchReferralForUser' },
            outcome: 'error',
            errorMessage: notesResult.message,
          });
          return fail(notesResult.code || 400, notesResult.message || 'Could not update notes');
        }
      }
    } else {
      // Reject/complete/pending transitions should act as the party that owns that action.
      // Target owns reject/complete; referrer owns pending/notes-only updates.
      const actingAs =
        nextStatus === 'rejected' || nextStatus === 'completed'
          ? row.target_user_id
          : row.user_id;
      const result = await patchReferralForUser(actingAs, id, {
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(notesProvided ? { notes: patch.notes } : {}),
      });
      if (!result.ok) {
        await recordAdminAudit({
          actorUserId: actorId,
          onBehalfOfUserId: actingAs,
          action: 'referral.patch',
          targetType: 'Referral',
          targetId: id,
          meta: { status: nextStatus || null, notes: notesProvided, via: 'patchReferralForUser' },
          outcome: 'error',
          errorMessage: result.message,
        });
        return fail(result.code || 400, result.message || 'Could not update referral');
      }
    }

    await recordAdminAudit({
      actorUserId: actorId,
      onBehalfOfUserId:
        nextStatus === 'accepted' || nextStatus === 'rejected' || nextStatus === 'completed'
          ? row.target_user_id
          : row.user_id,
      action: 'referral.patch',
      targetType: 'Referral',
      targetId: id,
      meta: {
        prev_status: prevStatus,
        status: nextStatus || prevStatus,
        notes_updated: notesProvided,
      },
      outcome: 'ok',
    });

    return getAdminReferralService(id);
  } catch (err) {
    await recordAdminAudit({
      actorUserId: actorId,
      action: 'referral.patch',
      targetType: 'Referral',
      targetId: id,
      outcome: 'error',
      errorMessage: err?.message,
    });
    throw err;
  }
}
