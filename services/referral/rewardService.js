import mongoose from 'mongoose';
import ReferralRewardEvent from '../../models/ReferralRewardEvent.js';
import UserRewardBalance from '../../models/UserRewardBalance.js';
import { formatUsdCreditAmount } from './networkCircle.js';

/**
 * Rewards are enabled by default (no .env needed).
 * Set ENABLE_REFERRAL_REWARDS=false (or 0/no/off) to disable explicitly.
 */
function parseEnabledFlag(raw, defaultValue = true) {
  if (raw === undefined || raw === null) return defaultValue;
  const s = String(raw).trim().toLowerCase();
  if (!s) return defaultValue;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  return defaultValue;
}

const REWARDS_ENABLED = parseEnabledFlag(process.env.ENABLE_REFERRAL_REWARDS, true);

/** Client-spec point catalog — single source of truth. */
export const REWARD_RULES = Object.freeze({
  pro_signup: 100,
  pro_profile_complete: 150,
  pro_verified: 300,
  pro_first_engagement: 250,
  pro_first_deal: 1000,
  collaboration_success: 200,
  referral_transaction_complete: 500,
  multi_pro_deal_bonus: 1500,
  lead_active_client: 100,
  deal_closed: 1000,
  positive_review: 150,
  high_engagement_lead: 100,
  fast_response_monthly: 50,
  complete_profile_monthly: 100,
  ai_tool_milestone: 25,
  education_complete: 75,
  // Legacy invite micro-rewards (kept for backward-compatible event types)
  invite_link_created: 1,
  invite_click_captured: 1,
  invite_signup_converted: 100,
  referral_created: 8,
  referral_cross_role_bonus: 4,
  referral_accepted: 12,
});

/** @deprecated Use REWARD_RULES — kept for existing imports */
export const REFERRAL_REWARD_POINTS = Object.freeze({
  invite_link_created: REWARD_RULES.invite_link_created,
  invite_click_captured: REWARD_RULES.invite_click_captured,
  invite_signup_converted: REWARD_RULES.invite_signup_converted,
  referral_created: REWARD_RULES.referral_created,
  referral_cross_role_bonus: REWARD_RULES.referral_cross_role_bonus,
  referral_accepted: REWARD_RULES.referral_accepted,
});

export function tierFromPoints(points) {
  const p = Number(points) || 0;
  if (p >= 50000) return 'elite';
  if (p >= 15000) return 'platinum';
  if (p >= 5000) return 'gold';
  if (p >= 1000) return 'silver';
  return 'bronze';
}

const REPUTATION_WEIGHTS = {
  deal_closed: 12,
  pro_first_deal: 15,
  referral_transaction_complete: 10,
  collaboration_success: 8,
  positive_review: 10,
  pro_verified: 6,
  referral_accepted: 4,
  referral_created: 2,
};

const REPUTATION_PENALTIES = {
  referral_rejected: -5,
};

export function computeReputationDelta(event_type) {
  if (REPUTATION_WEIGHTS[event_type]) return REPUTATION_WEIGHTS[event_type];
  if (REPUTATION_PENALTIES[event_type]) return REPUTATION_PENALTIES[event_type];
  return 0;
}

export async function updateReputation(user_id, event_type, session = null) {
  const delta = computeReputationDelta(event_type);
  if (!delta) return;
  const uid = new mongoose.Types.ObjectId(String(user_id));
  const opts = session ? { session } : {};
  const bal = await UserRewardBalance.findOne({ user_id: uid }).select('reputation_score').lean();
  const current = Number(bal?.reputation_score ?? 50);
  const next = Math.max(0, Math.min(100, current + delta));
  await UserRewardBalance.updateOne(
    { user_id: uid },
    { $set: { reputation_score: next } },
    { upsert: true, ...opts },
  );
}

export async function awardReferralPoints({
  user_id,
  event_type,
  points_delta,
  idempotency_key,
  source_model = '',
  source_id = '',
  metadata = {},
  session = null,
}) {
  if (!REWARDS_ENABLED) return { awarded: false, reason: 'rewards_disabled' };
  if (!user_id || !event_type || !idempotency_key) return { awarded: false, reason: 'invalid_input' };

  const points = Number(points_delta || 0);
  if (!Number.isFinite(points) || points === 0) return { awarded: false, reason: 'zero_points' };

  const uid = mongoose.Types.ObjectId.isValid(String(user_id))
    ? new mongoose.Types.ObjectId(String(user_id))
    : null;
  if (!uid) return { awarded: false, reason: 'invalid_user' };

  const existing = await ReferralRewardEvent.findOne({ idempotency_key })
    .select('_id points_delta')
    .lean();
  if (existing) {
    return { awarded: false, duplicate: true, event_id: String(existing._id), points_delta: existing.points_delta };
  }

  const createAndUpdate = async (trxSession) => {
    const now = new Date();
    const [created] = await ReferralRewardEvent.create(
      [
        {
          user_id: uid,
          event_type,
          points_delta: points,
          idempotency_key,
          source_model,
          source_id,
          metadata,
          occurred_at: now,
        },
      ],
      trxSession ? { session: trxSession } : undefined,
    );

    const updated = await UserRewardBalance.findOneAndUpdate(
      { user_id: uid },
      {
        $setOnInsert: { user_id: uid, reputation_score: 50 },
        $inc: { points_balance: points },
        $set: { last_event_at: now },
      },
      { upsert: true, returnDocument: 'after', ...(trxSession ? { session: trxSession } : {}) },
    ).lean();

    const newBalance = Number(updated?.points_balance ?? points);
    const tier = tierFromPoints(newBalance);
    await UserRewardBalance.updateOne(
      { user_id: uid },
      { $set: { tier } },
      trxSession ? { session: trxSession } : {},
    );

    await updateReputation(uid, event_type, trxSession);

    return { created, tier, points_balance: newBalance };
  };

  let result = null;
  if (session) {
    result = await createAndUpdate(session);
  } else {
    result = await createAndUpdate(null);
  }

  return {
    awarded: true,
    event_id: result?.created?._id ? String(result.created._id) : '',
    points_delta: points,
    tier: result?.tier,
    points_balance: result?.points_balance,
  };
}

