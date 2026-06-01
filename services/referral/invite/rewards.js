import mongoose from 'mongoose';
import InviteLink from '../../../models/InviteLink.js';
import InviteAttribution from '../../../models/InviteAttribution.js';
import { awardReferralPoints, REWARD_RULES, getReferralRewardsSummary } from '../rewardService.js';

const MILESTONE_POINTS = {
  pro_profile_complete: REWARD_RULES.pro_profile_complete,
  pro_verified: REWARD_RULES.pro_verified,
  pro_first_engagement: REWARD_RULES.pro_first_engagement,
  pro_first_deal: REWARD_RULES.pro_first_deal,
};

export async function awardInviterMilestoneForUser(inviteeUserId, milestone, sourceId = '') {
  if (!inviteeUserId || !MILESTONE_POINTS[milestone]) return { awarded: false };
  const inviteeOid = mongoose.Types.ObjectId.isValid(String(inviteeUserId))
    ? new mongoose.Types.ObjectId(String(inviteeUserId))
    : null;
  if (!inviteeOid) return { awarded: false };

  const attribution = await InviteAttribution.findOne({
    consumed_by_user_id: inviteeOid,
    status: 'converted',
  })
    .sort({ consumed_at: -1 })
    .lean();
  if (!attribution?.invite_link_id) return { awarded: false };

  const invite = await InviteLink.findById(attribution.invite_link_id).select('inviter_user_id').lean();
  if (!invite?.inviter_user_id) return { awarded: false };

  return awardReferralPoints({
    user_id: invite.inviter_user_id,
    event_type: milestone,
    points_delta: MILESTONE_POINTS[milestone],
    idempotency_key: `invite:milestone:${milestone}:${String(inviteeOid)}`,
    source_model: 'InviteAttribution',
    source_id: sourceId || String(attribution._id),
    metadata: { invitee_user_id: String(inviteeOid) },
  });
}

export async function getRewardsProfileForUser(userId) {
  const summary = await getReferralRewardsSummary(userId);
  const latestInvite = await InviteLink.findOne({ inviter_user_id: userId, is_active: true })
    .sort({ createdAt: -1 })
    .lean();
  return {
    ...summary,
    referral_code: latestInvite?._id ? String(latestInvite._id).slice(-8).toUpperCase() : null,
    referral_link: latestInvite?.metadata?.share_url || null,
  };
}
