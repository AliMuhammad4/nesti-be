import mongoose from 'mongoose';
import LeadKpiEvent from '../../models/LeadKpiEvent.js';

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
  const totalEvents = rows.reduce((s, r) => s + r.count, 0);
  const created = byType.lead_created || 0;
  const booked = byType.appointment_booked || 0;
  const canceled = byType.appointment_canceled || 0;
  const updated = byType.lead_updated || 0;

  return {
    window_days: parseDays(days),
    totals: {
      events: totalEvents,
      leads_created: created,
      leads_updated: updated,
      appointments_booked: booked,
      appointments_canceled: canceled,
    },
    conversion_rates: {
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
