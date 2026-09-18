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

export async function listAdminReferralsService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  applyDateRange(filter, query, 'createdAt');

  if (query.q) {
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
      .populate('user_id', USER_LIST)
      .populate('target_user_id', USER_LIST)
      .lean(),
    Referral.countDocuments(filter),
  ]);

  return ok({
    items: items.map((row) => ({
      id: String(row._id),
      status: row.status,
      target_vertical: row.target_vertical,
      notes: row.notes || '',
      lead_match_id: row.lead_match_id ? String(row.lead_match_id) : null,
      from_user: serializeUser(row.user_id),
      to_user: serializeUser(row.target_user_id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
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

export async function patchAdminReferralService(id, patch = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid referral id');
  const row = await Referral.findById(id);
  if (!row) return fail(404, 'Referral not found');
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.notes !== undefined) row.notes = patch.notes;
  await row.save();
  return getAdminReferralService(id);
}