export async function getReferralRewardsSummary(user_id) {
  if (!REWARDS_ENABLED) {
    return {
      points_balance: 0,
      tier: 'bronze',
      reputation_score: 50,
      events_count: 0,
      last_event_at: null,
      pending_credit_cents: 0,
      paid_referral_count: 0,
      auto_apply_credits: false,
      rewards_enabled: false,
    };
  }
  if (!mongoose.Types.ObjectId.isValid(String(user_id))) {
    return { points_balance: 0, tier: 'bronze', reputation_score: 50, events_count: 0 };
  }
  const uid = new mongoose.Types.ObjectId(String(user_id));

  const [balance, eventsCount] = await Promise.all([
    UserRewardBalance.findOne({ user_id: uid })
      .select('points_balance last_event_at tier reputation_score pending_credit_cents paid_referral_count auto_apply_credits')
      .lean(),
    ReferralRewardEvent.countDocuments({ user_id: uid }),
  ]);

  const points = Number(balance?.points_balance || 0);
  return {
    points_balance: points,
    tier: balance?.tier || tierFromPoints(points),
    reputation_score: Number(balance?.reputation_score ?? 50),
    events_count: Number(eventsCount || 0),
    last_event_at: balance?.last_event_at || null,
    pending_credit_cents: Number(balance?.pending_credit_cents || 0),
    paid_referral_count: Number(balance?.paid_referral_count || 0),
    auto_apply_credits: Boolean(balance?.auto_apply_credits),
    rewards_enabled: true,
  };
}

export async function getRewardsProfile(user_id, { invite_code = null, referral_link = null } = {}) {
  const summary = await getReferralRewardsSummary(user_id);
  return {
    ...summary,
    referral_code: invite_code || null,
    referral_link: referral_link || null,
  };
}

export function mapRewardEventToLedgerRow(row) {
  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const eventType = String(row?.event_type || '').trim();
  const rewardKind = String(meta.reward_kind || '').trim().toLowerCase();
  const isCredit = rewardKind === 'credit' || eventType === 'referral_paid_invoice_credit';
  const points = Number(row?.points_delta || 0);

  const activityLabels = {
    referral_paid_invoice_credit: meta.activity_description || 'Referral account activated',
    invite_signup_converted: 'Invite signup converted',
    referral_created: 'Outbound referral created',
    referral_accepted: 'Inbound referral accepted',
    deal_closed: 'Deal closed',
    lead_active_client: 'Inbound network lead',
    complete_profile_monthly: 'Monthly streak bonus',
    pro_profile_complete: 'Profile completed',
    collaboration_success: 'Collaboration success',
  };

  let activity = meta.activity_description || activityLabels[eventType] || eventType.replace(/_/g, ' ');
  if (meta.invitee_name && eventType === 'referral_paid_invoice_credit') {
    activity = meta.activity_description || `Ref: ${meta.invitee_name}${meta.invitee_role ? ` (${meta.invitee_role})` : ''}`;
  }

  let status = String(meta.status || '').trim();
  if (!status) {
    if (isCredit) status = 'Success';
    else if (points > 0) status = 'Active';
    else status = 'Pending';
  }
  status = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  if (status === 'Success') status = 'Success';
  if (status === 'Active') status = 'Active';
  if (status === 'Pending') status = 'Pending';

  let reward_earned = '';
  if (isCredit) {
    const cents = Number(meta.amount_cents || 500);
    reward_earned = `+${formatUsdCreditAmount(cents)} USD Credit`;
  } else if (points !== 0) {
    reward_earned = `${points > 0 ? '+' : ''}${points} Nesti Points`;
  } else {
    reward_earned = '—';
  }

  return {
    id: String(row._id),
    event_type: eventType,
    points_delta: points,
    source_model: row.source_model || '',
    source_id: row.source_id || '',
    metadata: meta,
    occurred_at: row.occurred_at || row.createdAt || null,
    activity_description: activity,
    status,
    reward_earned,
    reward_kind: isCredit ? 'credit' : 'points',
  };
}

export async function listReferralRewardEvents(user_id, { page = 1, limit = 20 } = {}) {
  if (!REWARDS_ENABLED) {
    return {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, total_pages: 1 },
      rewards_enabled: false,
    };
  }
  if (!mongoose.Types.ObjectId.isValid(String(user_id))) {
    return { items: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 1 } };
  }
  const uid = new mongoose.Types.ObjectId(String(user_id));
  const p = Math.max(Number(page) || 1, 1);
  const l = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (p - 1) * l;

  const [items, total] = await Promise.all([
    ReferralRewardEvent.find({ user_id: uid })
      .sort({ occurred_at: -1, createdAt: -1 })
      .skip(skip)
      .limit(l)
      .lean(),
    ReferralRewardEvent.countDocuments({ user_id: uid }),
  ]);

  return {
    items: items.map((row) => mapRewardEventToLedgerRow(row)),
    pagination: { page: p, limit: l, total, total_pages: Math.max(1, Math.ceil(total / l)) },
    rewards_enabled: true,
  };
}
