import ClientProfile from '../../models/ClientProfile.js';
import ClientSubscription from '../../models/ClientSubscription.js';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import Subscription from '../../models/Subscription.js';
import User from '../../models/User.js';
import { adminHasPermission, ADMIN_PERMISSION as P } from '../../constants/adminPermissions.js';
import { monthlyMrrCentsForProfessionalSub } from '../billing/plans.js';
import { monthlyMrrCentsForClientSub } from '../client/plans.js';
import { pipelineRole } from '../proChat/salesPipeline.js';
import { ok, fail } from './adminCommon.js';

const RANGES = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_TARGETS = ['sales', 'client', 'lead'];
const FOLLOW_STEPS = new Set(['demo', 'summary_email', 'human_handoff']);
const CATEGORY_LABELS = { agent: 'Realtors', broker: 'Mortgage brokers', lawyer: 'Real estate lawyers', client: 'Clients' };

function rate(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

function dollars(cents) {
  return `$${(Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function time(value) {
  const at = value ? new Date(value).getTime() : 0;
  return Number.isFinite(at) ? at : 0;
}

export function isMeaningfulCall(call) {
  if (call?.voice_pipeline?.updated_at) return Boolean(call.voice_pipeline.meaningful);
  return Number(call?.transcript_segment_count || 0) >= 6;
}

export function wantsFollowUp(call) {
  const pipeline = call?.voice_pipeline || {};
  return call?.voice_outcome === 'callback' || Boolean(pipeline.follow_up_consent) || FOLLOW_STEPS.has(pipeline.next_step);
}

function paidAt(sub) {
  return time(sub?.last_purchase?.confirmed_at) || time(sub?.current_period_start) || time(sub?.updatedAt);
}

export function summarizeVoiceSales({ calls = [], links = new Map(), subs = new Map(), now = Date.now() } = {}) {
  const live = calls.filter((call) => LIVE_TARGETS.includes(call.voice_target_type));
  const meaningful = live.filter(isMeaningfulCall);
  const qualified = live.filter((call) => call.voice_pipeline?.qualified);
  const demos = live.filter((call) => call.voice_pipeline?.demo_requested || call.voice_pipeline?.next_step === 'demo');
  const handoffs = live.filter((call) => call.voice_pipeline?.handoff);
  const optedOut = live.filter((call) => call.voice_pipeline?.do_not_call);
  const pains = new Map();
  for (const call of live) for (const label of call.voice_pipeline?.pain_points || []) pains.set(label, (pains.get(label) || 0) + 1);

  const users = new Map();
  for (const call of live) {
    const link = links.get(`${call.voice_target_type}:${call.voice_target_id}`);
    if (!link?.userId) continue;
    const at = time(call.createdAt);
    const row = users.get(link.userId) || { userId: link.userId, category: link.category, firstCall: at, followUp: false };
    row.firstCall = Math.min(row.firstCall, at);
    row.followUp = row.followUp || wantsFollowUp(call);
    users.set(link.userId, row);
  }

  let trials = 0;
  let paid = 0;
  let followUps = 0;
  let followPaid = 0;
  let eligible = 0;
  let retained = 0;
  const revenue = new Map();
  for (const row of users.values()) {
    const sub = subs.get(row.userId);
    const client = row.category === 'client';
    const trialStart = client ? (sub?.status === 'trialing' ? time(sub?.createdAt) : 0) : time(sub?.trial_start);
    if (trialStart && trialStart >= row.firstCall) trials += 1;
    const isPaid = sub && ['active', 'past_due'].includes(sub.status) && paidAt(sub) >= row.firstCall;
    if (row.followUp) followUps += 1;
    if (!isPaid) continue;
    paid += 1;
    if (row.followUp) followPaid += 1;
    const cents = client ? monthlyMrrCentsForClientSub(sub) : monthlyMrrCentsForProfessionalSub(sub);
    revenue.set(row.category, (revenue.get(row.category) || 0) + cents);
    if (paidAt(sub) <= now - 30 * DAY_MS) {
      eligible += 1;
      if (sub.status === 'active' && !sub.cancel_at_period_end) retained += 1;
    }
  }

  return {
    calls: { started: live.length, meaningful: meaningful.length, meaningful_rate: rate(meaningful.length, live.length), test_calls: calls.length - live.length },
    qualification: { qualified: qualified.length, rate: rate(qualified.length, meaningful.length) },
    demos_scheduled: demos.length,
    trials_activated: trials,
    paid: { converted: paid, linked_prospects: users.size, rate: rate(paid, users.size) },
    revenue_by_category: Object.keys(CATEGORY_LABELS).map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      mrr_cents: revenue.get(category) || 0,
      mrr_display: dollars(revenue.get(category) || 0),
    })),
    follow_up: { prospects: followUps, converted: followPaid, rate: rate(followPaid, followUps) },
    retention_30d: { eligible, retained, rate: rate(retained, eligible) },
    handoffs: handoffs.length,
    do_not_call: optedOut.length,
    top_pain_points: [...pains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count })),
    currency: 'usd',
  };
}

export async function adminVoiceSalesAnalyticsService(query, actorUser) {
  if (!adminHasPermission(actorUser, P.LEADS_READ) && !adminHasPermission(actorUser, P.CLIENTS_READ)) {
    return fail(403, 'Missing read permission');
  }
  const range = RANGES[String(query?.range || '')] ? String(query.range) : '30d';
  const since = new Date(Date.now() - RANGES[range] * DAY_MS);
  const calls = await ProfessionalCall.find({ voice_target_type: { $in: [...LIVE_TARGETS, 'test'] }, createdAt: { $gte: since } })
    .select('voice_target_type voice_target_id voice_outcome voice_pipeline transcript_segment_count createdAt')
    .sort({ createdAt: -1 })
    .limit(5000)
    .lean();
  const ids = (type) => [...new Set(calls.filter((call) => call.voice_target_type === type && /^[a-f0-9]{24}$/i.test(String(call.voice_target_id || ''))).map((call) => String(call.voice_target_id)))];
  const [inquiries, clients] = await Promise.all([
    EnterpriseInquiry.find({ _id: { $in: ids('sales') } }).select('user_id interest_role').lean(),
    ClientProfile.find({ _id: { $in: ids('client') } }).select('user_id').lean(),
  ]);
  const proUserIds = inquiries.map((row) => row.user_id).filter(Boolean);
  const clientUserIds = clients.map((row) => row.user_id).filter(Boolean);
  const [proUsers, proSubs, clientSubs] = await Promise.all([
    User.find({ _id: { $in: proUserIds } }).select('role').lean(),
    Subscription.find({ user_id: { $in: proUserIds } }).select('user_id plan_key billing_period status trial_start last_purchase current_period_start cancel_at_period_end updatedAt').lean(),
    ClientSubscription.find({ user_id: { $in: clientUserIds } }).select('user_id tier billing_period status last_purchase current_period_start cancel_at_period_end createdAt updatedAt').lean(),
  ]);
  const roles = new Map(proUsers.map((user) => [String(user._id), user.role]));
  const links = new Map();
  for (const row of inquiries) {
    if (!row.user_id) continue;
    const userId = String(row.user_id);
    links.set(`sales:${row._id}`, { userId, category: pipelineRole(row.interest_role) || pipelineRole(roles.get(userId)) || 'agent' });
  }
  for (const row of clients) if (row.user_id) links.set(`client:${row._id}`, { userId: String(row.user_id), category: 'client' });
  const subs = new Map([...proSubs, ...clientSubs].map((sub) => [String(sub.user_id), sub]));
  return ok({ range, since, ...summarizeVoiceSales({ calls, links, subs }) });
}
