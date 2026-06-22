import mongoose from 'mongoose';
import InviteAttribution from '../../models/InviteAttribution.js';
import InviteLink from '../../models/InviteLink.js';
import Subscription from '../../models/Subscription.js';
import User from '../../models/User.js';
import Referral from '../../models/Referral.js';
import { getStripeClient } from '../billing/stripeClient.js';
import { SUBSCRIPTION_PLAN } from '../billing/entitlements.js';
import { getReferralRewardsSummary } from './rewardService.js';
import ReferralRewardEvent from '../../models/ReferralRewardEvent.js';
import UserRewardBalance from '../../models/UserRewardBalance.js';

export const CREDIT_PER_REFERRAL_CENTS = 500;
export const REFERRAL_CREDIT_CURRENCY = 'USD';

/** Paid referrals needed for a $0 invoice (plan price ÷ $5). */
export const FREE_MONTH_TARGET_BY_PLAN = Object.freeze({
  [SUBSCRIPTION_PLAN.STANDARD]: 60,
  [SUBSCRIPTION_PLAN.ENTERPRISE]: 120,
  [SUBSCRIPTION_PLAN.BASIC]: 30,
});

const PAID_SUBSCRIPTION_STATUSES = new Set(['active', 'past_due']);

export function freeMonthTargetForPlan(planKey) {
  const key = String(planKey || '').trim().toLowerCase();
  return FREE_MONTH_TARGET_BY_PLAN[key] || FREE_MONTH_TARGET_BY_PLAN[SUBSCRIPTION_PLAN.STANDARD];
}

export function formatUsdCreditAmount(cents, { signed = false } = {}) {
  const value = Math.abs(Number(cents) || 0) / 100;
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  if (signed && Number(cents) > 0) return `-${formatted}`;
  return formatted;
}

export function formatUsdCreditDisplay(cents) {
  const amount = formatUsdCreditAmount(cents, { signed: true });
  return `${amount} USD Off Next Invoice`;
}

export async function countInboundReferrals(userId, { since = null } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) return 0;
  const uid = new mongoose.Types.ObjectId(String(userId));
  const filter = { target_user_id: uid };
  if (since) filter.createdAt = { $gte: since };
  return Referral.countDocuments(filter);
}

export async function getRewardBalanceExtras(userId) {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) {
    return {
      pending_credit_cents: 0,
      paid_referral_count: 0,
      auto_apply_credits: false,
    };
  }
  const uid = new mongoose.Types.ObjectId(String(userId));
  const row = await UserRewardBalance.findOne({ user_id: uid })
    .select('pending_credit_cents paid_referral_count auto_apply_credits')
    .lean();
  return {
    pending_credit_cents: Number(row?.pending_credit_cents || 0),
    paid_referral_count: Number(row?.paid_referral_count || 0),
    auto_apply_credits: Boolean(row?.auto_apply_credits),
  };
}

export async function buildNetworkCircleMetrics(userId, { days = 30 } = {}) {
  const uid = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : null;

  if (!uid) {
    return {
      referrals_sent_paid: 0,
      referrals_received: 0,
      points_balance: 0,
      pending_credit_cents: 0,
      pending_credit_display: formatUsdCreditDisplay(0),
      currency: REFERRAL_CREDIT_CURRENCY,
      credit_per_referral_cents: CREDIT_PER_REFERRAL_CENTS,
      free_month_target: FREE_MONTH_TARGET_BY_PLAN[SUBSCRIPTION_PLAN.STANDARD],
      free_month_progress: 0,
      free_month_copy: `0/${FREE_MONTH_TARGET_BY_PLAN[SUBSCRIPTION_PLAN.STANDARD]} Referrals to your next Free Month! Share your link to close the gap.`,
    };
  }

  const since = new Date();
  since.setDate(since.getDate() - Math.max(Number(days) || 30, 1));

  const [pointsSummary, balanceExtras, subscription, referralsReceived] = await Promise.all([
    getReferralRewardsSummary(uid),
    getRewardBalanceExtras(uid),
    Subscription.findOne({ user_id: uid }).select('plan_key status').lean(),
    countInboundReferrals(uid, { since }),
  ]);

  const planKey = String(subscription?.plan_key || SUBSCRIPTION_PLAN.STANDARD).toLowerCase();
  const freeMonthTarget = freeMonthTargetForPlan(planKey);
  const paidCount = balanceExtras.paid_referral_count;
  const progress = freeMonthTarget > 0 ? Math.min(1, paidCount / freeMonthTarget) : 0;

  return {
    referrals_sent_paid: paidCount,
    referrals_received: referralsReceived,
    points_balance: Number(pointsSummary?.points_balance || 0),
    pending_credit_cents: balanceExtras.pending_credit_cents,
    pending_credit_display: formatUsdCreditDisplay(balanceExtras.pending_credit_cents),
    currency: REFERRAL_CREDIT_CURRENCY,
    credit_per_referral_cents: CREDIT_PER_REFERRAL_CENTS,
    free_month_target: freeMonthTarget,
    free_month_progress: Number(progress.toFixed(4)),
    free_month_copy: `${paidCount}/${freeMonthTarget} Referrals to your next Free Month! Share your link to close the gap.`,
    auto_apply_credits: balanceExtras.auto_apply_credits,
    plan_key: planKey,
  };
}

