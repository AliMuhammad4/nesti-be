import mongoose from 'mongoose';
import InviteAttribution from '../../../models/InviteAttribution.js';
import { awardReferralPoints, REFERRAL_REWARD_POINTS, REWARD_RULES } from '../rewardService.js';
import {
  isValidInviteToken,
  hashFingerprint,
  normalizeSessionId,
  normalizeVisitorId,
  normalizeChannel,
  safeUrl,
  serializeAttribution,
  getInviterPreview,
  loadInviteByToken,
} from './helpers.js';
import {
  inviterIdFromInvite,
  findLeadReferralForInviteTarget,
  createOrGetLeadReferralFromInvite,
} from './leadReferral.js';
import { awardInviterMilestoneForUser } from './rewards.js';

export async function captureInviteAttribution(rawToken, payload = {}, requestContext = {}) {
  const loaded = await loadInviteByToken(rawToken);
  if (!loaded.ok) return loaded;
  const { invite } = loaded;

  const fingerprint_hash = hashFingerprint(
    `${String(requestContext.ip || '')}:${String(requestContext.user_agent || '')}`,
  ).slice(0, 48);

  const recentCount = await InviteAttribution.countDocuments({
    fingerprint_hash,
    createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
  });
  if (recentCount >= 30) {
    return { ok: false, code: 429, message: 'Too many invite clicks. Please try again shortly.' };
  }

  const now = new Date();
  const attribution = await InviteAttribution.findOneAndUpdate(
    {
      token_hash: loaded.token_hash,
      session_id: normalizeSessionId(payload.session_id) || '',
      visitor_id: normalizeVisitorId(payload.visitor_id) || '',
      fingerprint_hash,
    },
    {
      $setOnInsert: {
        invite_link_id: invite._id,
        token_hash: loaded.token_hash,
        session_id: normalizeSessionId(payload.session_id) || '',
        visitor_id: normalizeVisitorId(payload.visitor_id) || '',
        fingerprint_hash,
        first_clicked_at: now,
        expires_at: invite.expires_at,
        status: 'pending',
      },
      $set: {
        last_clicked_at: now,
        source_channel: normalizeChannel(payload.source_channel || invite.source_channel),
        source_referrer: safeUrl(payload.source_referrer),
        landing_path: String(payload.landing_path || '').slice(0, 256),
      },
    },
    { returnDocument: 'after', upsert: true },
  );

  await awardReferralPoints({
    user_id: invite.inviter_user_id,
    event_type: 'invite_click_captured',
    points_delta: REFERRAL_REWARD_POINTS.invite_click_captured,
    idempotency_key: `invite:click:${String(attribution._id)}`,
    source_model: 'InviteAttribution',
    source_id: String(attribution._id),
    metadata: { source_channel: attribution.source_channel || invite.source_channel || 'direct' },
  });

  return { ok: true, attribution: serializeAttribution(attribution) };
}

export async function finalizeInviteAttribution({
  invite_token = '',
  authenticated_user_id,
  method = '',
  path = '',
}) {
  if (!authenticated_user_id || !mongoose.Types.ObjectId.isValid(String(authenticated_user_id))) {
    return { ok: false, code: 400, message: 'Invalid user id for attribution finalization' };
  }
  if (!isValidInviteToken(invite_token)) {
    return { ok: false, code: 400, message: 'Invalid invite token' };
  }

  const loaded = await loadInviteByToken(invite_token);
  if (!loaded.ok) return loaded;
  const { invite, token_hash } = loaded;

  const authUserId = new mongoose.Types.ObjectId(String(authenticated_user_id));
  if (String(invite.inviter_user_id) === String(authUserId)) {
    return {
      ok: true,
      ignored: true,
      ignored_reason: 'self_referral',
      message: 'Invite attribution ignored (self referral)',
    };
  }

  const inviterId = inviterIdFromInvite(invite);
  const conversionContext = {
    method: String(method || '').slice(0, 48),
    path: String(path || '').slice(0, 128),
  };

  const findConverted = () =>
    InviteAttribution.findOne({
      token_hash,
      consumed_by_user_id: authUserId,
      status: 'converted',
    }).lean();

  const claimPending = () =>
    InviteAttribution.findOneAndUpdate(
      { token_hash, status: 'pending', expires_at: { $gte: new Date() } },
      {
        $set: {
          status: 'converted',
          consumed_by_user_id: authUserId,
          consumed_at: new Date(),
          conversion_context: conversionContext,
        },
      },
      { sort: { last_clicked_at: -1 }, returnDocument: 'after' },
    );

  const convertedResponse = async (doc) => ({
    ok: true,
    already_converted: true,
    attribution: serializeAttribution(doc),
    lead_referral: await findLeadReferralForInviteTarget({ invite, inviterId, targetUserId: authUserId }),
  });

  const prior = await findConverted();
  if (prior) return convertedResponse(prior);

  let attribution = await claimPending();
  if (!attribution) {
    await captureInviteAttribution(
      invite_token,
      { source_channel: invite.source_channel, landing_path: String(path || '').slice(0, 256) },
      { ip: '', user_agent: '' },
    );
    attribution = await claimPending();
  }

  if (!attribution) {
    const raced = await findConverted();
    if (raced) return convertedResponse(raced);
    return { ok: false, code: 404, message: 'No pending attribution found for this invite' };
  }

  const lead_referral = await createOrGetLeadReferralFromInvite({
    invite,
    inviterId,
    targetUserId: authUserId,
  });

  await awardReferralPoints({
    user_id: invite.inviter_user_id,
    event_type: 'pro_signup',
    points_delta: REWARD_RULES.pro_signup,
    idempotency_key: `invite:pro_signup:${String(attribution._id)}:${String(authUserId)}`,
    source_model: 'InviteAttribution',
    source_id: String(attribution._id),
    metadata: {
      consumed_by_user_id: String(authUserId),
      source_channel: attribution.source_channel || invite.source_channel || 'direct',
    },
  });
  await awardReferralPoints({
    user_id: invite.inviter_user_id,
    event_type: 'invite_signup_converted',
    points_delta: REWARD_RULES.invite_signup_converted,
    idempotency_key: `invite:converted:${String(attribution._id)}:${String(authUserId)}`,
    source_model: 'InviteAttribution',
    source_id: String(attribution._id),
    metadata: { consumed_by_user_id: String(authUserId) },
  });

  await awardInviterMilestoneForUser(authUserId, 'pro_verified', String(attribution._id));

  return {
    ok: true,
    attribution: serializeAttribution(attribution),
    inviter: await getInviterPreview(invite.inviter_user_id),
    lead_referral,
  };
}
