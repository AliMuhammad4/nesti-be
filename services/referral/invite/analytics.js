import mongoose from 'mongoose';
import InviteLink from '../../../models/InviteLink.js';
import InviteAttribution from '../../../models/InviteAttribution.js';
import { getReferralRewardsSummary } from '../rewardService.js';
import { buildNetworkCircleMetrics } from '../networkCircle.js';
import { clampWindowDays, sinceDaysAgo } from './helpers.js';

function lookupInviterStages(uid, since, extraMatch = {}) {
  return [
    {
      $lookup: {
        from: 'invitelinks',
        localField: 'invite_link_id',
        foreignField: '_id',
        as: 'invite_link',
      },
    },
    { $unwind: '$invite_link' },
    { $match: { 'invite_link.inviter_user_id': uid, createdAt: { $gte: since }, ...extraMatch } },
  ];
}

function mapConversionRow(row) {
  return {
    id: String(row._id),
    consumed_at: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
    source_channel: row.source_channel || '',
    landing_path: row.landing_path || '',
    invite_link: row.invite_link
      ? {
          id: String(row.invite_link._id),
          intended_role: row.invite_link.intended_role || '',
          intended_audience: row.invite_link.intended_audience || 'any',
          source_channel: row.invite_link.source_channel || '',
          source_conversation_id: row.invite_link.source_conversation_id
            ? String(row.invite_link.source_conversation_id)
            : null,
          created_at: row.invite_link.createdAt ? new Date(row.invite_link.createdAt).toISOString() : null,
          share_url: row.invite_link.share_url || '',
        }
      : null,
    joined_user: row.consumed_user?._id
      ? {
          id: String(row.consumed_user._id),
          full_name:
            String(row.consumed_user.full_name || '').trim() ||
            [row.consumed_user.first_name, row.consumed_user.last_name]
              .filter(Boolean)
              .join(' ')
              .trim() ||
            null,
          email: row.consumed_user.email || null,
          role: row.consumed_user.role || null,
          profile_image: row.consumed_user.profile_image || null,
        }
      : null,
  };
}

export async function getInviteMetricsForUser(inviter_user_id, { days = 30 } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) {
    return {
      window_days: 30,
      totals: { invites_sent: 0, clicked: 0, pending: 0, completed: 0, conversion_rate: 0 },
      by_channel: [],
      points: { points_balance: 0, events_count: 0, last_event_at: null },
      network_circle: await buildNetworkCircleMetrics(inviter_user_id, { days: 30 }),
    };
  }

  const uid = new mongoose.Types.ObjectId(String(inviter_user_id));
  const windowDays = clampWindowDays(days);
  const since = sinceDaysAgo(windowDays);

  const [invitesSent, aggByChannel, summaryAgg, points] = await Promise.all([
    InviteLink.countDocuments({ inviter_user_id: uid, createdAt: { $gte: since } }),
    InviteAttribution.aggregate([
      ...lookupInviterStages(uid, since),
      {
        $group: {
          _id: '$source_channel',
          clicked: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
        },
      },
    ]),
    InviteAttribution.aggregate([
      ...lookupInviterStages(uid, since),
      {
        $group: {
          _id: null,
          clicked: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
        },
      },
    ]),
    getReferralRewardsSummary(uid),
  ]);

  const totals = summaryAgg?.[0] || { clicked: 0, pending: 0, completed: 0 };
  const clicked = Number(totals.clicked || 0);
  const latestInvite = await InviteLink.findOne({ inviter_user_id: uid, is_active: true })
    .sort({ createdAt: -1 })
    .lean();

  const network_circle = await buildNetworkCircleMetrics(uid, { days: windowDays });

  return {
    window_days: windowDays,
    totals: {
      invites_sent: Number(invitesSent || 0),
      clicked,
      pending: Number(totals.pending || 0),
      completed: Number(totals.completed || 0),
      conversion_rate: clicked > 0 ? Number((Number(totals.completed) / clicked).toFixed(3)) : 0,
    },
    by_channel: aggByChannel.map((row) => ({
      channel: row._id || 'direct',
      clicked: Number(row.clicked || 0),
      pending: Number(row.pending || 0),
      completed: Number(row.completed || 0),
    })),
    points: {
      ...points,
      tier: points.tier || 'bronze',
      reputation_score: points.reputation_score ?? 50,
      referral_link: latestInvite?.metadata?.share_url || null,
    },
    network_circle,
  };
}

