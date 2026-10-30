import mongoose from 'mongoose';
import ClientProfile from '../../models/ClientProfile.js';
import ClientSubscription, {
  CLIENT_SUBSCRIPTION_STATUSES,
} from '../../models/ClientSubscription.js';
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

const LIST_SELECT =
  'user_id preferred_location purchase_timeline dream_home_price current_savings home_goal employment_status createdAt updatedAt';

export async function listAdminClientsService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const filter = {};
  applyDateRange(filter, query, 'createdAt');

  if (query.q) {
    const userIds = await findUserIdsBySearch(query.q);
    if (!userIds?.length) {
      return ok({
        items: [],
        pagination: { page, limit, total: 0, pages: 1 },
      });
    }
    filter.user_id = { $in: userIds };
  }

  if (query.status && CLIENT_SUBSCRIPTION_STATUSES.includes(String(query.status))) {
    const subs = await ClientSubscription.find({ status: query.status }).select('user_id').lean();
    const subUserIds = subs.map((s) => s.user_id);
    if (!subUserIds.length) {
      return ok({
        items: [],
        pagination: { page, limit, total: 0, pages: 1 },
      });
    }
    if (filter.user_id?.$in) {
      const allow = new Set(subUserIds.map(String));
      const intersected = filter.user_id.$in.filter((id) => allow.has(String(id)));
      if (!intersected.length) {
        return ok({
          items: [],
          pagination: { page, limit, total: 0, pages: 1 },
        });
      }
      filter.user_id = { $in: intersected };
    } else {
      filter.user_id = { $in: subUserIds };
    }
  }

  const sort = parseSort(query, ['createdAt', 'updatedAt'], { updatedAt: -1 });

  const [items, total] = await Promise.all([
    ClientProfile.find(filter)
      .select(LIST_SELECT)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('user_id', USER_LIST)
      .lean(),
    ClientProfile.countDocuments(filter),
  ]);

  return ok({
    items: items.map((row) => ({
      id: String(row._id),
      user: serializeUser(row.user_id),
      preferred_location: row.preferred_location || '',
      purchase_timeline: row.purchase_timeline || null,
      dream_home_price: row.dream_home_price,
      current_savings: row.current_savings,
      home_goal: row.home_goal || '',
      employment_status: row.employment_status || '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
}

export async function getAdminClientService(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid client id');
  const client = await ClientProfile.findById(id).populate('user_id', USER_PUBLIC).lean();
  if (!client) return fail(404, 'Client not found');
  const sub = await ClientSubscription.findOne({ user_id: client.user_id?._id || client.user_id }).lean();
  return ok({
    client: { ...client, id: String(client._id), user: serializeUser(client.user_id) },
    subscription: sub || null,
  });
}

export async function patchAdminClientService(id, patch = {}) {
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid client id');
  const client = await ClientProfile.findById(id);
  if (!client) return fail(404, 'Client not found');
  for (const key of [
    'preferred_location',
    'purchase_timeline',
    'dream_home_price',
    'current_savings',
    'home_goal',
    'employment_status',
  ]) {
    if (patch[key] !== undefined) client[key] = patch[key];
  }
  await client.save();
  const populated = await ClientProfile.findById(id).populate('user_id', USER_PUBLIC).lean();
  return ok({
    client: { ...populated, id: String(populated._id), user: serializeUser(populated.user_id) },
  });
}
