import crypto from 'crypto';
import mongoose from 'mongoose';
import InviteLink from '../../models/InviteLink.js';
import InviteAttribution from '../../models/InviteAttribution.js';
import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import LeadMatch from '../../models/LeadMatch.js';
import Referral from '../../models/Referral.js';
import {
  awardReferralPoints,
  getReferralRewardsSummary,
  REWARD_RULES,
  REFERRAL_REWARD_POINTS,
} from './rewardService.js';
import { createReferralForUser } from './referralService.js';

const DEFAULT_INVITE_ATTRIBUTION_DAYS = Number(process.env.INVITE_ATTRIBUTION_DAYS || 90);
const MAX_INVITE_ATTRIBUTION_DAYS = 90;
const MIN_INVITE_ATTRIBUTION_DAYS = 30;
const TOKEN_BYTES = 24;

function nowPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function normalizedAttributionWindowDays(days) {
  const n = Number(days || DEFAULT_INVITE_ATTRIBUTION_DAYS);
  if (!Number.isFinite(n)) return DEFAULT_INVITE_ATTRIBUTION_DAYS;
  return Math.max(MIN_INVITE_ATTRIBUTION_DAYS, Math.min(MAX_INVITE_ATTRIBUTION_DAYS, Math.round(n)));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function hashFingerprint(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function getAppBaseUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_FRONTEND_URL ||
    ''
  ).replace(/\/+$/, '');
}

function safeUrl(urlLike = '') {
  const value = String(urlLike || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return '';
  }
}

function buildInviteUrl(rawToken) {
  const base = getAppBaseUrl();
  if (!base) return `/invite/${rawToken}`;
  return `${base}/invite/${rawToken}`;
}

function normalizeSessionId(session_id) {
  const value = String(session_id || '').trim();
  if (!value) return '';
  return value.slice(0, 128);
}

function normalizeVisitorId(visitor_id) {
  const value = String(visitor_id || '').trim();
  if (!value) return '';
  return value.slice(0, 128);
}

function normalizeChannel(channel) {
  const raw = String(channel || 'direct').trim().toLowerCase();
  return raw || 'direct';
}

function serializeInviteLink(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  if (!d?._id) return null;
  return {
    id: String(d._id),
    inviter_user_id: d.inviter_user_id ? String(d.inviter_user_id) : '',
    intended_role: d.intended_role || '',
    intended_audience: d.intended_audience || 'any',
    source_channel: d.source_channel || 'direct',
    source_referral_id: d.source_referral_id ? String(d.source_referral_id) : null,
    source_conversation_id: d.source_conversation_id ? String(d.source_conversation_id) : null,
    share_url: String(d?.metadata?.share_url || '').trim() || '',
    is_active: Boolean(d.is_active),
    expires_at: d.expires_at || null,
    created_at: d.createdAt || null,
    updated_at: d.updatedAt || null,
  };
}

function serializeAttribution(doc) {
  const d = doc?.toObject ? doc.toObject() : doc;
  if (!d?._id) return null;
  return {
    id: String(d._id),
    invite_link_id: d.invite_link_id ? String(d.invite_link_id) : '',
    session_id: d.session_id || '',
    visitor_id: d.visitor_id || '',
    source_channel: d.source_channel || 'direct',
    status: d.status || 'pending',
    first_clicked_at: d.first_clicked_at || null,
    last_clicked_at: d.last_clicked_at || null,
    expires_at: d.expires_at || null,
    consumed_by_user_id: d.consumed_by_user_id ? String(d.consumed_by_user_id) : null,
    consumed_at: d.consumed_at || null,
  };
}

