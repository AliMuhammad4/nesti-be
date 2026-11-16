import Subscription from '../../models/Subscription.js';
import { USER_ROLE } from '../../constants/roles.js';
import {
  ACTIVE_ACCESS_STATUSES,
  accountStatusFromSubscription,
  getProfessionalAccessState,
  getProfessionalPastDueGraceEndsAt,
  getProfessionalPaymentMessage,
  hasPaidProfessionalAccess,
  isProfessionalSubscriptionActive,
  isSubscriptionPeriodEnded,
  professionalHasUsedTrial,
  toIsoDate,
} from './subscriptionShared.js';

export const FREE_TRIAL_DAYS = 3;

export async function markSubscriptionStripeStateExpired(userId) {
  return Subscription.findOneAndUpdate(
    { user_id: userId },
    {
      $set: {
        stripe_customer_id: '',
        stripe_subscription_id: '',
        stripe_price_id: '',
        stripe_subscription_schedule_id: '',
        pending_plan_key: '',
        pending_plan_effective_at: null,
        status: 'expired',
        cancel_at_period_end: false,
        current_period_start: null,
        current_period_end: null,
        latest_invoice_id: '',
        last_payment_status: '',
        last_synced_at: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
}

export function serializeSubscription(subscription) {
  if (!subscription) {
    return {
      accountStatus: 'expired',
      subscriptionPlan: '',
      subscriptionStatus: 'expired',
      trialEndsAt: null,
      subscriptionEndsAt: null,
      cancelAtPeriodEnd: false,
      pendingPlanKey: '',
      pendingPlanEffectiveAt: null,
    };
  }
  return {
    id: String(subscription._id),
    accountStatus: accountStatusFromSubscription(subscription),
    subscriptionPlan: subscription.plan_key || '',
    billingPeriod: subscription.billing_period || '',
    subscriptionStatus: subscription.status || '',
    trialEndsAt: toIsoDate(subscription.trial_end),
    lastPurchase: subscription.last_purchase?.confirmed_at
      ? {
          planKey: subscription.last_purchase.plan_key || subscription.plan_key || '',
          billingPeriod: subscription.last_purchase.billing_period || subscription.billing_period || '',
          amount: Number(subscription.last_purchase.amount || 0),
          currency: subscription.last_purchase.currency || 'usd',
          confirmedAt: toIsoDate(subscription.last_purchase.confirmed_at),
        }
      : null,
    canPublishWebsite: hasPaidProfessionalAccess(subscription)
      && ['standard', 'enterprise'].includes(String(subscription.plan_key || '')),
    canRunVoiceAgent: hasPaidProfessionalAccess(subscription)
      && String(subscription.plan_key || '') === 'enterprise',
    subscriptionEndsAt: toIsoDate(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    pendingPlanKey: subscription.pending_plan_key || '',
    pendingPlanEffectiveAt: toIsoDate(subscription.pending_plan_effective_at),
    accessState: getProfessionalAccessState(subscription),
    paymentMessage: getProfessionalPaymentMessage(subscription),
    pastDueGraceEndsAt: toIsoDate(getProfessionalPastDueGraceEndsAt(subscription)),
    paymentActionUrl: '',
    paymentActionLabel: '',
  };
}

async function normalizeFreeTrialDuration(subscription) {
  if (!subscription?.trial_start || !['free_trial', 'expired'].includes(subscription.status)) {
    return subscription;
  }
  const trialStart = new Date(subscription.trial_start);
  if (Number.isNaN(trialStart.getTime())) return subscription;
  const expectedTrialEnd = new Date(trialStart.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const currentTrialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null;
  const shouldExtend =
    !currentTrialEnd
    || Number.isNaN(currentTrialEnd.getTime())
    || currentTrialEnd.getTime() < expectedTrialEnd.getTime();
  if (!shouldExtend) return subscription;

  subscription.trial_end = expectedTrialEnd;
  if (subscription.status === 'expired' && expectedTrialEnd > new Date()) {
    subscription.status = 'free_trial';
  }
  await subscription.save();
  return subscription;
}

export async function expireTrialIfNeeded(subscription) {
  subscription = await normalizeFreeTrialDuration(subscription);
  if (
    subscription?.status === 'free_trial'
    && subscription.trial_end
    && new Date(subscription.trial_end) <= new Date()
  ) {
    subscription.status = 'expired';
    await subscription.save();
  }
  return expireCanceledSubscriptionIfNeeded(subscription);
}

export async function expireCanceledSubscriptionIfNeeded(subscription) {
  if (!subscription) return subscription;
  const status = String(subscription.status || '').trim().toLowerCase();
  if (status === 'free_trial') return subscription;
  const periodEnded = isSubscriptionPeriodEnded(subscription);
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const terminalStatus = ['canceled', 'cancelled', 'incomplete_expired'].includes(status);
  const missedRenewalExpired =
    (status === 'active' || status === 'trialing')
    && periodEnded
    && !cancelAtPeriodEnd
    && !isProfessionalSubscriptionActive(subscription);
  const shouldExpire =
    terminalStatus
    || (cancelAtPeriodEnd && periodEnded && ACTIVE_ACCESS_STATUSES.has(status))
    || missedRenewalExpired;
  if (!shouldExpire) return subscription;

  if (status === 'expired' || status === 'canceled') {
    if (subscription.cancel_at_period_end) {
      subscription.cancel_at_period_end = false;
      await subscription.save();
    }
    return subscription;
  }
  subscription.status = 'expired';
  subscription.cancel_at_period_end = false;
  await subscription.save();
  return subscription;
}

export async function createFreeTrialSubscription(userId, trialEndsAt) {
  const now = new Date();
  const trialEnd = trialEndsAt || new Date(now.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  return Subscription.findOneAndUpdate(
    { user_id: userId },
    {
      $setOnInsert: {
        user_id: userId,
        plan_key: 'basic',
        status: 'free_trial',
        trial_start: now,
        trial_end: trialEnd,
        trial_used: true,
        metadata: { trial_used: true },
      },
    },
    { returnDocument: 'after', upsert: true },
  );
}

/** Start or reset professional free trial after admin credential approval. */
export async function startProfessionalTrialFromApproval(userId) {
  const now = new Date();
  const trialEnd = new Date(now.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);

  // One trial per professional ever. Do not reset a used trial or a live paid plan.
  const existing = await Subscription.findOne({ user_id: userId });
  if (existing) {
    const status = String(existing.status || '').trim().toLowerCase();
    if (status === 'free_trial' || status === 'active' || status === 'past_due') {
      if (!professionalHasUsedTrial(existing)) {
        existing.trial_used = true;
        existing.metadata = { ...(existing.metadata || {}), trial_used: true };
        await existing.save();
      }
      return existing;
    }
    if (professionalHasUsedTrial(existing)) {
      return existing;
    }
  }

  return Subscription.findOneAndUpdate(
    { user_id: userId },
    {
      $set: {
        user_id: userId,
        plan_key: 'basic',
        status: 'free_trial',
        trial_start: now,
        trial_end: trialEnd,
        trial_used: true,
        cancel_at_period_end: false,
        'metadata.trial_used': true,
      },
    },
    { returnDocument: 'after', upsert: true },
  );
}

/**
 * Callers sometimes pass only { _id }. Load the role so the admin, client, and
 * awaiting-approval rules below still apply (no trial before credential approval).
 */
async function withKnownRole(user) {
  if (!user?._id || String(user?.role || '').trim()) return user;
  const { default: User } = await import('../../models/User.js');
  const doc = await User.findById(user._id).select('role').lean();
  return doc ? { ...user, role: doc.role } : null;
}

export async function getOrCreateSubscriptionForUser(inputUser) {
  const user = await withKnownRole(inputUser);
  if (!user) {
    // Unknown account: read an existing row, never create a trial.
    const orphan = inputUser?._id ? await Subscription.findOne({ user_id: inputUser._id }) : null;
    return orphan ? expireTrialIfNeeded(orphan) : null;
  }
  if (String(user?.role || '') === USER_ROLE.ADMIN) return null;

  if (String(user?.role || '') === USER_ROLE.CLIENT) {
    const existing = await Subscription.findOne({ user_id: user._id });
    if (!existing) return null;
    const status = String(existing.status || '').trim().toLowerCase();
    const hasStripe = Boolean(String(existing.stripe_subscription_id || '').trim());
    if (hasStripe || status === 'free_trial' || ACTIVE_ACCESS_STATUSES.has(status)) {
      const { cancelProfessionalBillingForConvertedClient } = await import(
        './subscriptionLifecycleService.js'
      );
      const canceled = await cancelProfessionalBillingForConvertedClient(user);
      if (!canceled?.ok) {
        console.warn('Professional Stripe cancel on role change was unsafe or failed', {
          user_id: String(user._id),
          flags: canceled?.flags || [],
        });
      }
      return Subscription.findOne({ user_id: user._id }).then((row) =>
        expireCanceledSubscriptionIfNeeded(row),
      );
    }
    return expireCanceledSubscriptionIfNeeded(existing);
  }

  let subscription = await Subscription.findOne({ user_id: user._id });
  if (!subscription) {
    // Do not auto-create trials for professionals awaiting credential approval.
    const { default: ProfessionalProfile } = await import('../../models/ProfessionalProfile.js');
    const { CREDENTIAL_STATUS } = await import('../../constants/credentialDocuments.js');
    const { isProfessionalRole } = await import('../../constants/roles.js');
    if (isProfessionalRole(user?.role)) {
      const profile = await ProfessionalProfile.findOne({ user_id: user._id })
        .select('credential_status')
        .lean();
      if (String(profile?.credential_status || '') !== CREDENTIAL_STATUS.APPROVED) {
        return null;
      }
    }
    // First trial starts from approval time (now), not the account createdAt.
    subscription = await createFreeTrialSubscription(user._id);
  }
  return expireTrialIfNeeded(subscription);
}
