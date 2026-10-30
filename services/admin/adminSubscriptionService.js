import mongoose from 'mongoose';
import User from '../../models/User.js';
import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
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

function mapProRow(row) {
  return {
    id: String(row._id),
    kind: 'professional',
    user: serializeUser(row.user_id),
    plan_key: row.plan_key,
    status: row.status,
    trial_end: row.trial_end,
    current_period_end: row.current_period_end,
    cancel_at_period_end: row.cancel_at_period_end,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapClientRow(row) {
  return {
    id: String(row._id),
    kind: 'client',
    user: serializeUser(row.user_id),
    tier: row.tier,
    status: row.status,
    current_period_end: row.current_period_end,
    cancel_at_period_end: row.cancel_at_period_end,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function buildSubFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  applyDateRange(filter, query, 'updatedAt');
  if (query.q) {
    const userIds = await findUserIdsBySearch(query.q);
    if (!userIds?.length) return { empty: true, filter };
    filter.user_id = { $in: userIds };
  }
  return { empty: false, filter };
}

export async function listAdminSubscriptionsService(query = {}) {
  const { page, limit, skip } = parsePaging(query);
  const kind = query.kind || 'all';
  const sort = parseSort(query, ['createdAt', 'updatedAt'], { updatedAt: -1 });
  const { empty, filter } = await buildSubFilter(query);

  if (empty) {
    return ok({
      items: [],
      pagination: { page, limit, total: 0, pages: 1 },
    });
  }

  if (kind === 'client') {
    const [items, total] = await Promise.all([
      ClientSubscription.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('user_id', USER_LIST)
        .lean(),
      ClientSubscription.countDocuments(filter),
    ]);
    return ok({
      items: items.map(mapClientRow),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  }

  if (kind === 'professional') {
    const [items, total] = await Promise.all([
      Subscription.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('user_id', USER_LIST)
        .lean(),
      Subscription.countDocuments(filter),
    ]);
    return ok({
      items: items.map(mapProRow),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  }

  // kind=all: fetch skip+limit from each side, merge by updatedAt, then page-slice
  const fetchLimit = skip + limit;
  const [proItems, clientItems, proTotal, clientTotal] = await Promise.all([
    Subscription.find(filter)
      .sort({ updatedAt: -1 })
      .limit(fetchLimit)
      .populate('user_id', USER_LIST)
      .lean(),
    ClientSubscription.find(filter)
      .sort({ updatedAt: -1 })
      .limit(fetchLimit)
      .populate('user_id', USER_LIST)
      .lean(),
    Subscription.countDocuments(filter),
    ClientSubscription.countDocuments(filter),
  ]);

  const items = [...proItems.map(mapProRow), ...clientItems.map(mapClientRow)]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(skip, skip + limit);

  const total = proTotal + clientTotal;

  return ok({
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
}

export async function getAdminSubscriptionService(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return fail(400, 'Invalid user id');
  const user = await User.findById(userId).select(USER_PUBLIC).lean();
  if (!user) return fail(404, 'User not found');
  const [professional, client] = await Promise.all([
    Subscription.findOne({ user_id: userId }).lean(),
    ClientSubscription.findOne({ user_id: userId }).lean(),
  ]);
  return ok({
    user: serializeUser(user),
    subscription: { professional: professional || null, client: client || null },
  });
}

export async function patchAdminSubscriptionService(userId, patch = {}) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return fail(400, 'Invalid user id');
  const user = await User.findById(userId).select('_id role').lean();
  if (!user) return fail(404, 'User not found');

  if (patch.kind === 'client') {
    const sub = await ClientSubscription.findOne({ user_id: userId });
    if (!sub) {
      // Admin override without Stripe IDs — create placeholder row only if patching existing path fails.
      return fail(404, 'Client subscription not found for this user');
    }
    if (patch.tier !== undefined) sub.tier = patch.tier;
    if (patch.status !== undefined) sub.status = patch.status;
    if (patch.current_period_end !== undefined) sub.current_period_end = patch.current_period_end;
    if (patch.cancel_at_period_end !== undefined) sub.cancel_at_period_end = patch.cancel_at_period_end;
    await sub.save();
    return getAdminSubscriptionService(userId);
  }

  let sub = await Subscription.findOne({ user_id: userId });
  if (!sub) {
    sub = new Subscription({
      user_id: userId,
      plan_key: patch.plan_key || 'basic',
      status: patch.status || 'free_trial',
    });
  }
  if (patch.plan_key !== undefined) sub.plan_key = patch.plan_key;
  if (patch.status !== undefined) sub.status = patch.status;
  if (patch.trial_end !== undefined) sub.trial_end = patch.trial_end;
  if (patch.current_period_end !== undefined) sub.current_period_end = patch.current_period_end;
  if (patch.cancel_at_period_end !== undefined) sub.cancel_at_period_end = patch.cancel_at_period_end;
  await sub.save();
  return getAdminSubscriptionService(userId);
}
