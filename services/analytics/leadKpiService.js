import mongoose from 'mongoose';
import LeadKpiEvent from '../../models/LeadKpiEvent.js';
import LeadMatch from '../../models/LeadMatch.js';
import Referral from '../../models/Referral.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';

/**
 * Keep analytics lead counts aligned with GET /leads:
 * recipient-side referral LeadMatch rows are tracked under Referrals, not Leads.
 */
const VISIBLE_LEAD_MATCH_FILTER = {
  $or: [
    { 'compatibility_factors.referral_id': { $exists: false } },
    { 'compatibility_factors.referral_id': null },
  ],
};

function parseDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(Math.round(n), 365);
}

function sinceDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - parseDays(days));
  return d;
}

export async function recordLeadKpiEvent({
  user_id,
  lead_match_id = null,
  conversation_id = null,
  event_type,
  grade = null,
  appointment_status = null,
  urgency = null,
  metadata = null,
}) {
  if (!user_id || !event_type) return null;
  return LeadKpiEvent.create({
    user_id,
    lead_match_id,
    conversation_id,
    event_type,
    grade,
    appointment_status,
    urgency,
    metadata,
    occurred_at: new Date(),
  });
}

export async function getLeadKpiSummary(userId, { days = 30 } = {}) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const since = sinceDate(days);

  // Run all three queries in parallel — each uses its own indexed $match at the top
  // so MongoDB can use the existing indexes efficiently (no full collection scan).
  const [kpiRows, cohortAgg, closedWonAgg] = await Promise.all([
    LeadKpiEvent.aggregate([
      { $match: { user_id: uid, occurred_at: { $gte: since } } },
      { $group: { _id: '$event_type', count: { $sum: 1 } } },
    ]),
    LeadMatch.aggregate([
      { $match: { user_id: uid, createdAt: { $gte: since }, ...VISIBLE_LEAD_MATCH_FILTER } },
      {
        $group: {
          _id: null,
          leads_in_window: { $sum: 1 },
          closed_won_in_window: {
            $sum: { $cond: [{ $eq: ['$match_status', 'converted'] }, 1, 0] },
          },
        },
      },
    ]),
    LeadMatch.aggregate([
      {
        $match: {
          user_id: uid,
          updatedAt: { $gte: since },
          match_status: 'converted',
          ...VISIBLE_LEAD_MATCH_FILTER,
        },
      },
      { $count: 'n' },
    ]),
  ]);

  const byType = Object.fromEntries(kpiRows.map((r) => [r._id, r.count]));
  const totalEvents = kpiRows.reduce((s, r) => s + r.count, 0);
  const leadsInWindow = cohortAgg?.[0]?.leads_in_window ?? 0;
  const created = leadsInWindow;
  const booked = byType.appointment_booked || 0;
  const canceled = byType.appointment_canceled || 0;
  const updated = byType.lead_updated || 0;
  const views = byType.lead_viewed || 0;
  const nurtureEmails = byType.nurture_email_sent || 0;

  const closedWonCohort = cohortAgg?.[0]?.closed_won_in_window ?? 0;
  const dealsClosedWonInWindow = closedWonAgg?.[0]?.n ?? 0;

  return {
    window_days: parseDays(days),
    totals: {
      events: totalEvents,
      leads_created: created,
      leads_updated: updated,
      lead_views: views,
      nurture_emails_sent: nurtureEmails,
      appointments_booked: booked,
      appointments_canceled: canceled,
      // Count deals by when they were moved/kept in won during the selected window.
      leads_closed_won: dealsClosedWonInWindow,
      leads_closed_won_from_created_cohort: closedWonCohort,
      leads_in_window_for_conversion: leadsInWindow,
    },
    conversion_rates: {
      /** Leads with `match_status === 'converted'` ÷ LeadMatches created in the window (CRM win rate). */
      closed_won_from_created:
        leadsInWindow > 0 ? Number((closedWonCohort / leadsInWindow).toFixed(3)) : 0,
      booked_from_created: created > 0 ? Number((booked / created).toFixed(3)) : 0,
      canceled_from_booked: booked > 0 ? Number((canceled / booked).toFixed(3)) : 0,
    },
  };
}

