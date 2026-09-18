import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import ClientProfile from '../../models/ClientProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import Subscription from '../../models/Subscription.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import Referral from '../../models/Referral.js';
import InviteLink from '../../models/InviteLink.js';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import { USER_ROLE } from '../../constants/roles.js';
import { CREDENTIAL_STATUS } from '../../constants/credentialDocuments.js';
import { BILLING_PLANS } from '../billing/plans.js';
import { CLIENT_PLANS } from '../client/plans.js';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function normalizeRange(range) {
  const aliases = {
    '1m': '30d',
    '3m': '90d',
    '6m': '180d',
    '1y': '365d',
  };
  return aliases[range] || range || '30d';
}

function rangeToDays(range) {
  const normalized = normalizeRange(range);
  if (normalized === '7d') return 7;
  if (normalized === '90d') return 90;
  if (normalized === '180d') return 180;
  if (normalized === '365d') return 365;
  return 30;
}

function buildDayBuckets(days) {
  const buckets = [];
  const today = startOfDay(new Date());
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.push(dayKey(d));
  }
  return buckets;
}

function startOfWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday start
  d.setDate(d.getDate() - diff);
  return d;
}

function weekKey(date) {
  return dayKey(startOfWeek(date));
}

function buildWeekBuckets(days) {
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setDate(today.getDate() - (days - 1));
  const firstWeek = startOfWeek(start);
  const buckets = [];
  const cursor = new Date(firstWeek);
  while (cursor <= today) {
    buckets.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return buckets;
}

function buildSeriesBuckets(days) {
  if (days > 90) {
    return { keys: buildWeekBuckets(days), grain: 'week' };
  }
  return { keys: buildDayBuckets(days), grain: 'day' };
}

function emptyDayMap(days, extra = {}) {
  const map = {};
  for (const key of days) {
    map[key] = { date: key, total: 0, ...structuredClone(extra) };
  }
  return map;
}

function seriesBucketKey(date, grain) {
  return grain === 'week' ? weekKey(date) : dayKey(date);
}

async function countCreatedSince(Model, since, filter = {}) {
  return Model.countDocuments({ ...filter, createdAt: { $gte: since } });
}

export async function getAdminOverviewService() {
  const now = new Date();
  const since7 = new Date(now);
  since7.setDate(since7.getDate() - 7);
  const since30 = new Date(now);
  since30.setDate(since30.getDate() - 30);

  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    usersByRole,
    totalProfessionals,
    professionalsByType,
    totalClients,
    totalLeads,
    openLeads,
    closedLeads,
    propertyInquiries,
    proSubsByStatus,
    clientSubsByStatus,
    totalReferrals,
    invites7d,
    calls7d,
    newUsers7d,
    newUsers30d,
    newClients7d,
    newClients30d,
    newPros7d,
    newPros30d,
    newLeads7d,
    newLeads30d,
    recentUsers,
    recentLeads,
    pendingVerifications,
    approvedVerifications,
    rejectedVerifications,
    activePaidProByPlan,
    activePaidClientByTier,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ is_active: { $ne: false } }),
    User.countDocuments({ is_active: false }),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    ProfessionalProfile.countDocuments({}),
    ProfessionalProfile.aggregate([{ $group: { _id: '$professional_type', count: { $sum: 1 } } }]),
    ClientProfile.countDocuments({}),
    LeadMatch.countDocuments({}),
    LeadMatch.countDocuments({ match_status: { $nin: ['converted', 'closed_lost'] } }),
    LeadMatch.countDocuments({ match_status: { $in: ['converted', 'closed_lost'] } }),
    LeadMatch.countDocuments({
      $or: [
        { 'compatibility_factors.inquired_property_id': { $exists: true, $nin: [null, ''] } },
        { 'compatibility_factors.inquired_property': { $exists: true, $ne: null } },
      ],
    }),
    Subscription.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ClientSubscription.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Referral.countDocuments({}),
    countCreatedSince(InviteLink, since7),
    countCreatedSince(ProfessionalCall, since7),
    countCreatedSince(User, since7),
    countCreatedSince(User, since30),
    countCreatedSince(ClientProfile, since7),
    countCreatedSince(ClientProfile, since30),
    countCreatedSince(ProfessionalProfile, since7),
    countCreatedSince(ProfessionalProfile, since30),
    countCreatedSince(LeadMatch, since7),
    countCreatedSince(LeadMatch, since30),
    User.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select('first_name last_name email role is_active is_verified createdAt')
      .lean(),
    LeadMatch.find({})
      .sort({ createdAt: -1 })
      .limit(8)
      .select('match_status lead_type user_id createdAt compatibility_factors')
      .populate('user_id', 'first_name last_name email role')
      .lean(),
    ProfessionalProfile.countDocuments({ credential_status: CREDENTIAL_STATUS.PENDING_REVIEW }),
    ProfessionalProfile.countDocuments({ credential_status: CREDENTIAL_STATUS.APPROVED }),
    ProfessionalProfile.countDocuments({ credential_status: CREDENTIAL_STATUS.REJECTED }),
    Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$plan_key', count: { $sum: 1 } } },
    ]),
    ClientSubscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$tier', count: { $sum: 1 } } },
    ]),
  ]);

  const roleMap = Object.fromEntries(usersByRole.map((r) => [r._id || 'unknown', r.count]));
  const proTypeMap = Object.fromEntries(professionalsByType.map((r) => [r._id || 'unknown', r.count]));
  const proSubMap = Object.fromEntries(proSubsByStatus.map((r) => [r._id || 'unknown', r.count]));
  const clientSubMap = Object.fromEntries(clientSubsByStatus.map((r) => [r._id || 'unknown', r.count]));

  const activeProSubs = (proSubMap.active || 0) + (proSubMap.trialing || 0);
  const trialProSubs = proSubMap.free_trial || 0;
  const expiredProSubs = (proSubMap.expired || 0) + (proSubMap.canceled || 0);
  const activeClientSubs = (clientSubMap.active || 0) + (clientSubMap.trialing || 0);

  let estimatedMrrCents = 0;
  for (const row of activePaidProByPlan || []) {
    const plan = BILLING_PLANS[String(row._id || '').toLowerCase()];
    if (plan?.amount) estimatedMrrCents += Number(plan.amount) * Number(row.count || 0);
  }
  for (const row of activePaidClientByTier || []) {
    const plan = CLIENT_PLANS[String(row._id || '').toLowerCase()];
    if (plan?.amount) estimatedMrrCents += Number(plan.amount) * Number(row.count || 0);
  }

  const paidProCount = proSubMap.active || 0;
  const conversionDenom = paidProCount + trialProSubs;
  const trialToPaidConversion =
    conversionDenom > 0 ? Math.round((paidProCount / conversionDenom) * 1000) / 10 : 0;

  return {
    status: 200,
    body: {
      success: true,
      kpis: {
        users: { total: totalUsers, active: activeUsers, suspended: suspendedUsers, by_role: roleMap },
        professionals: { total: totalProfessionals, by_type: proTypeMap },
        clients: { total: totalClients },
        leads: { total: totalLeads, open: openLeads, closed: closedLeads },
        properties: { inquired: propertyInquiries },
        subscriptions: {
          professional: {
            by_status: proSubMap,
            active: activeProSubs,
            free_trial: trialProSubs,
            expired_or_canceled: expiredProSubs,
            paid: paidProCount,
          },
          client: {
            by_status: clientSubMap,
            active: activeClientSubs,
          },
          estimated_mrr_cents: estimatedMrrCents,
          estimated_mrr: estimatedMrrCents / 100,
          trial_to_paid_conversion_pct: trialToPaidConversion,
        },
        referrals: { total: totalReferrals },
        invites_7d: invites7d,
        calls_7d: calls7d,
        growth: {
          users_7d: newUsers7d,
          users_30d: newUsers30d,
          clients_7d: newClients7d,
          clients_30d: newClients30d,
          professionals_7d: newPros7d,
          professionals_30d: newPros30d,
          leads_7d: newLeads7d,
          leads_30d: newLeads30d,
        },
        verifications: {
          pending_review: pendingVerifications,
          approved: approvedVerifications,
          rejected: rejectedVerifications,
        },
      },
      recent: {
        users: recentUsers,
        leads: recentLeads.map((lead) => ({
          id: String(lead._id),
          match_status: lead.match_status,
          lead_type: lead.lead_type,
          createdAt: lead.createdAt,
          professional: lead.user_id
            ? {
                id: String(lead.user_id._id || lead.user_id),
                name: [lead.user_id.first_name, lead.user_id.last_name].filter(Boolean).join(' '),
                email: lead.user_id.email,
                role: lead.user_id.role,
              }
            : null,
          property_title:
            lead.compatibility_factors?.inquired_property_title
            || lead.compatibility_factors?.inquired_property?.title
            || null,
        })),
      },
    },
  };
}

