import mongoose from 'mongoose';
import InviteLink from '../../../models/InviteLink.js';
import InviteAttribution from '../../../models/InviteAttribution.js';
import LeadMatch from '../../../models/LeadMatch.js';
import Referral from '../../../models/Referral.js';
import { awardReferralPoints, REFERRAL_REWARD_POINTS } from '../rewardService.js';
import {
  hashToken,
  generateInviteToken,
  buildInviteUrl,
  normalizeChannel,
  nowPlusDays,
  attributionWindowDays,
  serializeInviteLink,
  getInviterPreview,
  loadInviteByToken,
} from './helpers.js';

async function resolveLeadContextForCreate(inviterOid, payload = {}) {
  const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const metadataLeadMatchIdRaw = String(metadata?.lead_match_id || '').trim().slice(0, 64);
  const metadataLeadMatchId = mongoose.Types.ObjectId.isValid(metadataLeadMatchIdRaw)
    ? new mongoose.Types.ObjectId(metadataLeadMatchIdRaw)
    : null;

  let sourceConversationId =
    payload?.source_conversation_id && mongoose.Types.ObjectId.isValid(String(payload.source_conversation_id))
      ? new mongoose.Types.ObjectId(String(payload.source_conversation_id))
      : null;
  const sourceReferralId =
    payload?.source_referral_id && mongoose.Types.ObjectId.isValid(String(payload.source_referral_id))
      ? new mongoose.Types.ObjectId(String(payload.source_referral_id))
      : null;

  let resolvedLeadMatchId = metadataLeadMatchId;

  if (!sourceConversationId && metadataLeadMatchId) {
    const leadMatch = await LeadMatch.findOne({ _id: metadataLeadMatchId, user_id: inviterOid })
      .select('conversation_id')
      .lean();
    const convId = String(leadMatch?.conversation_id || '').trim();
    if (convId && mongoose.Types.ObjectId.isValid(convId)) {
      sourceConversationId = new mongoose.Types.ObjectId(convId);
    }
  }

  if (!resolvedLeadMatchId && sourceConversationId) {
    const fromConv = await LeadMatch.findOne({
      user_id: inviterOid,
      conversation_id: sourceConversationId,
    })
      .select('_id')
      .lean();
    if (fromConv?._id) resolvedLeadMatchId = fromConv._id;
  }

  return { metadata, metadataLeadMatchIdRaw, sourceConversationId, sourceReferralId, resolvedLeadMatchId };
}

export async function createInviteLinkForUser(inviter_user_id, payload = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) {
    return { ok: false, code: 400, message: 'Invalid inviter user id' };
  }

  const inviterOid = new mongoose.Types.ObjectId(String(inviter_user_id));
  const ctx = await resolveLeadContextForCreate(inviterOid, payload);

  if (ctx.sourceConversationId) {
    const ownsLead = await LeadMatch.exists({
      user_id: inviterOid,
      conversation_id: ctx.sourceConversationId,
    });
    if (!ownsLead) {
      return {
        ok: false,
        code: 403,
        message: 'You can only generate lead invite links for conversations linked to your leads.',
      };
    }
  }

  if (ctx.sourceReferralId) {
    const ownsReferral = await Referral.exists({ _id: ctx.sourceReferralId, user_id: inviterOid });
    if (!ownsReferral) {
      return { ok: false, code: 403, message: 'You can only attach invite links to your own referrals.' };
    }
  }

  const rawToken = generateInviteToken();
  const windowDays = attributionWindowDays(payload?.attribution_window_days);
  const shareUrl = buildInviteUrl(rawToken);

  const doc = await InviteLink.create({
    inviter_user_id,
    token_hash: hashToken(rawToken),
    intended_role: String(payload?.intended_role || '').trim(),
    intended_audience: payload?.intended_audience || 'any',
    source_channel: normalizeChannel(payload?.source_channel),
    source_referral_id: ctx.sourceReferralId,
    source_conversation_id: ctx.sourceConversationId,
    expires_at: nowPlusDays(windowDays),
    is_active: true,
    metadata: {
      ...ctx.metadata,
      lead_match_id: ctx.resolvedLeadMatchId
        ? String(ctx.resolvedLeadMatchId)
        : ctx.metadataLeadMatchIdRaw || undefined,
      share_url: shareUrl,
    },
  });

  await awardReferralPoints({
    user_id: inviter_user_id,
    event_type: 'invite_link_created',
    points_delta: REFERRAL_REWARD_POINTS.invite_link_created,
    idempotency_key: `invite:create:${String(doc._id)}`,
    source_model: 'InviteLink',
    source_id: String(doc._id),
    metadata: { source_channel: doc.source_channel },
  });

  return {
    invite: serializeInviteLink(doc),
    token: rawToken,
    share_url: shareUrl,
    attribution_window_days: windowDays,
  };
}

export async function listInviteLinksForUser(inviter_user_id, { page = 1, limit = 20 } = {}) {
  const p = Math.max(Number(page) || 1, 1);
  const l = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (p - 1) * l;

  const [rows, total] = await Promise.all([
    InviteLink.find({ inviter_user_id }).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
    InviteLink.countDocuments({ inviter_user_id }),
  ]);

  const ids = rows.map((r) => r._id);
  const statsById = new Map();
  if (ids.length > 0) {
    const agg = await InviteAttribution.aggregate([
      { $match: { invite_link_id: { $in: ids } } },
      {
        $group: {
          _id: '$invite_link_id',
          clicks: { $sum: 1 },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        },
      },
    ]);
    agg.forEach((r) => statsById.set(String(r._id), r));
  }

  const items = rows.map((row) => {
    const stats = statsById.get(String(row._id)) || {};
    return {
      ...serializeInviteLink(row),
      stats: {
        clicks: Number(stats.clicks || 0),
        pending: Number(stats.pending || 0),
        converted: Number(stats.converted || 0),
      },
    };
  });

  return {
    items,
    pagination: { page: p, limit: l, total, total_pages: Math.max(1, Math.ceil(total / l)) },
  };
}

export async function resolveInviteToken(rawToken) {
  const loaded = await loadInviteByToken(rawToken);
  if (!loaded.ok) return loaded;

  const inviter = await getInviterPreview(loaded.invite.inviter_user_id);
  return {
    ok: true,
    invite: serializeInviteLink(loaded.invite),
    inviter,
    attribution_window_days: attributionWindowDays(
      Math.ceil((new Date(loaded.invite.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    ),
  };
}