async function resolveInviteeDisplayName(userId) {
  const user = await User.findById(userId)
    .select('full_name first_name last_name email role')
    .lean();
  if (!user) return 'Professional';
  const name =
    String(user.full_name || '').trim() ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    user.email ||
    'Professional';
  const role = String(user.role || 'professional')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { name, role };
}

/**
 * Award $5 USD invoice credit to inviter when invitee completes first paid subscription.
 * Idempotent per invitee user id.
 */
export async function awardReferralInvoiceCredit(subscriberUserId, { stripeEventId = '', invoiceAmountPaid = null } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(subscriberUserId))) {
    return { awarded: false, reason: 'invalid_subscriber' };
  }

  const subscriberOid = new mongoose.Types.ObjectId(String(subscriberUserId));
  const subscription = await Subscription.findOne({ user_id: subscriberOid })
    .select('status plan_key stripe_customer_id')
    .lean();

  const status = String(subscription?.status || '').toLowerCase();
  if (!PAID_SUBSCRIPTION_STATUSES.has(status)) {
    return { awarded: false, reason: 'subscription_not_paid' };
  }

  if (invoiceAmountPaid != null && Number(invoiceAmountPaid) <= 0) {
    return { awarded: false, reason: 'zero_invoice' };
  }

  const attribution = await InviteAttribution.findOne({
    consumed_by_user_id: subscriberOid,
    status: 'converted',
  })
    .sort({ consumed_at: -1 })
    .lean();

  if (!attribution?.invite_link_id) {
    return { awarded: false, reason: 'no_invite_attribution' };
  }

  const invite = await InviteLink.findById(attribution.invite_link_id)
    .select('inviter_user_id')
    .lean();
  if (!invite?.inviter_user_id) {
    return { awarded: false, reason: 'no_inviter' };
  }

  const inviterId = invite.inviter_user_id;
  const idempotencyKey = `referral:credit:paid:${String(subscriberOid)}`;

  const existing = await ReferralRewardEvent.findOne({ idempotency_key: idempotencyKey })
    .select('_id')
    .lean();
  if (existing) {
    return { awarded: false, duplicate: true, event_id: String(existing._id) };
  }

  const invitee = await resolveInviteeDisplayName(subscriberOid);
  const now = new Date();

  await ReferralRewardEvent.create({
    user_id: inviterId,
    event_type: 'referral_paid_invoice_credit',
    points_delta: 0,
    idempotency_key: idempotencyKey,
    source_model: 'InviteAttribution',
    source_id: String(attribution._id),
    metadata: {
      reward_kind: 'credit',
      amount_cents: CREDIT_PER_REFERRAL_CENTS,
      currency: REFERRAL_CREDIT_CURRENCY,
      status: 'success',
      invitee_user_id: String(subscriberOid),
      invitee_name: invitee.name,
      invitee_role: invitee.role,
      stripe_event_id: stripeEventId || null,
      activity_description: `Ref: ${invitee.name} (${invitee.role})`,
    },
    occurred_at: now,
  });

  await UserRewardBalance.findOneAndUpdate(
    { user_id: inviterId },
    {
      $setOnInsert: { user_id: inviterId, points_balance: 0, reputation_score: 50 },
      $inc: {
        pending_credit_cents: CREDIT_PER_REFERRAL_CENTS,
        paid_referral_count: 1,
      },
      $set: { last_event_at: now },
    },
    { upsert: true },
  );

  const inviterSub = await Subscription.findOne({ user_id: inviterId })
    .select('stripe_customer_id auto_apply_credits')
    .lean();
  const inviterBalance = await UserRewardBalance.findOne({ user_id: inviterId })
    .select('auto_apply_credits')
    .lean();

  const stripeCustomerId = String(inviterSub?.stripe_customer_id || '').trim();
  if (stripeCustomerId) {
    try {
      const stripe = getStripeClient();
      await stripe.customers.createBalanceTransaction(stripeCustomerId, {
        amount: -CREDIT_PER_REFERRAL_CENTS,
        currency: 'usd',
        description: `Nesti referral credit — ${invitee.name} subscribed`,
        metadata: {
          invitee_user_id: String(subscriberOid),
          idempotency_key: idempotencyKey,
        },
      });
    } catch (err) {
      // Credit is tracked locally even if Stripe balance write fails (retry-safe via idempotency).
      console.warn('[networkCircle] Stripe balance transaction failed', err?.message || err);
    }
  }

  return {
    awarded: true,
    inviter_user_id: String(inviterId),
    amount_cents: CREDIT_PER_REFERRAL_CENTS,
  };
}

export async function processPaidSubscriptionReferralCredit(userId, options = {}) {
  return awardReferralInvoiceCredit(userId, options);
}