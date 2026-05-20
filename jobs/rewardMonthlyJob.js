import User from '../models/User.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import { PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { evaluateProfessionalProfileSetup } from '../utils/professionalProfileSetup.js';
import { awardReferralPoints, REWARD_RULES } from '../services/referral/rewardService.js';
import logger from '../utils/logger.js';

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Monthly reward bonuses — run via server startup interval or external cron.
 */
export async function runMonthlyRewardBonuses() {
  const key = monthKey();
  const users = await User.find({ role: { $in: PROFESSIONAL_TYPE_VALUES } })
    .select('_id role first_name last_name email')
    .lean();

  let awarded = 0;
  for (const user of users) {
    const uid = user._id;
    try {
      const profile = await ProfessionalProfile.findOne({ user_id: uid }).lean();
      const setup = evaluateProfessionalProfileSetup(user, profile);
      if (setup.is_complete) {
        const r = await awardReferralPoints({
          user_id: uid,
          event_type: 'complete_profile_monthly',
          points_delta: REWARD_RULES.complete_profile_monthly,
          idempotency_key: `monthly:profile_complete:${key}:${String(uid)}`,
          source_model: 'User',
          source_id: String(uid),
        });
        if (r.awarded) awarded += 1;
      }
    } catch (e) {
      logger.warn('monthly profile bonus failed', { user_id: String(uid), error: e?.message });
    }
  }

  logger.info('Monthly reward bonuses completed', { month: key, awarded });
  return { month: key, awarded };
}

const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;

function nextMonthDelayMs(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 6, 0, 0, 0));
  return Math.max(60_000, next.getTime() - now.getTime());
}

function scheduleSafeTimeout(callback, delayMs) {
  const safeDelay = Math.min(Math.max(Number(delayMs) || 0, 1), MAX_SAFE_TIMEOUT_MS);
  return setTimeout(callback, safeDelay);
}

export function scheduleMonthlyRewardJob() {
  if (process.env.ENABLE_MONTHLY_REWARD_JOB === 'false') return;
  const run = () => {
    runMonthlyRewardBonuses().catch((e) =>
      logger.warn('runMonthlyRewardBonuses failed', { error: e?.message }),
    );
  };
  const scheduleNextRun = () => {
    scheduleSafeTimeout(async () => {
      await run();
      scheduleNextRun();
    }, nextMonthDelayMs());
  };

  scheduleSafeTimeout(run, 60_000);
  scheduleNextRun();
}