async function getInviterPreview(inviter_user_id) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) return null;
  const inviter = await User.findById(inviter_user_id)
    .select('first_name last_name email role profile_image')
    .lean();
  if (!inviter) return null;
  const pro = await ProfessionalProfile.findOne({ user_id: inviter._id })
    .select('full_name company_name professional_type')
    .lean();
  const fallbackName = [inviter.first_name, inviter.last_name].filter(Boolean).join(' ').trim();
  return {
    id: String(inviter._id),
    full_name: String(pro?.full_name || fallbackName || inviter.email || '').trim(),
    first_name: inviter.first_name || '',
    last_name: inviter.last_name || '',
    email: inviter.email || '',
    role: inviter.role || pro?.professional_type || '',
    profile_image: inviter.profile_image || null,
    company_name: pro?.company_name || '',
  };
}

export async function createInviteLinkForUser(inviter_user_id, payload = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) {
    return { ok: false, code: 400, message: 'Invalid inviter user id' };
  }

  const inviterOid = new mongoose.Types.ObjectId(String(inviter_user_id));
  const metadataFromPayload = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const metadataLeadMatchIdRaw = String(metadataFromPayload?.lead_match_id || '')
    .trim()
    .slice(0, 64);
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

  let resolvedMetadataLeadMatchId = metadataLeadMatchId;

  if (!sourceConversationId && metadataLeadMatchId) {
    const leadMatch = await LeadMatch.findOne({
      _id: metadataLeadMatchId,
      user_id: inviterOid,
    })
      .select('conversation_id')
      .lean();
    const convIdRaw = String(leadMatch?.conversation_id || '').trim();
    if (convIdRaw && mongoose.Types.ObjectId.isValid(convIdRaw)) {
      sourceConversationId = new mongoose.Types.ObjectId(convIdRaw);
    }
  }

  if (!resolvedMetadataLeadMatchId && sourceConversationId) {
    const leadFromConv = await LeadMatch.findOne({
      user_id: inviterOid,
      conversation_id: sourceConversationId,
    })
      .select('_id')
      .lean();
    if (leadFromConv?._id) {
      resolvedMetadataLeadMatchId = leadFromConv._id;
    }
  }

  if (sourceConversationId) {
    const ownsLead = await LeadMatch.exists({
      user_id: inviterOid,
      conversation_id: sourceConversationId,
    });
    if (!ownsLead) {
      return {
        ok: false,
        code: 403,
        message: 'You can only generate lead invite links for conversations linked to your leads.',
      };
    }
  }

  if (sourceReferralId) {
    const ownsReferral = await Referral.exists({
      _id: sourceReferralId,
      user_id: inviterOid,
    });
    if (!ownsReferral) {
      return {
        ok: false,
        code: 403,
        message: 'You can only attach invite links to your own referrals.',
      };
    }
  }

  const rawToken = generateToken();
  const token_hash = hashToken(rawToken);
  const windowDays = normalizedAttributionWindowDays(payload?.attribution_window_days);
  const expiresAt = nowPlusDays(windowDays);

  const shareUrl = buildInviteUrl(rawToken);
  const doc = await InviteLink.create({
    inviter_user_id,
    token_hash,
    intended_role: String(payload?.intended_role || '').trim(),
    intended_audience: payload?.intended_audience || 'any',
    source_channel: normalizeChannel(payload?.source_channel),
    source_referral_id: sourceReferralId,
    source_conversation_id: sourceConversationId,
    expires_at: expiresAt,
    is_active: true,
    metadata: {
      ...metadataFromPayload,
      lead_match_id: resolvedMetadataLeadMatchId
        ? String(resolvedMetadataLeadMatchId)
        : metadataLeadMatchIdRaw || undefined,
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
  const attributionRows =
    ids.length > 0
      ? await InviteAttribution.aggregate([
          { $match: { invite_link_id: { $in: ids } } },
          {
            $group: {
              _id: '$invite_link_id',
              clicks: { $sum: 1 },
              converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
              pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
            },
          },
        ])
      : [];

  const statsById = new Map(attributionRows.map((r) => [String(r._id), r]));
  const items = rows.map((row) => {
    const stats = statsById.get(String(row._id)) || {};
    const invite = serializeInviteLink(row);
    return {
      ...invite,
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
  if (!rawToken || String(rawToken).trim().length < 12) {
    return { ok: false, code: 400, message: 'Invalid invite token' };
  }
  const token_hash = hashToken(rawToken);
  const invite = await InviteLink.findOne({ token_hash }).lean();
  if (!invite) {
    return { ok: false, code: 404, message: 'Invite not found' };
  }
  if (!invite.is_active || (invite.expires_at && new Date(invite.expires_at) < new Date())) {
    return { ok: false, code: 410, message: 'Invite has expired' };
  }

  const inviter = await getInviterPreview(invite.inviter_user_id);
  return {
    ok: true,
    invite: serializeInviteLink(invite),
    inviter,
    attribution_window_days: normalizedAttributionWindowDays(
      Math.ceil((new Date(invite.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    ),
  };
}

export async function captureInviteAttribution(rawToken, payload = {}, requestContext = {}) {
  if (!rawToken || String(rawToken).trim().length < 12) {
    return { ok: false, code: 400, message: 'Invalid invite token' };
  }
  const token_hash = hashToken(rawToken);
  const invite = await InviteLink.findOne({ token_hash }).lean();
  if (!invite) return { ok: false, code: 404, message: 'Invite not found' };
  if (!invite.is_active || (invite.expires_at && new Date(invite.expires_at) < new Date())) {
    return { ok: false, code: 410, message: 'Invite has expired' };
  }

  const ip = String(requestContext.ip || '');
  const ua = String(requestContext.user_agent || '');
  const fingerprint_hash = hashFingerprint(`${ip}:${ua}`).slice(0, 48);
  const session_id = normalizeSessionId(payload.session_id);
  const visitor_id = normalizeVisitorId(payload.visitor_id);

  // Basic anti-abuse guard: keep capture bursts from a single device in check.
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const recentCount = await InviteAttribution.countDocuments({
    fingerprint_hash,
    createdAt: { $gte: oneMinuteAgo },
  });
  if (recentCount >= 30) {
    return { ok: false, code: 429, message: 'Too many invite clicks. Please try again shortly.' };
  }

  const keyFilter = {
    token_hash,
    session_id: session_id || '',
    visitor_id: visitor_id || '',
    fingerprint_hash,
  };
  const now = new Date();
  const update = {
    $setOnInsert: {
      invite_link_id: invite._id,
      token_hash,
      session_id: session_id || '',
      visitor_id: visitor_id || '',
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
  };

  const attribution = await InviteAttribution.findOneAndUpdate(keyFilter, update, {
    returnDocument: 'after',
    upsert: true,
  });

  await awardReferralPoints({
    user_id: invite.inviter_user_id,
    event_type: 'invite_click_captured',
    points_delta: REFERRAL_REWARD_POINTS.invite_click_captured,
    idempotency_key: `invite:click:${String(attribution._id)}`,
    source_model: 'InviteAttribution',
    source_id: String(attribution._id),
    metadata: { source_channel: attribution.source_channel || invite.source_channel || 'direct' },
  });

  return {
    ok: true,
    attribution: serializeAttribution(attribution),
  };
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
  if (!invite_token || String(invite_token).trim().length < 12) {
    return { ok: false, code: 400, message: 'Invalid invite token' };
  }

  const token_hash = hashToken(invite_token);
  const invite = await InviteLink.findOne({ token_hash }).lean();
  if (!invite) return { ok: false, code: 404, message: 'Invite not found' };

  const authUserId = new mongoose.Types.ObjectId(String(authenticated_user_id));
  if (String(invite.inviter_user_id) === String(authUserId)) {
    // Common in dev (or when user previews their own invite link while logged in).
    // Treat as a no-op so clients can clear stored invite tokens without retry loops.
    return {
      ok: true,
      ignored: true,
      ignored_reason: 'self_referral',
      message: 'Invite attribution ignored (self referral)',
    };
  }
  if (!invite.is_active || (invite.expires_at && new Date(invite.expires_at) < new Date())) {
    return { ok: false, code: 410, message: 'Invite has expired' };
  }

  async function createOrGetLeadReferralFromInviteWithLeadId(resolvedLeadMatchId) {
    const newUser = await User.findById(authUserId).select('role').lean();
    const inferredVertical = String(invite?.intended_role || newUser?.role || 'agent').trim().toLowerCase();
    const autoReferral = await createReferralForUser(invite.inviter_user_id, {
      target_user_id: authUserId,
      lead_match_id: resolvedLeadMatchId,
      target_vertical: inferredVertical || 'agent',
      status: 'pending',
      notes: 'Auto-created from lead invite link signup.',
    });
    if (autoReferral?.ok) {
      return autoReferral.referral || null;
    }
    if (autoReferral?.code === 409) {
      const existing = await Referral.findOne({
        user_id: invite.inviter_user_id,
        target_user_id: authUserId,
        lead_match_id: new mongoose.Types.ObjectId(resolvedLeadMatchId),
      })
        .sort({ updatedAt: -1 })
        .lean();
      if (existing?._id) {
        return {
          id: String(existing._id),
          status: existing.status || '',
          existing: true,
        };
      }
    }
    return null;
  }

  async function createOrGetLeadReferralFromInvite() {
    const inviterOid = invite.inviter_user_id?._id || invite.inviter_user_id;
    const leadMatchIdRaw = String(invite?.metadata?.lead_match_id || '').trim();
    if (mongoose.Types.ObjectId.isValid(leadMatchIdRaw) && mongoose.Types.ObjectId.isValid(String(inviterOid))) {
      const sourceLead = await LeadMatch.findOne({
        _id: new mongoose.Types.ObjectId(leadMatchIdRaw),
        user_id: new mongoose.Types.ObjectId(String(inviterOid)),
      })
        .select('_id')
        .lean();
      if (sourceLead?._id) {
        return createOrGetLeadReferralFromInviteWithLeadId(String(sourceLead._id));
      }
    }
    const convIdRaw = String(invite?.source_conversation_id || '').trim();
    if (mongoose.Types.ObjectId.isValid(convIdRaw) && mongoose.Types.ObjectId.isValid(String(inviterOid))) {
      const sourceLead = await LeadMatch.findOne({
        user_id: new mongoose.Types.ObjectId(String(inviterOid)),
        conversation_id: new mongoose.Types.ObjectId(convIdRaw),
      })
        .select('_id')
        .lean();
      if (sourceLead?._id) {
        return createOrGetLeadReferralFromInviteWithLeadId(String(sourceLead._id));
      }
    }
    if (mongoose.Types.ObjectId.isValid(leadMatchIdRaw) && mongoose.Types.ObjectId.isValid(String(inviterOid))) {
      const byConvSurrogate = await LeadMatch.findOne({
        user_id: new mongoose.Types.ObjectId(String(inviterOid)),
        conversation_id: new mongoose.Types.ObjectId(leadMatchIdRaw),
      })
        .select('_id')
        .lean();
      if (byConvSurrogate?._id) {
        return createOrGetLeadReferralFromInviteWithLeadId(String(byConvSurrogate._id));
      }
    }
    return null;
  }

  const existingForThisInvite = await InviteAttribution.findOne({
    token_hash,
    consumed_by_user_id: authUserId,
    status: 'converted',
  }).lean();
  if (existingForThisInvite) {
    const linkedLeadReferral = await createOrGetLeadReferralFromInvite();
    return {
      ok: true,
      already_converted: true,
      attribution: serializeAttribution(existingForThisInvite),
      lead_referral: linkedLeadReferral,
    };
  }

  const findPendingAttribution = () =>
    InviteAttribution.findOne({
      token_hash,
      status: 'pending',
      expires_at: { $gte: new Date() },
    }).sort({ last_clicked_at: -1 });

  let attribution = await findPendingAttribution();

  // Signup/login often pass invite_token without a prior /api/invites/capture call.
  if (!attribution) {
    await captureInviteAttribution(
      invite_token,
      {
        source_channel: invite.source_channel,
        landing_path: String(path || '').slice(0, 256),
      },
      { ip: '', user_agent: '' }
    );
    attribution = await findPendingAttribution();
  }

  if (!attribution) {
    return { ok: false, code: 404, message: 'No pending attribution found for this invite' };
  }

  attribution.status = 'converted';
  attribution.consumed_by_user_id = authUserId;
  attribution.consumed_at = new Date();
  attribution.conversion_context = {
    method: String(method || '').slice(0, 48),
    path: String(path || '').slice(0, 128),
  };
  await attribution.save();

  const linkedLeadReferral = await createOrGetLeadReferralFromInvite();

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

  const inviter = await getInviterPreview(invite.inviter_user_id);
  return {
    ok: true,
    attribution: serializeAttribution(attribution),
    inviter,
    lead_referral: linkedLeadReferral,
  };
}

export async function getInviteMetricsForUser(inviter_user_id, { days = 30 } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) {
    return {
      window_days: 30,
      totals: { invites_sent: 0, clicked: 0, pending: 0, completed: 0, conversion_rate: 0 },
      by_channel: [],
      points: { points_balance: 0, events_count: 0, last_event_at: null },
    };
  }
  const uid = new mongoose.Types.ObjectId(String(inviter_user_id));
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const [invitesSent, aggByChannel, summaryAgg, points] = await Promise.all([
    InviteLink.countDocuments({ inviter_user_id: uid, createdAt: { $gte: since } }),
    InviteAttribution.aggregate([
      {
        $lookup: {
          from: 'invitelinks',
          localField: 'invite_link_id',
          foreignField: '_id',
          as: 'invite_link',
        },
      },
      { $unwind: '$invite_link' },
      {
        $match: {
          'invite_link.inviter_user_id': uid,
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: '$source_channel',
          clicked: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
        },
      },
    ]),
    InviteAttribution.aggregate([
      {
        $lookup: {
          from: 'invitelinks',
          localField: 'invite_link_id',
          foreignField: '_id',
          as: 'invite_link',
        },
      },
      { $unwind: '$invite_link' },
      {
        $match: {
          'invite_link.inviter_user_id': uid,
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: null,
          clicked: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
        },
      },
    ]),
    getReferralRewardsSummary(uid),
  ]);

  const totals = summaryAgg?.[0] || { clicked: 0, pending: 0, completed: 0 };
  const conversionRate =
    Number(totals.clicked) > 0 ? Number((Number(totals.completed) / Number(totals.clicked)).toFixed(3)) : 0;

  const latestInvite = await InviteLink.findOne({ inviter_user_id: uid, is_active: true })
    .sort({ createdAt: -1 })
    .lean();
  const shareUrl = latestInvite?.metadata?.share_url || null;

  return {
    window_days: windowDays,
    totals: {
      invites_sent: Number(invitesSent || 0),
      clicked: Number(totals.clicked || 0),
      pending: Number(totals.pending || 0),
      completed: Number(totals.completed || 0),
      conversion_rate: conversionRate,
    },
    by_channel: aggByChannel.map((row) => ({
      channel: row._id || 'direct',
      clicked: Number(row.clicked || 0),
      pending: Number(row.pending || 0),
      completed: Number(row.completed || 0),
    })),
    points: {
      ...points,
      tier: points.tier || 'bronze',
      reputation_score: points.reputation_score ?? 50,
      referral_link: shareUrl,
    },
  };
}

const INVITEE_MILESTONE_RULES = {
  pro_profile_complete: REWARD_RULES.pro_profile_complete,
  pro_verified: REWARD_RULES.pro_verified,
  pro_first_engagement: REWARD_RULES.pro_first_engagement,
  pro_first_deal: REWARD_RULES.pro_first_deal,
};

/**
 * Award the inviter when an invitee (converted attribution) hits a lifecycle milestone.
 */
export async function awardInviterMilestoneForUser(inviteeUserId, milestone, sourceId = '') {
  if (!inviteeUserId || !INVITEE_MILESTONE_RULES[milestone]) return { awarded: false };
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
    points_delta: INVITEE_MILESTONE_RULES[milestone],
    idempotency_key: `invite:milestone:${milestone}:${String(inviteeOid)}`,
    source_model: 'InviteAttribution',
    source_id: sourceId || String(attribution._id),
    metadata: { invitee_user_id: String(inviteeOid) },
  });
}

export async function getRewardsProfileForUser(userId) {
  const summary = await getReferralRewardsSummary(userId);
  const latestInvite = await InviteLink.findOne({
    inviter_user_id: userId,
    is_active: true,
  })
    .sort({ createdAt: -1 })
    .lean();
  const referral_link = latestInvite?.metadata?.share_url || null;
  return {
    ...summary,
    referral_code: latestInvite?._id ? String(latestInvite._id).slice(-8).toUpperCase() : null,
    referral_link,
  };
}

/**
 * List people who joined via this user's invite links (InviteAttribution converted).
 * Used for Analytics → Invite signups table.
 */
export async function listInviteConversionsForUser(
  inviter_user_id,
  { days = 30, page = 1, limit = 10 } = {},
) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) {
    return {
      window_days: 30,
      items: [],
      pagination: {
        page: 1,
        current_page: 1,
        limit: 10,
        total: 0,
        total_pages: 0,
        has_prev_page: false,
        has_next_page: false,
        has_more: false,
      },
    };
  }
  const uid = new mongoose.Types.ObjectId(String(inviter_user_id));
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const p = Math.max(Number(page) || 1, 1);
  const l = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const skip = (p - 1) * l;
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const rows = await InviteAttribution.aggregate([
    {
      $lookup: {
        from: 'invitelinks',
        localField: 'invite_link_id',
        foreignField: '_id',
        as: 'invite_link',
      },
    },
    { $unwind: '$invite_link' },
    {
      $match: {
        'invite_link.inviter_user_id': uid,
        status: 'converted',
        consumed_by_user_id: { $ne: null },
        consumed_at: { $gte: since },
      },
    },
    { $sort: { consumed_at: -1 } },
    {
      $facet: {
        meta: [{ $count: 'total' }],
        items: [
          { $skip: skip },
          { $limit: l },
          {
            $lookup: {
              from: 'users',
              localField: 'consumed_by_user_id',
              foreignField: '_id',
              as: 'consumed_user',
            },
          },
          { $unwind: { path: '$consumed_user', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              consumed_at: 1,
              source_channel: 1,
              landing_path: 1,
              invite_link: {
                _id: '$invite_link._id',
                intended_role: '$invite_link.intended_role',
                intended_audience: '$invite_link.intended_audience',
                source_channel: '$invite_link.source_channel',
                source_conversation_id: '$invite_link.source_conversation_id',
                createdAt: '$invite_link.createdAt',
                share_url: '$invite_link.metadata.share_url',
              },
              consumed_user: {
                _id: '$consumed_user._id',
                full_name: '$consumed_user.full_name',
                first_name: '$consumed_user.first_name',
                last_name: '$consumed_user.last_name',
                email: '$consumed_user.email',
                role: '$consumed_user.role',
                profile_image: '$consumed_user.profile_image',
              },
            },
          },
        ],
      },
    },
  ]);

  const payload = rows?.[0] || {};
  const total = payload?.meta?.[0]?.total || 0;
  const total_pages = total > 0 ? Math.ceil(total / l) : 0;
  const items = Array.isArray(payload?.items) ? payload.items : [];

  return {
    window_days: windowDays,
    items: items.map((row) => ({
      id: String(row._id),
      consumed_at: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
      source_channel: row.source_channel || '',
      landing_path: row.landing_path || '',
      invite_link: row.invite_link
        ? {
            id: String(row.invite_link._id),
            intended_role: row.invite_link.intended_role || '',
            intended_audience: row.invite_link.intended_audience || 'any',
            source_channel: row.invite_link.source_channel || '',
            source_conversation_id: row.invite_link.source_conversation_id
              ? String(row.invite_link.source_conversation_id)
              : null,
            created_at: row.invite_link.createdAt ? new Date(row.invite_link.createdAt).toISOString() : null,
            share_url: row.invite_link.share_url || '',
          }
        : null,
      joined_user: row.consumed_user?._id
        ? {
            id: String(row.consumed_user._id),
            full_name:
              String(row.consumed_user.full_name || '').trim() ||
              [row.consumed_user.first_name, row.consumed_user.last_name]
                .filter(Boolean)
                .join(' ')
                .trim() ||
              null,
            email: row.consumed_user.email || null,
            role: row.consumed_user.role || null,
            profile_image: row.consumed_user.profile_image || null,
          }
        : null,
    })),
    pagination: {
      page: p,
      current_page: p,
      limit: l,
      total,
      total_pages,
      has_prev_page: p > 1,
      has_next_page: p < total_pages,
      has_more: p < total_pages,
    },
  };
}

export async function getInviteConversionRoleTrendsForUser(inviter_user_id, { days = 30 } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(inviter_user_id))) {
    return { window_days: 30, roles: [], series: [], total: 0 };
  }

  const uid = new mongoose.Types.ObjectId(String(inviter_user_id));
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (windowDays - 1));

  const rows = await InviteAttribution.aggregate([
    {
      $match: {
        status: 'converted',
        consumed_by_user_id: { $ne: null },
        consumed_at: { $gte: since },
      },
    },
    {
      $lookup: {
        from: 'invitelinks',
        localField: 'invite_link_id',
        foreignField: '_id',
        as: 'invite_link',
      },
    },
    { $unwind: '$invite_link' },
    { $match: { 'invite_link.inviter_user_id': uid } },
    {
      $lookup: {
        from: 'users',
        localField: 'consumed_by_user_id',
        foreignField: '_id',
        as: 'consumed_user',
      },
    },
    { $unwind: { path: '$consumed_user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        day: { $dateToString: { date: '$consumed_at', format: '%Y-%m-%d', timezone: 'UTC' } },
        role: {
          $ifNull: [
            '$consumed_user.role',
            {
              $cond: [
                { $ne: ['$invite_link.intended_role', ''] },
                '$invite_link.intended_role',
                'unknown',
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: { day: '$day', role: '$role' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.day': 1, '_id.role': 1 } },
  ]);

  const roles = [];
  const roleSet = new Set();
  const countsByDay = new Map();
  let total = 0;

  rows.forEach((row) => {
    const day = row?._id?.day;
    const role = String(row?._id?.role || 'unknown').trim().toLowerCase() || 'unknown';
    const count = Number(row?.count || 0);
    if (!day || count <= 0) return;
    if (!roleSet.has(role)) {
      roleSet.add(role);
      roles.push(role);
    }
    const dayCounts = countsByDay.get(day) || {};
    dayCounts[role] = count;
    countsByDay.set(day, dayCounts);
    total += count;
  });

  const formatter = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', timeZone: 'UTC' });
  const series = Array.from({ length: windowDays }, (_, idx) => {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + idx);
    const date = d.toISOString().slice(0, 10);
    const counts = countsByDay.get(date) || {};
    return {
      date,
      label: formatter.format(d),
      ...roles.reduce((acc, role) => {
        acc[role] = Number(counts[role] || 0);
        return acc;
      }, {}),
    };
  });

  return { window_days: windowDays, roles, series, total };
}