function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** At most one lead_viewed per lead per UTC calendar day (Mongo-only dedupe). */
export async function recordLeadViewIfNeeded({
  user_id,
  lead_match_id,
  conversation_id = null,
  grade = null,
  metadata = null,
}) {
  const uid = new mongoose.Types.ObjectId(String(user_id));
  const lid = new mongoose.Types.ObjectId(String(lead_match_id));
  const since = startOfUtcDay();
  const n = await LeadKpiEvent.countDocuments({
    user_id: uid,
    lead_match_id: lid,
    event_type: 'lead_viewed',
    occurred_at: { $gte: since },
  });
  if (n > 0) return { recorded: false, deduped: true };
  await recordLeadKpiEvent({
    user_id,
    lead_match_id: lid,
    conversation_id,
    event_type: 'lead_viewed',
    grade,
    metadata,
  });
  return { recorded: true, deduped: false };
}

function serializeKpiEvent(row) {
  if (!row) return null;
  return {
    id: String(row._id),
    event_type: row.event_type,
    lead_match_id: row.lead_match_id ? String(row.lead_match_id) : null,
    conversation_id: row.conversation_id ? String(row.conversation_id) : null,
    grade: row.grade ?? null,
    appointment_status: row.appointment_status ?? null,
    urgency: row.urgency ?? null,
    metadata: row.metadata ?? null,
    occurred_at: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
  };
}

export async function getLeadKpiEventsForLead(userId, leadMatchId, { days = 30, limit = 100 } = {}) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const lid = new mongoose.Types.ObjectId(String(leadMatchId));
  const since = sinceDate(days);
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 200);
  const items = await LeadKpiEvent.find({
    user_id: uid,
    lead_match_id: lid,
    occurred_at: { $gte: since },
  })
    .sort({ occurred_at: 1 })
    .limit(lim)
    .lean();
  return {
    window_days: parseDays(days),
    events: items.map(serializeKpiEvent),
  };
}

/** Daily buckets (UTC) for dashboard charts. */
export async function getLeadKpiTimeseries(userId, { days = 30 } = {}) {
  const d = parseDays(days);
  const uid = new mongoose.Types.ObjectId(String(userId));
  const since = sinceDate(days);

  // Fix #5 — run both aggregations in parallel instead of sequentially
  const [rows, referralRows] = await Promise.all([
    LeadKpiEvent.aggregate([
    { $match: { user_id: uid, occurred_at: { $gte: since } } },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$occurred_at', timezone: 'UTC' } },
        },
        lead_created: {
          $sum: { $cond: [{ $eq: ['$event_type', 'lead_created'] }, 1, 0] },
        },
        lead_viewed: {
          $sum: { $cond: [{ $eq: ['$event_type', 'lead_viewed'] }, 1, 0] },
        },
        lead_updated: {
          $sum: { $cond: [{ $eq: ['$event_type', 'lead_updated'] }, 1, 0] },
        },
        appointment_booked: {
          $sum: { $cond: [{ $eq: ['$event_type', 'appointment_booked'] }, 1, 0] },
        },
        appointment_canceled: {
          $sum: { $cond: [{ $eq: ['$event_type', 'appointment_canceled'] }, 1, 0] },
        },
        nurture_email_sent: {
          $sum: { $cond: [{ $eq: ['$event_type', 'nurture_email_sent'] }, 1, 0] },
        },
      },
    },
    { $sort: { '_id.day': 1 } },
    {
      $project: {
        _id: 0,
        date: '$_id.day',
        lead_created: 1,
        lead_viewed: 1,
        lead_updated: 1,
        appointment_booked: 1,
        appointment_canceled: 1,
        nurture_email_sent: 1,
      },
    },
  ]),
    Referral.aggregate([
      {
        $match: {
          $or: [{ user_id: uid }, { target_user_id: uid }],
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          },
          inbound_referred: {
            $sum: { $cond: [{ $eq: ['$target_user_id', uid] }, 1, 0] },
          },
          outbound_referred: {
            $sum: { $cond: [{ $eq: ['$user_id', uid] }, 1, 0] },
          },
        },
      },
      { $sort: { '_id.day': 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id.day',
          inbound_referred: 1,
          outbound_referred: 1,
        },
      },
    ]),
  ]);

  const byDay = new Map(rows.map((r) => [r.date, r]));
  const referralsByDay = new Map(referralRows.map((r) => [r.date, r]));
  const series = [];
  for (let i = d - 1; i >= 0; i -= 1) {
    const dt = new Date();
    dt.setUTCHours(0, 0, 0, 0);
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const row = byDay.get(key);
    const ref = referralsByDay.get(key);
    series.push({
      date: key,
      label: `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`,
      lead_created: row?.lead_created || 0,
      lead_viewed: row?.lead_viewed || 0,
      lead_updated: row?.lead_updated || 0,
      appointment_booked: row?.appointment_booked || 0,
      appointment_canceled: row?.appointment_canceled || 0,
      nurture_email_sent: row?.nurture_email_sent || 0,
      inbound_referred: ref?.inbound_referred || 0,
      outbound_referred: ref?.outbound_referred || 0,
    });
  }

  return { window_days: d, series };
}

