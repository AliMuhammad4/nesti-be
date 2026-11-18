import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import ClientSubscription from '../models/ClientSubscription.js';
import logger from '../utils/logger.js';
import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { supportEmail } from '../constants/support.js';
import { BILLING_PLANS } from '../services/billing/plans.js';
import { CLIENT_PLANS } from '../services/client/plans.js';
import { sendIdempotentEmail } from '../services/email/emailDeliveryService.js';
import { appBaseUrl, renderTrialNoticeEmail } from '../services/email/userLifecycleEmails.js';

export const trialNoticeDeps = { sendIdempotentEmail };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Trials that ended longer ago than this get no "ended" email (e.g. on first deploy). */
const ENDED_LOOKBACK_MS = 3 * DAY_MS;
const RUN_EVERY_MS = 6 * HOUR_MS;
const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;
// A client plan in these states means they already pay (or owe): no trial emails.
const CLIENT_PAID_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

function noticeKind(endsAt, now) {
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return '';
  if (end > now && end - now <= DAY_MS) return 'ending';
  if (end <= now && now - end <= ENDED_LOOKBACK_MS) return 'ended';
  return '';
}

async function sendNotice({ user, role, endsAt, kind }) {
  const flag = kind === 'ending' ? 'trial_notices.ending_sent_at' : 'trial_notices.ended_sent_at';
  const isPro = PROFESSIONAL_TYPE_VALUES.includes(role);
  const { subject, html, text } = renderTrialNoticeEmail({
    firstName: user.first_name,
    role,
    endsAt,
    ended: kind === 'ended',
    plans: Object.values(isPro ? BILLING_PLANS : CLIENT_PLANS),
    subscribeUrl: isPro ? `${appBaseUrl()}/checkout` : `${appBaseUrl()}/client-dashboard/subscription`,
  });
  // The delivery key is unique per user, trial end and notice, so restarts and several
  // instances never send the same notice twice.
  const result = await trialNoticeDeps.sendIdempotentEmail({
    email: user.email,
    subject,
    message: text,
    htmlMessage: html,
    idempotencyKey: `trial-${kind}-${String(user._id)}-${new Date(endsAt).getTime()}`,
    source: `trial_${kind}`,
    replyTo: supportEmail(),
  });
  if (result?.success) {
    await User.updateOne({ _id: user._id }, { $set: { [flag]: new Date() } });
    return true;
  }
  if (!result?.inProgress) logger.warn('Trial notice email not sent', { kind, user_id: String(user._id) });
  return false;
}

const USER_FIELDS = '_id email first_name role is_active trial_notices client_trial_ends_at';

function eligible(user, kind) {
  if (!user || user.is_active === false || !String(user.email || '').trim()) return false;
  const sentAt = kind === 'ending' ? user.trial_notices?.ending_sent_at : user.trial_notices?.ended_sent_at;
  return !sentAt;
}

/** Professionals on the app-only free trial (no Stripe subscription, not paid). */
async function professionalNotices(now) {
  const subs = await Subscription.find({
    status: { $in: ['free_trial', 'expired'] },
    $or: [{ stripe_subscription_id: { $exists: false } }, { stripe_subscription_id: null }, { stripe_subscription_id: '' }],
    trial_end: { $gt: new Date(now - ENDED_LOOKBACK_MS), $lte: new Date(now + DAY_MS) },
  }).select('user_id trial_end status').lean();
  let sent = 0;
  for (const sub of subs) {
    const kind = noticeKind(sub.trial_end, now);
    if (!kind) continue;
    const user = await User.findById(sub.user_id).select(USER_FIELDS).lean();
    if (!user || !PROFESSIONAL_TYPE_VALUES.includes(user.role) || !eligible(user, kind)) continue;
    if (await sendNotice({ user, role: user.role, endsAt: sub.trial_end, kind })) sent += 1;
  }
  return sent;
}

/** Clients on the app-only signup trial with no client plan. */
async function clientNotices(now) {
  const users = await User.find({
    role: 'client',
    is_active: { $ne: false },
    client_trial_ends_at: { $gt: new Date(now - ENDED_LOOKBACK_MS), $lte: new Date(now + DAY_MS) },
  }).select(USER_FIELDS).lean();
  let sent = 0;
  for (const user of users) {
    const kind = noticeKind(user.client_trial_ends_at, now);
    if (!kind || !eligible(user, kind)) continue;
    const paid = await ClientSubscription.exists({ user_id: user._id, status: { $in: CLIENT_PAID_STATUSES } });
    if (paid) continue;
    if (await sendNotice({ user, role: 'client', endsAt: user.client_trial_ends_at, kind })) sent += 1;
  }
  return sent;
}

export async function runTrialNoticeJob(now = Date.now()) {
  const professionals = await professionalNotices(now);
  const clients = await clientNotices(now);
  if (professionals || clients) logger.info('Trial notice emails sent', { professionals, clients });
  return { professionals, clients };
}

let scheduled = false;

/** Runs a few minutes after start, then every 6 hours; each notice is sent once per trial. */
export function scheduleTrialNoticeJob() {
  if (scheduled || process.env.ENABLE_TRIAL_NOTICE_JOB === 'false') return;
  scheduled = true;
  const run = () => runTrialNoticeJob().catch((error) => logger.warn('Trial notice job failed', { error: error?.message }));
  setTimeout(run, Math.min(3 * 60 * 1000, MAX_SAFE_TIMEOUT_MS)).unref?.();
  setInterval(run, RUN_EVERY_MS).unref?.();
}