export async function getAdminAnalyticsService({ range = '30d' } = {}) {
  const normalizedRange = normalizeRange(range);
  const days = rangeToDays(normalizedRange);
  const { keys: bucketKeys, grain } = buildSeriesBuckets(days);
  const since = startOfDay(new Date());
  since.setDate(since.getDate() - (days - 1));

  const roleExtras = {
    [USER_ROLE.AGENT]: 0,
    [USER_ROLE.MORTGAGE_BROKER]: 0,
    [USER_ROLE.LAWYER]: 0,
    [USER_ROLE.CLIENT]: 0,
    [USER_ROLE.ADMIN]: 0,
  };

  const createdInRange = { createdAt: { $gte: since } };

  const [
    users,
    leads,
    proSubs,
    clientSubs,
    propertyLeads,
    roleMix,
    proSubMix,
    clientSubMix,
    leadStatusMix,
    topPros,
  ] = await Promise.all([
    User.find(createdInRange).select('role createdAt').lean(),
    LeadMatch.find(createdInRange).select('match_status createdAt').lean(),
    Subscription.find(createdInRange).select('status createdAt').lean(),
    ClientSubscription.find(createdInRange).select('status createdAt').lean(),
    LeadMatch.find({
      ...createdInRange,
      $or: [
        { 'compatibility_factors.inquired_property_id': { $exists: true, $nin: [null, ''] } },
        { 'compatibility_factors.inquired_property': { $exists: true, $ne: null } },
      ],
    })
      .select('createdAt')
      .lean(),
    User.aggregate([
      { $match: createdInRange },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
    Subscription.aggregate([
      { $match: createdInRange },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    ClientSubscription.aggregate([
      { $match: createdInRange },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    LeadMatch.aggregate([
      { $match: createdInRange },
      { $group: { _id: '$match_status', count: { $sum: 1 } } },
    ]),
    LeadMatch.aggregate([
      { $match: createdInRange },
      { $group: { _id: '$user_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          count: 1,
          first_name: '$user.first_name',
          last_name: '$user.last_name',
          email: '$user.email',
          role: '$user.role',
        },
      },
    ]),
  ]);

  const signupsByDay = emptyDayMap(bucketKeys, roleExtras);
  for (const user of users) {
    const key = seriesBucketKey(user.createdAt, grain);
    if (!signupsByDay[key]) continue;
    signupsByDay[key].total += 1;
    if (user.role && signupsByDay[key][user.role] !== undefined) {
      signupsByDay[key][user.role] += 1;
    }
  }

  const leadsByDay = emptyDayMap(bucketKeys, { open: 0, closed: 0 });
  for (const lead of leads) {
    const key = seriesBucketKey(lead.createdAt, grain);
    if (!leadsByDay[key]) continue;
    leadsByDay[key].total += 1;
    if (['converted', 'closed_lost'].includes(lead.match_status)) {
      leadsByDay[key].closed += 1;
    } else {
      leadsByDay[key].open += 1;
    }
  }

  const subscriptionsByDay = emptyDayMap(bucketKeys, { active: 0, canceled: 0, trial: 0 });
  const allSubs = [
    ...proSubs.map((s) => ({ ...s, kind: 'professional' })),
    ...clientSubs.map((s) => ({ ...s, kind: 'client' })),
  ];
  for (const sub of allSubs) {
    const key = seriesBucketKey(sub.createdAt, grain);
    if (!subscriptionsByDay[key]) continue;
    subscriptionsByDay[key].total += 1;
    if (sub.status === 'free_trial' || sub.status === 'trialing') subscriptionsByDay[key].trial += 1;
    else if (['canceled', 'expired', 'unpaid'].includes(sub.status)) subscriptionsByDay[key].canceled += 1;
    else if (['active'].includes(sub.status)) subscriptionsByDay[key].active += 1;
  }

  const propertiesByDay = emptyDayMap(bucketKeys);
  for (const row of propertyLeads) {
    const key = seriesBucketKey(row.createdAt, grain);
    if (!propertiesByDay[key]) continue;
    propertiesByDay[key].total += 1;
  }

  return {
    status: 200,
    body: {
      success: true,
      range: normalizedRange,
      grain,
      series: {
        signupsByDay: bucketKeys.map((k) => signupsByDay[k]),
        leadsByDay: bucketKeys.map((k) => leadsByDay[k]),
        subscriptionsByDay: bucketKeys.map((k) => subscriptionsByDay[k]),
        propertiesByDay: bucketKeys.map((k) => propertiesByDay[k]),
      },
      mixes: {
        roleMix: roleMix.map((r) => ({ name: r._id || 'unknown', value: r.count })),
        subscriptionMix: [
          ...proSubMix.map((r) => ({ name: `pro:${r._id || 'unknown'}`, value: r.count })),
          ...clientSubMix.map((r) => ({ name: `client:${r._id || 'unknown'}`, value: r.count })),
        ],
        leadStatusMix: leadStatusMix.map((r) => ({ name: r._id || 'unknown', value: r.count })),
      },
      topProfessionalsByLeads: topPros.map((row) => ({
        id: String(row._id),
        name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Professional',
        email: row.email || '',
        role: row.role || '',
        leads: row.count,
      })),
    },
  };
}
