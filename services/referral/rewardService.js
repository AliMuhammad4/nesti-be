import mongoose from 'mongoose';
import ReferralRewardEvent from '../../models/ReferralRewardEvent.js';
import UserRewardBalance from '../../models/UserRewardBalance.js';

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

export const REFERRAL_REWARD_POINTS = Object.freeze({
  invite_link_created: 1,
  invite_click_captured: 1,
  invite_signup_converted: 25,
  referral_created: 8,
  referral_cross_role_bonus: 4,
  referral_accepted: 12,
});

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

    await UserRewardBalance.updateOne(
      { user_id: uid },
      {
        // Don't touch points_balance in $setOnInsert — $inc will create it if missing.
        // Setting + incrementing the same path in one update causes a Mongo conflict.
        $setOnInsert: { user_id: uid },
        $inc: { points_balance: points },
        $set: { last_event_at: now },
      },
      { upsert: true, ...(trxSession ? { session: trxSession } : {}) },
    );

    return created;
  };

  let createdEvent = null;
  if (session) {
    createdEvent = await createAndUpdate(session);
  } else {
    createdEvent = await createAndUpdate(null);
  }

  return {
    awarded: true,
    event_id: createdEvent?._id ? String(createdEvent._id) : '',
    points_delta: points,
  };
}

export async function getReferralRewardsSummary(user_id) {
  if (!REWARDS_ENABLED) {
    return { points_balance: 0, events_count: 0, last_event_at: null, rewards_enabled: false };
  }
  if (!mongoose.Types.ObjectId.isValid(String(user_id))) {
    return { points_balance: 0, events_count: 0 };
  }
  const uid = new mongoose.Types.ObjectId(String(user_id));

  const [balance, eventsCount] = await Promise.all([
    UserRewardBalance.findOne({ user_id: uid }).select('points_balance last_event_at').lean(),
    ReferralRewardEvent.countDocuments({ user_id: uid }),
  ]);

  return {
    points_balance: Number(balance?.points_balance || 0),
    events_count: Number(eventsCount || 0),
    last_event_at: balance?.last_event_at || null,
    rewards_enabled: true,
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
    items: items.map((row) => ({
      id: String(row._id),
      event_type: row.event_type,
      points_delta: Number(row.points_delta || 0),
      source_model: row.source_model || '',
      source_id: row.source_id || '',
      metadata: row.metadata || {},
      occurred_at: row.occurred_at || row.createdAt || null,
    })),
    pagination: { page: p, limit: l, total, total_pages: Math.max(1, Math.ceil(total / l)) },
  };
}