export async function listInviteConversionsForUser(inviter_user_id, { days = 30, page = 1, limit = 10 } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) {
    return {
      window_days: 30,
      items: [],
      pagination: {
        page: 1,
        current_page: 1,
        limit: 10,
        total: 0,
        total_pages: 0,
        has_prev_page: false,
        has_next_page: false,
        has_more: false,
      },
    };
  }

  const uid = new mongoose.Types.ObjectId(String(inviter_user_id));
  const windowDays = clampWindowDays(days);
  const p = Math.max(Number(page) || 1, 1);
  const l = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const skip = (p - 1) * l;
  const since = sinceDaysAgo(windowDays);

  const rows = await InviteAttribution.aggregate([
    {
      $lookup: {
        from: 'invitelinks',
        localField: 'invite_link_id',
        foreignField: '_id',
        as: 'invite_link',
      },
    },
    { $unwind: '$invite_link' },
    {
      $match: {
        'invite_link.inviter_user_id': uid,
        status: 'converted',
        consumed_by_user_id: { $ne: null },
        consumed_at: { $gte: since },
      },
    },
    { $sort: { consumed_at: -1 } },
    {
      $facet: {
        meta: [{ $count: 'total' }],
        items: [
          { $skip: skip },
          { $limit: l },
          {
            $lookup: {
              from: 'users',
              localField: 'consumed_by_user_id',
              foreignField: '_id',
              as: 'consumed_user',
            },
          },
          { $unwind: { path: '$consumed_user', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              consumed_at: 1,
              source_channel: 1,
              landing_path: 1,
              invite_link: {
                _id: '$invite_link._id',
                intended_role: '$invite_link.intended_role',
                intended_audience: '$invite_link.intended_audience',
                source_channel: '$invite_link.source_channel',
                source_conversation_id: '$invite_link.source_conversation_id',
                createdAt: '$invite_link.createdAt',
                share_url: '$invite_link.metadata.share_url',
              },
              consumed_user: {
                _id: '$consumed_user._id',
                full_name: '$consumed_user.full_name',
                first_name: '$consumed_user.first_name',
                last_name: '$consumed_user.last_name',
                email: '$consumed_user.email',
                role: '$consumed_user.role',
                profile_image: '$consumed_user.profile_image',
              },
            },
          },
        ],
      },
    },
  ]);

  const payload = rows?.[0] || {};
  const total = payload?.meta?.[0]?.total || 0;
  const total_pages = total > 0 ? Math.ceil(total / l) : 0;

  return {
    window_days: windowDays,
    items: (payload?.items || []).map(mapConversionRow),
    pagination: {
      page: p,
      current_page: p,
      limit: l,
      total,
      total_pages,
      has_prev_page: p > 1,
      has_next_page: p < total_pages,
      has_more: p < total_pages,
    },
  };
}

export async function getInviteConversionRoleTrendsForUser(inviter_user_id, { days = 30 } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) {
    return { window_days: 30, roles: [], series: [], total: 0 };
  }

  const uid = new mongoose.Types.ObjectId(String(inviter_user_id));
  const windowDays = clampWindowDays(days);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (windowDays - 1));

  const rows = await InviteAttribution.aggregate([
    {
      $match: {
        status: 'converted',
        consumed_by_user_id: { $ne: null },
        consumed_at: { $gte: since },
      },
    },
    {
      $lookup: {
        from: 'invitelinks',
        localField: 'invite_link_id',
        foreignField: '_id',
        as: 'invite_link',
      },
    },
    { $unwind: '$invite_link' },
    { $match: { 'invite_link.inviter_user_id': uid } },
    {
      $lookup: {
        from: 'users',
        localField: 'consumed_by_user_id',
        foreignField: '_id',
        as: 'consumed_user',
      },
    },
    { $unwind: { path: '$consumed_user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        day: { $dateToString: { date: '$consumed_at', format: '%Y-%m-%d', timezone: 'UTC' } },
        role: {
          $ifNull: [
            '$consumed_user.role',
            {
              $cond: [
                { $ne: ['$invite_link.intended_role', ''] },
                '$invite_link.intended_role',
                'unknown',
              ],
            },
          ],
        },
      },
    },
    { $group: { _id: { day: '$day', role: '$role' }, count: { $sum: 1 } } },
    { $sort: { '_id.day': 1, '_id.role': 1 } },
  ]);

  const roles = [];
  const roleSet = new Set();
  const countsByDay = new Map();
  let total = 0;

  for (const row of rows) {
    const day = row?._id?.day;
    const role = String(row?._id?.role || 'unknown').trim().toLowerCase() || 'unknown';
    const count = Number(row?.count || 0);
    if (!day || count <= 0) continue;
    if (!roleSet.has(role)) {
      roleSet.add(role);
      roles.push(role);
    }
    const dayCounts = countsByDay.get(day) || {};
    dayCounts[role] = count;
    countsByDay.set(day, dayCounts);
    total += count;
  }

  const formatter = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', timeZone: 'UTC' });
  const series = Array.from({ length: windowDays }, (_, idx) => {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + idx);
    const date = d.toISOString().slice(0, 10);
    const counts = countsByDay.get(date) || {};
    return {
      date,
      label: formatter.format(d),
      ...roles.reduce((acc, role) => {
        acc[role] = Number(counts[role] || 0);
        return acc;
      }, {}),
    };
  });

  return { window_days: windowDays, roles, series, total };
}