/**
 * Lawyer workspace: daily counts by transaction_type on qualification.lawyer
 * (purchase/refi/title vs home sale). Budget series unchanged (structured budget on profile).
 */
async function getLawyerIntentAndBudgetTrends(uid, d, since) {
  const rows = await LeadMatch.aggregate([
    { $match: { user_id: uid, createdAt: { $gte: since } } },
    {
      $lookup: {
        from: 'leadprofiles',
        localField: 'lead_profile_id',
        foreignField: '_id',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        tx: { $ifNull: ['$profile.qualification.lawyer.transaction_type', ''] },
        budget_min: { $ifNull: ['$profile.budget_profile.min_budget', null] },
        budget_max: { $ifNull: ['$profile.budget_profile.max_budget', null] },
      },
    },
    {
      $addFields: {
        budget_point: {
          $cond: [
            { $and: [{ $ne: ['$budget_min', null] }, { $ne: ['$budget_max', null] }] },
            { $divide: [{ $add: ['$budget_min', '$budget_max'] }, 2] },
            { $cond: [{ $ne: ['$budget_max', null] }, '$budget_max', '$budget_min'] },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$day',
        purchase_side: {
          $sum: {
            $cond: [{ $in: ['$tx', ['home_purchase', 'refinance', 'title_transfer']] }, 1, 0],
          },
        },
        sale_side: {
          $sum: { $cond: [{ $eq: ['$tx', 'home_sale'] }, 1, 0] },
        },
        budget_sum: {
          $sum: { $cond: [{ $ne: ['$budget_point', null] }, '$budget_point', 0] },
        },
        budget_count: {
          $sum: { $cond: [{ $ne: ['$budget_point', null] }, 1, 0] },
        },
      },
    },
  ]);

  const byDay = new Map(rows.map((r) => [r._id, r]));
  const intent = [];
  const budget = [];
  for (let i = d - 1; i >= 0; i -= 1) {
    const dt = new Date();
    dt.setUTCHours(0, 0, 0, 0);
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const label = `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`;
    const row = byDay.get(key);
    intent.push({
      date: key,
      label,
      purchase_side: row?.purchase_side || 0,
      sale_side: row?.sale_side || 0,
    });
    budget.push({
      date: key,
      label,
      budget_avg: row && row.budget_count > 0 ? Math.round(row.budget_sum / row.budget_count) : 0,
      sample_size: row?.budget_count || 0,
    });
  }

  return {
    window_days: d,
    intent_metric: 'lawyer_transaction',
    intent,
    budget,
  };
}

/**
 * Daily buckets of lead intent (buyers vs sellers for agents) and budget averages, grouped by the
 * day the LeadMatch was created. Joins the matching LeadProfile for intent + structured
 * budget. Produces one row per UTC day in the window, with zero-fill for empty days.
 *
 * For lawyer accounts, uses transaction_type on qualification.lawyer instead (purchase_side vs sale_side).
 */
export async function getLeadIntentAndBudgetTrends(userId, { days = 30, viewerRole = null } = {}) {
  const d = parseDays(days);
  const uid = new mongoose.Types.ObjectId(String(userId));
  const since = sinceDate(days);
  const roleNorm = String(viewerRole || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (roleNorm === PROFESSIONAL_TYPE.LAWYER || roleNorm === 'lawyer') {
    return getLawyerIntentAndBudgetTrends(uid, d, since);
  }

  const rows = await LeadMatch.aggregate([
    { $match: { user_id: uid, createdAt: { $gte: since } } },
    {
      $lookup: {
        from: 'leadprofiles',
        localField: 'lead_profile_id',
        foreignField: '_id',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        intent_resolved: {
          $let: {
            vars: {
              // Prefer profile intent, fall back to lead_type derivation ("buyer_lead" etc.)
              profIntent: { $ifNull: ['$profile.intent', null] },
              typeIntent: {
                $switch: {
                  branches: [
                    {
                      case: { $regexMatch: { input: { $ifNull: ['$lead_type', ''] }, regex: /buyer|client/i } },
                      then: 'buy',
                    },
                    {
                      case: { $regexMatch: { input: { $ifNull: ['$lead_type', ''] }, regex: /seller/i } },
                      then: 'sell',
                    },
                  ],
                  default: 'unknown',
                },
              },
            },
            in: { $ifNull: ['$$profIntent', '$$typeIntent'] },
          },
        },
        budget_min: { $ifNull: ['$profile.budget_profile.min_budget', null] },
        budget_max: { $ifNull: ['$profile.budget_profile.max_budget', null] },
      },
    },
    {
      $addFields: {
        budget_point: {
          $cond: [
            { $and: [{ $ne: ['$budget_min', null] }, { $ne: ['$budget_max', null] }] },
            { $divide: [{ $add: ['$budget_min', '$budget_max'] }, 2] },
            { $cond: [{ $ne: ['$budget_max', null] }, '$budget_max', '$budget_min'] },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$day',
        buyers: {
          $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$intent_resolved', ''] }, regex: /buy|client/i } }, 1, 0] },
        },
        sellers: {
          $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$intent_resolved', ''] }, regex: /sell/i } }, 1, 0] },
        },
        budget_sum: {
          $sum: { $cond: [{ $ne: ['$budget_point', null] }, '$budget_point', 0] },
        },
        budget_count: {
          $sum: { $cond: [{ $ne: ['$budget_point', null] }, 1, 0] },
        },
      },
    },
  ]);

  const byDay = new Map(rows.map((r) => [r._id, r]));
  const intent = [];
  const budget = [];
  for (let i = d - 1; i >= 0; i -= 1) {
    const dt = new Date();
    dt.setUTCHours(0, 0, 0, 0);
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const label = `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`;
    const row = byDay.get(key);
    intent.push({
      date: key,
      label,
      buyers: row?.buyers || 0,
      sellers: row?.sellers || 0,
    });
    budget.push({
      date: key,
      label,
      budget_avg: row && row.budget_count > 0 ? Math.round(row.budget_sum / row.budget_count) : 0,
      sample_size: row?.budget_count || 0,
    });
  }

  return { window_days: d, intent_metric: 'buyer_seller', intent, budget };
}

/** Section H — professional performance snapshot for dashboard. */
export async function getProfessionalPerformanceInsights(userId, { days = 30 } = {}) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const since = sinceDate(days);
  const d = parseDays(days);

  // All 4 DB operations run in parallel — each starts with its own indexed $match
  // so MongoDB can use existing indexes (no full collection scan from $facet).
  const [cohortAgg, closedDealsCount, referralAgg, kpiAggRows] = await Promise.all([
    LeadMatch.aggregate([
      { $match: { user_id: uid, createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          leads_in_window: { $sum: 1 },
          closed_won: { $sum: { $cond: [{ $eq: ['$match_status', 'converted'] }, 1, 0] } },
        },
      },
    ]),
    LeadMatch.countDocuments({ user_id: uid, match_status: 'converted' }),
    Referral.aggregate([
      {
        $match: {
          $or: [{ user_id: uid }, { target_user_id: uid }],
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: null,
          outbound: { $sum: { $cond: [{ $eq: ['$user_id', uid] }, 1, 0] } },
          inbound: { $sum: { $cond: [{ $eq: ['$target_user_id', uid] }, 1, 0] } },
          successful: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$status', ['accepted', 'completed']] },
                    { $or: [{ $eq: ['$user_id', uid] }, { $eq: ['$target_user_id', uid] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    LeadKpiEvent.aggregate([
      { $match: { user_id: uid, occurred_at: { $gte: since } } },
      {
        $group: {
          _id: null,
          lead_views: { $sum: { $cond: [{ $eq: ['$event_type', 'lead_viewed'] }, 1, 0] } },
          appointments: { $sum: { $cond: [{ $eq: ['$event_type', 'appointment_booked'] }, 1, 0] } },
          nurture_sent: { $sum: { $cond: [{ $eq: ['$event_type', 'nurture_email_sent'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const cohort = cohortAgg?.[0] || { leads_in_window: 0, closed_won: 0 };
  const closedDeals = closedDealsCount ?? 0;
  const ref = referralAgg?.[0] || { outbound: 0, inbound: 0, successful: 0 };
  const kpi = kpiAggRows?.[0] || { lead_views: 0, appointments: 0, nurture_sent: 0 };
  const leadsInWindow = Number(cohort.leads_in_window || 0);
  const closedWon = Number(cohort.closed_won || 0);
  const refTotal = Number(ref.outbound || 0) + Number(ref.inbound || 0);
  const refSuccess = Number(ref.successful || 0);

  const engagementDenominator = Math.max(leadsInWindow, 1);
  const engagement_quality = Number(
    (
      (Number(kpi.lead_views || 0) + Number(kpi.appointments || 0) * 2 + Number(kpi.nurture_sent || 0)) /
      engagementDenominator
    ).toFixed(2),
  );

  return {
    window_days: d,
    conversion_rate: leadsInWindow > 0 ? Number((closedWon / leadsInWindow).toFixed(3)) : 0,
    avg_response_time_minutes: null,
    engagement_quality,
    referral_success_rate: refTotal > 0 ? Number((refSuccess / refTotal).toFixed(3)) : 0,
    closed_deals: Number(closedDeals || 0),
    closed_deals_in_window: closedWon,
    collaboration_score: refTotal > 0 ? Math.min(100, Math.round((refSuccess / refTotal) * 100)) : 0,
    referrals_outbound: Number(ref.outbound || 0),
    referrals_inbound: Number(ref.inbound || 0),
  };
}

export async function getLeadKpiFunnel(userId, { days = 30 } = {}) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const since = sinceDate(days);
  const rows = await LeadKpiEvent.aggregate([
    { $match: { user_id: uid, occurred_at: { $gte: since } } },
    {
      $group: {
        _id: '$event_type',
        count: { $sum: 1 },
      },
    },
  ]);
  const byType = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const stages = [
    { id: 'lead_created', label: 'Lead Created', count: byType.lead_created || 0 },
    { id: 'lead_updated', label: 'Lead Updated', count: byType.lead_updated || 0 },
    { id: 'appointment_booked', label: 'Appointment Booked', count: byType.appointment_booked || 0 },
    { id: 'appointment_canceled', label: 'Appointment Canceled', count: byType.appointment_canceled || 0 },
  ];

  const created = stages[0].count || 0;
  const withRates = stages.map((s) => ({
    ...s,
    rate_vs_created: created > 0 ? Number((s.count / created).toFixed(3)) : 0,
  }));

  return {
    window_days: parseDays(days),
    stages: withRates,
  };
}
