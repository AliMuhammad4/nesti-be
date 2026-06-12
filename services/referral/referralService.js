import mongoose from 'mongoose';
import Referral from '../../models/Referral.js';
import LeadMatch from '../../models/LeadMatch.js';
import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import LeadProfile from '../../models/LeadProfile.js';
import WorkspaceAppointment from '../../models/WorkspaceAppointment.js';
import logger from '../../utils/logger.js';
import { REFERRAL_STATUSES } from '../../constants/validationEnums.js';
import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
import { buildNurtureConsultationBookedFromEmailByProfileIds } from '../lead/leadNurtureBookingStatus.js';
import {
  notifyReferralAccepted,
  notifyReferralReceived,
  notifyReferralRejected,
} from './referralNotifications.js';
import { mapLeadMatchToDetail } from '../lead/leadResponseMappers.js';
import { mapLeadProfileForApi } from '../lead/leadProfileFormat.js';
import { PROFESSIONAL_TYPE, PROFESSIONAL_TYPE_VALUES } from '../../constants/roles.js';
import { recordLeadKpiEvent } from '../analytics/leadKpiService.js';
import { awardReferralPoints, REWARD_RULES, REFERRAL_REWARD_POINTS } from './rewardService.js';
import { getOrCreateSubscriptionForUser } from '../billing/subscriptionService.js';
import {
  assertWithinPlanQuota,
  handleWorkspacePlanQuotaError,
  PlanQuotaError,
} from '../billing/planQuota.js';

/** Shape profile/contact/property for API rows by referrer role (not viewer role). */
export function displayProfessionalTypeFromRole(roleRaw) {
  const r = String(roleRaw || '').trim().toLowerCase();
  if (r === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (r === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  return PROFESSIONAL_TYPE.AGENT;
}

export function userPreview(u) {
  if (!u) return null;
  if (typeof u === 'string') return { id: String(u) };
  const id = u?._id || u?.id;
  if (!id) return null;
  const full = String(
    u?.full_name || [u?.first_name, u?.last_name].filter(Boolean).join(' ') || ''
  ).trim();
  return {
    id: String(id),
    full_name: full || null,
    email: u?.email || null,
    role: u?.role || null,
    profile_image: u?.profile_image || null,
  };
}

export function serializeReferral(doc) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o || !o._id) return null;
  const userIdRaw = o.user_id?._id || o.user_id;
  const targetUserIdRaw = o.target_user_id?._id || o.target_user_id;
  return {
    id: String(o._id),
    user_id: userIdRaw ? String(userIdRaw) : '',
    target_user_id: targetUserIdRaw ? String(targetUserIdRaw) : '',
    lead_match_id: o.lead_match_id ? String(o.lead_match_id) : '',
    target_vertical: o.target_vertical,
    status: o.status,
    notes: o.notes ?? '',
    referrer: userPreview(o.user_id),
    target_professional: userPreview(o.target_user_id),
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

async function resolveSourceLeadForReferral({ userId, leadMatchIdRaw = '', conversationIdRaw = '' }) {
  const userOid = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : null;
  if (!userOid) return null;

  const leadMatchId = String(leadMatchIdRaw || '').trim();
  if (mongoose.Types.ObjectId.isValid(leadMatchId)) {
    const leadOid = new mongoose.Types.ObjectId(leadMatchId);
    const byLeadId = await LeadMatch.findOne({
      _id: leadOid,
      user_id: userOid,
    }).lean();
    if (byLeadId) return byLeadId;
    // Legacy: lead_match_id sometimes stored a chat conversation id instead of LeadMatch._id.
    const byConvFromLeadId = await LeadMatch.findOne({
      user_id: userOid,
      conversation_id: leadOid,
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (byConvFromLeadId) return byConvFromLeadId;
  }

  const conversationId = String(conversationIdRaw || '').trim();
  if (mongoose.Types.ObjectId.isValid(conversationId)) {
    const byConversation = await LeadMatch.findOne({
      user_id: userOid,
      conversation_id: new mongoose.Types.ObjectId(conversationId),
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (byConversation) return byConversation;
  }
  return null;
}

function intentFromLeadType(leadType) {
  const t = String(leadType || '').trim().toLowerCase();
  if (/_buyer$/.test(t)) return 'buy';
  if (/_seller$/.test(t)) return 'sell';
  return null;
}

/** e.g. "Hot Buyer" / "Interested Seller" when conversation.intent is still unspecified. */
function intentFromClassification(classification) {
  const s = String(classification || '').trim().toLowerCase();
  if (!s || s === 'unclassified') return null;
  if (/\bbuyer\b/.test(s)) return 'buy';
  if (/\bseller\b/.test(s)) return 'sell';
  return null;
}

function coerceListIntent(conversation, profile, leadMatch) {
  const isPlaceholder = (v) => {
    const s = String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    return !s || ['unspecified', 'unknown', 'n/a', 'na', 'none'].includes(s);
  };

  const fromLt = intentFromLeadType(leadMatch?.lead_type);
  if (fromLt) return fromLt;

  const convIntent = conversation?.intent;
  const profileIntent = profile?.intent;

  if (!isPlaceholder(convIntent)) return String(convIntent).trim();
  if (!isPlaceholder(profileIntent)) return String(profileIntent).trim();

  const primary = String(profile?.intent_summary?.primary_intent || '')
    .trim()
    .toLowerCase();
  if (primary === 'buy' || primary === 'sell') return primary;

  const fromClass = intentFromClassification(conversation?.lead_classification);
  if (fromClass) return fromClass;

  return null;
}

function coerceListLeadCategory(conversation, leadMatch) {
  const raw =
    conversation?.lead_classification != null ? String(conversation.lead_classification).trim() : '';
  const lower = raw.toLowerCase();
  if (raw && lower !== 'unclassified') return raw;

  const lt = String(leadMatch?.lead_type || '')
    .trim()
    .toLowerCase();
  if (!lt || lt === 'unknown') return null;
  return lt
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildListLeadSummary(sourceRoleRaw, profile, conversation, leadMatch) {
  const role = String(sourceRoleRaw || profile?.ownership?.professional_type || 'agent')
    .trim()
    .toLowerCase();

  let scoreRaw = profile?.scoring?.current_score;
  if (leadMatch?.match_score !== undefined && leadMatch?.match_score !== null && leadMatch?.match_score !== '') {
    scoreRaw = leadMatch.match_score;
  }
  if (scoreRaw === undefined || scoreRaw === null || scoreRaw === '') {
    scoreRaw = conversation?.lead_score;
  }

  let leadScore =
    scoreRaw !== undefined && scoreRaw !== null && scoreRaw !== '' ? Number(scoreRaw) : null;
  if (Number.isNaN(leadScore)) leadScore = null;

  const grade = profile?.scoring?.current_grade || conversation?.lead_grade || null;
  const leadCategory = coerceListLeadCategory(conversation, leadMatch);

  const base = {
    source_role: role,
    lead_score: leadScore,
    lead_grade: grade || null,
    lead_category: leadCategory,
    intent: null,
    property_type: null,
    lawyer: null,
    mortgage: null,
  };

  if (role === 'lawyer') {
    base.intent = coerceListIntent(conversation, profile, leadMatch);
    const lq = profile?.qualification?.lawyer || {};
    base.lawyer = {
      transaction_stage: lq.transaction_stage || '',
      closing_timeline: lq.closing_timeline || '',
      transaction_type: lq.transaction_type || '',
      legal_services_needed: lq.legal_services_needed || '',
    };
  } else if (role === 'mortgage_broker') {
    const mq = profile?.qualification?.mortgage_broker || {};
    base.mortgage = {
      mortgage_timeline: mq.mortgage_timeline || '',
      pre_approval_status: mq.pre_approval_status || '',
    };
    base.intent = coerceListIntent(conversation, profile, leadMatch);
  } else {
    base.intent = coerceListIntent(conversation, profile, leadMatch);
    base.property_type = profile?.property?.property_type || '';
  }

  return base;
}

function referrerUserIdStr(r) {
  const uid = r?.user_id?._id || r?.user_id;
  return uid != null ? String(uid) : '';
}

/** Batch-fetch referrer leads: match by LeadMatch._id or conversation_id (legacy surrogate ids). */
function buildReferrerLeadMatchOrConditions(list) {
  const or = [];
  const seen = new Set();
  for (const r of list) {
    const uidRaw = referrerUserIdStr(r);
    if (!mongoose.Types.ObjectId.isValid(uidRaw)) continue;
    const userOid = new mongoose.Types.ObjectId(uidRaw);
    const idCandidates = [];
    if (r?.lead_match_id) idCandidates.push(String(r.lead_match_id));
    if (r?.conversation_id) idCandidates.push(String(r.conversation_id));
    for (const idRaw of idCandidates) {
      if (!mongoose.Types.ObjectId.isValid(idRaw)) continue;
      const oid = new mongoose.Types.ObjectId(idRaw);
      const byIdKey = `${uidRaw}:_id:${idRaw}`;
      const byConvKey = `${uidRaw}:conv:${idRaw}`;
      if (!seen.has(byIdKey)) {
        seen.add(byIdKey);
        or.push({ user_id: userOid, _id: oid });
      }
      if (!seen.has(byConvKey)) {
        seen.add(byConvKey);
        or.push({ user_id: userOid, conversation_id: oid });
      }
    }
  }
  return or;
}

function buildLeadMatchConvKeyByUser(matches) {
  const convKeyByUser = new Map();
  for (const m of matches) {
    const uid = String(m.user_id?._id || m.user_id || '');
    const convId = m.conversation_id ? String(m.conversation_id) : '';
    if (uid && convId) convKeyByUser.set(`${uid}:${convId}`, m);
  }
  return convKeyByUser;
}

/** Referrer LeadMatch for list rows (lead_match_id; legacy conversation_id / surrogate ids). */
function resolveReferrerLeadMatchForList(r, matchById, convKeyByUser = new Map()) {
  const uid = referrerUserIdStr(r);
  if (!uid) return null;
  const leadMatchIdRaw = r.lead_match_id ? String(r.lead_match_id) : '';
  if (leadMatchIdRaw && mongoose.Types.ObjectId.isValid(leadMatchIdRaw)) {
    const byLeadId = matchById.get(leadMatchIdRaw);
    if (byLeadId && String(byLeadId.user_id?._id || byLeadId.user_id) === uid) return byLeadId;
    const byConv = convKeyByUser.get(`${uid}:${leadMatchIdRaw}`);
    if (byConv) return byConv;
  }
  const legacyCid = r.conversation_id ? String(r.conversation_id) : '';
  if (legacyCid && mongoose.Types.ObjectId.isValid(legacyCid)) {
    const byConvLegacy = convKeyByUser.get(`${uid}:${legacyCid}`);
    if (byConvLegacy) return byConvLegacy;
    const legacy = matchById.get(legacyCid);
    if (legacy && String(legacy.user_id?._id || legacy.user_id) === uid) return legacy;
  }
  return null;
}

function leadContactFromProfileAndConversation(profile, conversation, leadMatch) {
  let full_name = String(profile?.identity?.full_name || '').trim();
  let email = String(profile?.identity?.canonical_email || profile?.identity?.email || '').trim();
  let phone = profile?.identity?.phone ? String(profile.identity.phone).trim() : '';

  const fd =
    conversation?.form_data && typeof conversation.form_data === 'object'
      ? conversation.form_data
      : null;
  if (fd) {
    if (!full_name) full_name = String(fd.full_name || fd.name || '').trim();
    if (!email) email = String(fd.email || '').trim();
    if (!phone) phone = String(fd.phone || fd.phone_number || fd.mobile || '').trim();
  }

  const cf =
    leadMatch?.compatibility_factors && typeof leadMatch.compatibility_factors === 'object'
      ? leadMatch.compatibility_factors
      : null;
  if (cf) {
    if (!full_name) full_name = String(cf.contact_name || cf.full_name || '').trim();
    if (!email) email = String(cf.contact_email || cf.email || '').trim();
    if (!phone) phone = String(cf.contact_phone || cf.phone || '').trim();
  }

  return {
    full_name: full_name || null,
    email: email || null,
    phone: phone || null,
  };
}

/** Viewer’s LeadMatch doc from batch map (inbound = target row, outbound = referrer row). */
function viewerLeadMatchFromMap(r, viewerStr, matchById, targetByReferralId, convKeyByUser = new Map()) {
  if (!viewerStr) return null;
  const targetId = String(r.target_user_id?._id || r.target_user_id || '');
  const sourceId = String(r.user_id?._id || r.user_id || '');
  if (viewerStr === targetId) {
    return targetByReferralId.get(String(r._id)) || null;
  }
  if (viewerStr === sourceId) {
    return resolveReferrerLeadMatchForList(r, matchById, convKeyByUser);
  }
  return null;
}

function normalizedMatchStatus(leanDoc) {
  const raw = leanDoc?.match_status;
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw).trim().toLowerCase();
}

function hasUpcomingPipelineBooking(leadMatch, nowMs = Date.now()) {
  if (!leadMatch || typeof leadMatch !== 'object') return false;
  const status = String(leadMatch?.match_status || '')
    .trim()
    .toLowerCase();
  if (status !== 'consult_booked' && status !== 'showing_booked') return false;
  const startRaw = leadMatch?.compatibility_factors?.calendly?.calendly_event_start;
  if (!startRaw) return false;
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return false;
  return start.getTime() >= nowMs;
}

/**
 * Enrich referral rows for list UIs: batch-load LeadMatch (referrer + recipient rows), profile, and conversation.
 * @param {object[]} list — referral lean docs
 * @param {import('mongoose').Types.ObjectId|string} [viewerUserId] — current user; adds `viewer_match_status` from their LeadMatch
 */
export async function mapReferralsListToApiItems(list, viewerUserId) {
  if (!Array.isArray(list) || list.length === 0) return [];

  const referralIds = list.map((r) => String(r._id)).filter(Boolean);
  const referrerLeadOr = buildReferrerLeadMatchOrConditions(list);

  const matchOr = [...referrerLeadOr];
  if (referralIds.length > 0) {
    matchOr.push({ 'compatibility_factors.referral_id': { $in: referralIds } });
  }

  const matches =
    matchOr.length > 0
      ? await LeadMatch.find({ $or: matchOr })
          .select(
            'user_id conversation_id lead_profile_id match_score match_status compatibility_factors lead_type updatedAt',
          )
          .lean()
      : [];

  const matchById = new Map(matches.map((m) => [String(m._id), m]));
  const convKeyByUser = buildLeadMatchConvKeyByUser(matches);
  const targetByReferralId = new Map();
  for (const m of matches) {
    const rid = String(m?.compatibility_factors?.referral_id || '').trim();
    if (rid) targetByReferralId.set(rid, m);
  }

  const profileIds = [...new Set(matches.map((m) => m.lead_profile_id).filter(Boolean))];
  const profiles =
    profileIds.length > 0
      ? await LeadProfile.find({ _id: { $in: profileIds } })
          .select('intent intent_summary identity property qualification lifecycle scoring ownership')
          .lean()
      : [];
  const profileById = new Map(profiles.map((p) => [String(p._id), p]));

  const convIds = [
    ...new Set(matches.map((m) => m.conversation_id).filter(Boolean).map(String)),
  ];
  const conversations =
    convIds.length > 0
      ? await ChatConversation.find({ _id: { $in: convIds } })
          .select(
            'intent lead_score lead_grade lead_classification is_qualified emotional_state form_data calendly_booking_status',
          )
          .lean()
      : [];
  const convById = new Map(conversations.map((c) => [String(c._id), c]));

  const profileIdsForConsult = [
    ...new Set(
      matches
        .map((m) => (m?.lead_profile_id ? String(m.lead_profile_id) : ''))
        .filter(Boolean),
    ),
  ];
  const nurtureBookedByProfile =
    profileIdsForConsult.length > 0
      ? await buildNurtureConsultationBookedFromEmailByProfileIds(viewerUserId, profileIdsForConsult)
      : new Map();

  const viewerStr =
    viewerUserId != null && mongoose.Types.ObjectId.isValid(String(viewerUserId))
      ? String(viewerUserId)
      : '';

  const viewerLeadMatchIds = viewerStr
    ? [
        ...new Set(
          list
            .map((r) => viewerLeadMatchFromMap(r, viewerStr, matchById, targetByReferralId, convKeyByUser))
            .filter(Boolean)
            .map((m) => String(m._id))
            .filter(Boolean),
        ),
      ]
    : [];
  const viewerConversationIds = viewerStr
    ? [
        ...new Set(
          list
            .map((r) => {
              const lm = viewerLeadMatchFromMap(r, viewerStr, matchById, targetByReferralId, convKeyByUser);
              return lm?.conversation_id ? String(lm.conversation_id) : '';
            })
            .filter(Boolean),
        ),
      ]
    : [];
  const now = new Date();
  const workspaceBookedRows =
    viewerStr && (viewerLeadMatchIds.length > 0 || viewerConversationIds.length > 0)
      ? await WorkspaceAppointment.find({
          user_id: viewerUserId,
          status: 'booked',
          $or: [
            ...(viewerLeadMatchIds.length > 0 ? [{ lead_match_id: { $in: viewerLeadMatchIds } }] : []),
            ...(viewerConversationIds.length > 0
              ? [{ conversation_id: { $in: viewerConversationIds } }]
              : []),
          ],
        })
          .select('lead_match_id conversation_id scheduled_start')
          .lean()
      : [];
  const workspaceUpcomingRows = workspaceBookedRows.filter((r) => {
    const d = r?.scheduled_start ? new Date(r.scheduled_start) : null;
    return d && !Number.isNaN(d.getTime()) && d.getTime() >= now.getTime();
  });
  const workspaceBookedLeadIds = new Set(
    workspaceUpcomingRows
      .map((r) => (r?.lead_match_id ? String(r.lead_match_id) : ''))
      .filter(Boolean),
  );
  const workspaceBookedConversationIds = new Set(
    workspaceUpcomingRows
      .map((r) => (r?.conversation_id ? String(r.conversation_id) : ''))
      .filter(Boolean),
  );

  const items = [];
  for (const r of list) {
    const base = serializeReferral(r);
    if (!base) continue;

    const referrerUser = r.user_id;
    const uid = referrerUser?._id || referrerUser;
    const targetUid = r.target_user_id?._id || r.target_user_id;
    const lm = resolveReferrerLeadMatchForList(r, matchById, convKeyByUser);
    const targetLm =
      viewerStr && String(targetUid) === viewerStr
        ? targetByReferralId.get(String(r._id)) || null
        : null;
    const viewerLm = viewerStr
      ? viewerLeadMatchFromMap(r, viewerStr, matchById, targetByReferralId, convKeyByUser) || targetLm
      : null;
    const viewer_match_status = normalizedMatchStatus(viewerLm);
    const viewer_match_updated_at = viewerLm?.updatedAt || null;
    const target_match_status = normalizedMatchStatus(targetLm);
    const target_match_updated_at = targetLm?.updatedAt || null;
    const viewer_has_upcoming_pipeline_booking = hasUpcomingPipelineBooking(viewerLm);
    const target_has_upcoming_pipeline_booking = hasUpcomingPipelineBooking(targetLm);

    const profile = lm?.lead_profile_id ? profileById.get(String(lm.lead_profile_id)) : null;
    const conversationConvId = lm?.conversation_id ? String(lm.conversation_id) : '';
    const conversation = conversationConvId ? convById.get(conversationConvId) : null;
    const viewerProfileId = viewerLm?.lead_profile_id
      ? String(viewerLm.lead_profile_id)
      : lm?.lead_profile_id
        ? String(lm.lead_profile_id)
        : '';
    /**
     * Referrals can share a conversation thread across users; `calendly_booking_status` on that
     * thread may reflect the referrer's booking state. For list-row consult status we must use the
     * viewer/referred user's own signals only.
     */
    let appointment_status = resolveAppointmentStatus(
      viewerLm?.match_status,
      null,
      viewerLm?.compatibility_factors?.calendly?.calendly_event_start || null
    );
    const viewerLeadMatchId = viewerLm?._id ? String(viewerLm._id) : '';
    const conversationId = conversationConvId;
    if (
      appointment_status !== 'booked' &&
      (workspaceBookedLeadIds.has(viewerLeadMatchId) || workspaceBookedConversationIds.has(conversationId))
    ) {
      appointment_status = 'booked';
    }
    const nurture_consultation_booked = viewerProfileId
      ? Boolean(nurtureBookedByProfile.get(viewerProfileId))
      : false;

    const sourceRoleRaw = String(
      profile?.ownership?.professional_type ||
        (referrerUser && typeof referrerUser === 'object' ? referrerUser.role : '') ||
        'agent'
    ).trim();

    const lead_contact = leadContactFromProfileAndConversation(profile, conversation, lm);

    const lead_summary = buildListLeadSummary(sourceRoleRaw, profile, conversation, lm);

    if (lm?._id) {
      const resolvedLmId = String(lm._id);
      if (!base.lead_match_id || base.lead_match_id !== resolvedLmId) {
        base.lead_match_id = resolvedLmId;
        Referral.updateOne({ _id: r._id }, { $set: { lead_match_id: lm._id } }).catch((err) =>
          logger.warn('referral lead_match_id backfill failed', { referral_id: String(r._id), error: err?.message }),
        );
      }
    }

    items.push({
      ...base,
      lead_contact,
      lead_summary,
      appointment_status,
      nurture_consultation_booked,
      viewer_match_status,
      viewer_match_updated_at,
      target_match_status,
      target_match_updated_at,
      viewer_has_upcoming_pipeline_booking,
      target_has_upcoming_pipeline_booking,
    });
  }

  return items;
}

/**
 * Build GET /referrals/:id/lead JSON body (caller handles HTTP status).
 * Uses the *viewer's* LeadMatch id when the viewer is the referral target so PATCH /leads/:id
 * (same account) succeeds; the snapshot still comes from the referrer's match + shared profile.
 */
export async function buildReferralLeadDetailsResponse(referralLean, viewerUserId, viewerRoleRaw) {
  const referral = referralLean;

  const sourceLeadMatch = await resolveSourceLeadForReferral({
    userId: referral.user_id,
    leadMatchIdRaw: referral.lead_match_id || referral.conversation_id,
    conversationIdRaw: '',
  });

  /** Recipient's row (created on accept). Required for target's pipeline PATCH/note APIs. */
  const refStatus = String(referral.status || '').trim().toLowerCase();
  const isTargetViewer =
    viewerUserId != null &&
    referral.target_user_id != null &&
    String(referral.target_user_id) === String(viewerUserId);

  let targetViewerLeadMatch = null;
  if (isTargetViewer && mongoose.Types.ObjectId.isValid(String(viewerUserId))) {
    const vOid = new mongoose.Types.ObjectId(String(viewerUserId));
    targetViewerLeadMatch = await LeadMatch.findOne({
      user_id: vOid,
      'compatibility_factors.referral_id': String(referral._id),
    })
      .sort({ updatedAt: -1 })
      .lean();
    // Self-heal: create recipient LeadMatch when they open an accepted inbound referral.
    if (!targetViewerLeadMatch && refStatus === 'accepted') {
      const ensured = await ensureTargetLeadMatchForReferral(referral);
      if (ensured.ok && ensured.lead_match) {
        targetViewerLeadMatch = ensured.lead_match;
      }
    }
  }

  // Never expose the referrer's LeadMatch id to the target — PATCH /leads/:id would 404 for them.
  const resolvedLeadMatchId = targetViewerLeadMatch
    ? String(targetViewerLeadMatch._id)
    : isTargetViewer
      ? ''
      : sourceLeadMatch
        ? String(sourceLeadMatch._id)
        : '';

  const conversationOid =
    sourceLeadMatch?.conversation_id && mongoose.Types.ObjectId.isValid(String(sourceLeadMatch.conversation_id))
      ? sourceLeadMatch.conversation_id
      : null;
  const conversation = conversationOid
    ? await ChatConversation.findById(conversationOid)
        .select('intent lead_score lead_grade lead_classification is_qualified emotional_state form_data')
        .lean()
    : null;

  const leadProfile = sourceLeadMatch?.lead_profile_id
    ? await LeadProfile.findById(sourceLeadMatch.lead_profile_id)
        .select(
          'identity property qualification lifecycle intent_summary scoring ownership contact_preferences'
        )
        .lean()
    : null;

  const sourceUser = await User.findById(referral.user_id)
    .select('role first_name last_name full_name email profile_image')
    .lean();
  const targetUser = await User.findById(referral.target_user_id)
    .select('role first_name last_name full_name email profile_image')
    .lean();

  const viewerRole = String(viewerRoleRaw || '').trim().toLowerCase();
  const sourceRole = String(
    leadProfile?.ownership?.professional_type || sourceUser?.role || 'agent'
  )
    .trim()
    .toLowerCase();
  const actionRole = PROFESSIONAL_TYPE_VALUES.includes(viewerRole) ? viewerRole : sourceRole;

  const roleAdjustedLeadMatch = sourceLeadMatch
    ? {
        ...sourceLeadMatch,
        compatibility_factors: {
          ...(sourceLeadMatch.compatibility_factors || {}),
          professional_type: actionRole || sourceRole || 'agent',
        },
      }
    : null;

  const mappedLead = roleAdjustedLeadMatch
    ? mapLeadMatchToDetail(
        roleAdjustedLeadMatch,
        leadProfile || {},
        conversation || {},
        { includeIntentField: true }
      )
    : null;

  if (mappedLead) {
    const displayProfType = displayProfessionalTypeFromRole(sourceRole);
    const convIntent = conversation?.intent != null ? String(conversation.intent).trim() : '';

    if (leadProfile) {
      const profileDisplay = mapLeadProfileForApi(leadProfile, displayProfType);
      const preferredEmail = String(
        leadProfile?.identity?.canonical_email || leadProfile?.identity?.email || profileDisplay?.contact?.email || '',
      ).trim();
      if (mappedLead?.contact && preferredEmail) {
        mappedLead.contact = {
          ...mappedLead.contact,
          email: preferredEmail,
        };
      }
      const pi =
        profileDisplay.intent != null && String(profileDisplay.intent).trim() !== ''
          ? profileDisplay.intent
          : null;
      mappedLead.intent = pi || convIntent || mappedLead.intent || null;
      mappedLead.property = profileDisplay.property;
      mappedLead.qualification = profileDisplay.qualification;
    } else if (convIntent) {
      mappedLead.intent = mappedLead.intent || convIntent;
    }

    if (conversation && Object.prototype.hasOwnProperty.call(conversation, 'is_qualified')) {
      mappedLead.is_qualified = conversation.is_qualified;
    }
  }

  const leadPayload = mappedLead
    ? {
        ...mappedLead,
        id: resolvedLeadMatchId || String(mappedLead.id || sourceLeadMatch?._id || ''),
        lead_match_id: resolvedLeadMatchId || String(mappedLead.id || sourceLeadMatch?._id || ''),
        lead_profile_id: sourceLeadMatch?.lead_profile_id ? String(sourceLeadMatch.lead_profile_id) : null,
        source_lead_match: sourceLeadMatch || null,
      }
    : null;

  return {
    referral: serializeReferral(referral),
    lead: leadPayload,
    context: {
      source_professional: userPreview(sourceUser),
      target_professional: userPreview(targetUser),
      source_role: sourceRole || sourceUser?.role || null,
      target_role: targetUser?.role || null,
      action_role: actionRole || null,
    },
  };
}

/**
 * Ensures the referral target has a LeadMatch for this conversation (idempotent).
 * Needed when referral was marked accepted via PATCH only — POST /process was never called.
 * @param {object} referral — Referral doc or lean with user_id, target_user_id, conversation_id, _id
 * @returns {{ ok: true, lead_match: object } | { ok: false, code: number, message: string }}
 */
export async function ensureTargetLeadMatchForReferral(referral) {
  const uid = referral.target_user_id?._id || referral.target_user_id;
  if (!uid) {
    return { ok: false, code: 400, message: 'Referral has no target user' };
  }

  let targetLeadMatch = await LeadMatch.findOne({
    user_id: uid,
    'compatibility_factors.referral_id': String(referral._id),
  }).lean();

  if (targetLeadMatch) {
    return { ok: true, lead_match: targetLeadMatch };
  }

  const sourceLeadMatch = await resolveSourceLeadForReferral({
    userId: referral.user_id,
    leadMatchIdRaw: referral.lead_match_id || referral.conversation_id,
    conversationIdRaw: '',
  });
  if (!sourceLeadMatch) {
    return { ok: false, code: 404, message: 'Source lead was not found for this referral' };
  }

  const targetPro = await ProfessionalProfile.findOne({ user_id: uid }).select('_id').lean();
  const targetUser = await User.findById(uid).select('_id').lean();
  if (targetUser) {
    try {
      const subscription = await getOrCreateSubscriptionForUser(targetUser);
      await assertWithinPlanQuota({
        userId: targetUser._id,
        subscription,
        limitKey: 'captured_leads',
      });
    } catch (err) {
      if (err instanceof PlanQuotaError) {
        const payload = await handleWorkspacePlanQuotaError(targetUser._id, err);
        return { ok: false, code: 403, message: payload?.message || err.message, planLimit: payload };
      }
      throw err;
    }
  }
  const created = await LeadMatch.create({
    user_id: uid,
    professional_profile_id: targetPro?._id || null,
    lead_type: sourceLeadMatch.lead_type || 'unknown',
    lead_profile_id: sourceLeadMatch.lead_profile_id || null,
    conversation_id: sourceLeadMatch.conversation_id,
    match_score: sourceLeadMatch.match_score ?? 0,
    match_status: 'new',
    compatibility_factors: {
      ...(sourceLeadMatch.compatibility_factors || {}),
      referral_source_user_id: String(referral.user_id),
      referral_id: String(referral._id),
      referred_at: new Date().toISOString(),
    },
    icp_fit: sourceLeadMatch.icp_fit || undefined,
    contact_count: sourceLeadMatch.contact_count || 0,
    first_contact_at: sourceLeadMatch.first_contact_at || null,
    last_contact_at: sourceLeadMatch.last_contact_at || null,
  });

  const lean = await LeadMatch.findById(created._id).lean();
  return { ok: true, lead_match: lean || created.toObject?.() || created };
}

/**
 * Ensure recipient has a LeadMatch and mark referral accepted. Mutates `referral` document.
 */
export async function processReferralForTarget(referral, targetUserId) {
  const uid = targetUserId;

  const ensure = await ensureTargetLeadMatchForReferral(referral);
  if (!ensure.ok) {
    return { ok: false, code: ensure.code || 500, message: ensure.message };
  }
  const targetLeadMatch = ensure.lead_match;

  const statusBeforeAccept = String(referral.status || '').trim().toLowerCase();
  referral.status = 'accepted';
  await referral.save();

  try {
    if (statusBeforeAccept !== 'accepted') {
      const targetUser = await User.findById(uid).select('first_name last_name full_name').lean();
      await notifyReferralAccepted(referral, targetUser || { _id: uid });
      awardReferralPoints({
        user_id: referral.user_id,
        event_type: 'referral_accepted',
        points_delta: REFERRAL_REWARD_POINTS.referral_accepted,
        idempotency_key: `referral:accepted:${String(referral._id)}`,
        source_model: 'Referral',
        source_id: String(referral._id),
        metadata: { accepted_by_user_id: String(uid) },
      }).catch((e) => logger.warn('referral_accepted reward failed', { error: e?.message }));
    }
  } catch (e) {
    logger.warn('notifyReferralAccepted (process) failed', { error: e?.message });
  }

  return {
    ok: true,
    referral: serializeReferral(referral),
    lead_match_id: String(targetLeadMatch._id),
  };
}

/**
 * Create a referral from the referrer's linked conversation.
 * @returns {{ ok: true, referral: object } | { ok: false, code: number, message: string, existing_referral_id?: string, duplicate?: boolean }}
 */
export async function createReferralForUser(referrerUserId, body) {
  const userId = referrerUserId;
  const { target_user_id, lead_match_id, target_vertical, status, notes } = body || {};

  if (!mongoose.Types.ObjectId.isValid(String(lead_match_id || ''))) {
    return { ok: false, code: 400, message: 'lead_match_id is required' };
  }

  const sourceLeadMatch = await resolveSourceLeadForReferral({
    userId,
    leadMatchIdRaw: lead_match_id,
    conversationIdRaw: '',
  });

  if (!sourceLeadMatch) {
    return {
      ok: false,
      code: 403,
      message: 'This lead is not linked to your account.',
    };
  }
  const sourceLeadMatchOid = new mongoose.Types.ObjectId(String(sourceLeadMatch._id));

  if (!mongoose.Types.ObjectId.isValid(target_user_id)) {
    return { ok: false, code: 400, message: 'Invalid target_user_id' };
  }
  const targetOid = new mongoose.Types.ObjectId(target_user_id);
  if (targetOid.equals(userId)) {
    return { ok: false, code: 400, message: 'Cannot refer to yourself.' };
  }

  const targetUser = await User.findById(targetOid).select('_id').lean();
  if (!targetUser) {
    return { ok: false, code: 404, message: 'Target professional not found.' };
  }

  const vertical = String(target_vertical || '').trim();
  if (!vertical) {
    return { ok: false, code: 400, message: 'target_vertical is required' };
  }

  let nextStatus = 'pending';
  if (status != null && String(status).trim() !== '') {
    if (!REFERRAL_STATUSES.includes(status)) {
      return {
        ok: false,
        code: 400,
        message: `status must be one of: ${REFERRAL_STATUSES.join(', ')}`,
      };
    }
    nextStatus = status;
  }

  if (['pending', 'accepted'].includes(nextStatus)) {
    const inflight = await Referral.findOne({
      user_id: userId,
      lead_match_id: sourceLeadMatchOid,
      target_user_id: targetOid,
      status: { $in: ['pending', 'accepted'] },
    })
      .select('_id')
      .lean();
    if (inflight) {
      return {
        ok: false,
        code: 409,
        message: 'This lead is already referred to this professional with an active status.',
        existing_referral_id: String(inflight._id),
      };
    }
  }

  try {
    const referral = await Referral.create({
      user_id: userId,
      target_user_id: targetOid,
      lead_match_id: sourceLeadMatchOid,
      target_vertical: vertical,
      status: nextStatus,
      notes: notes != null ? String(notes) : '',
    });
    const created = await Referral.findById(referral._id)
      .populate('user_id', 'first_name last_name full_name email role profile_image')
      .populate('target_user_id', 'first_name last_name full_name email role profile_image');

    if (created) {
      notifyReferralReceived(created).catch((e) =>
        logger.warn('notifyReferralReceived failed', { error: e?.message }),
      );
      recordLeadKpiEvent({
        user_id: created.user_id?._id || created.user_id,
        lead_match_id: created.lead_match_id || null,
        conversation_id: sourceLeadMatch?.conversation_id || null,
        event_type: 'referral_created',
        metadata: { referral_id: String(created._id) },
      }).catch(() => {});

      awardReferralPoints({
        user_id: created.user_id?._id || created.user_id,
        event_type: 'referral_created',
        points_delta: REFERRAL_REWARD_POINTS.referral_created,
        idempotency_key: `referral:created:${String(created._id)}`,
        source_model: 'Referral',
        source_id: String(created._id),
        metadata: {
          lead_match_id: String(created.lead_match_id || ''),
          target_user_id: String(created.target_user_id?._id || created.target_user_id || ''),
        },
      }).catch((e) => logger.warn('referral_created reward failed', { error: e?.message }));

      const sourceRole = String(created.user_id?.role || '').trim().toLowerCase();
      const targetRole = String(created.target_user_id?.role || '').trim().toLowerCase();
      if (
        sourceRole &&
        targetRole &&
        sourceRole !== targetRole &&
        PROFESSIONAL_TYPE_VALUES.includes(sourceRole) &&
        PROFESSIONAL_TYPE_VALUES.includes(targetRole)
      ) {
        awardReferralPoints({
          user_id: created.user_id?._id || created.user_id,
          event_type: 'referral_cross_role_bonus',
          points_delta: REFERRAL_REWARD_POINTS.referral_cross_role_bonus,
          idempotency_key: `referral:cross-role:${String(created._id)}`,
          source_model: 'Referral',
          source_id: String(created._id),
          metadata: { source_role: sourceRole, target_role: targetRole },
        }).catch((e) => logger.warn('referral_cross_role_bonus reward failed', { error: e?.message }));
      }
    }

    return { ok: true, referral: serializeReferral(created || referral) };
  } catch (err) {
    if (err?.code === 11000) {
      return {
        ok: false,
        code: 409,
        message: 'This lead is already referred to this professional with an active status.',
        duplicate: true,
      };
    }
    throw err;
  }
}

/**
 * @returns {{ ok: true, referral: object } | { ok: false, code: number, message: string }}
 */
export async function patchReferralForUser(userId, referralId, { status, notes }) {
  if (!mongoose.Types.ObjectId.isValid(referralId)) {
    return { ok: false, code: 400, message: 'Invalid referral id' };
  }

  const referral = await Referral.findById(referralId);
  if (!referral) {
    return { ok: false, code: 404, message: 'Referral not found' };
  }

  const isReferrer = referral.user_id.equals(userId);
  const isTarget = referral.target_user_id.equals(userId);
  if (!isReferrer && !isTarget) {
    return { ok: false, code: 403, message: 'Not allowed to update this referral' };
  }

  const prevStatus = String(referral.status || '').trim();

  let touched = false;
  if (status !== undefined && status !== null && String(status).trim() !== '') {
    if (!REFERRAL_STATUSES.includes(status)) {
      return {
        ok: false,
        code: 400,
        message: `status must be one of: ${REFERRAL_STATUSES.join(', ')}`,
      };
    }
    referral.status = status;
    touched = true;
  }
  if (notes !== undefined) {
    referral.notes = notes != null ? String(notes) : '';
    touched = true;
  }
  if (!touched) {
    return { ok: false, code: 400, message: 'Provide status and/or notes to update' };
  }

  await referral.save();

  const newStatus =
    status !== undefined && status !== null && String(status).trim() !== ''
      ? String(status).trim()
      : '';
  const statusChanged = Boolean(newStatus) && newStatus !== prevStatus;

  // POST /process creates this row; PATCH accept alone did not — fix so PATCH /leads/:id works for target.
  if (statusChanged && newStatus === 'accepted' && isTarget) {
    try {
      const ens = await ensureTargetLeadMatchForReferral(referral);
      if (!ens.ok) {
        logger.warn('ensureTargetLeadMatchForReferral after PATCH accept', { message: ens.message });
      }
    } catch (e) {
      logger.warn('ensureTargetLeadMatchForReferral after PATCH accept threw', { error: e?.message });
    }
  }

  const updated = await Referral.findById(referral._id)
    .populate('user_id', 'first_name last_name full_name email role profile_image')
    .populate('target_user_id', 'first_name last_name full_name email role profile_image');

  try {
    if (statusChanged) {
      const actor = await User.findById(userId).select('first_name last_name full_name').lean();
      const doc = updated || referral;
      if (newStatus === 'accepted' && isTarget) {
        await notifyReferralAccepted(doc, actor || { _id: userId });
        const referrerId = doc.user_id?._id || doc.user_id;
        const targetId = doc.target_user_id?._id || doc.target_user_id;
        awardReferralPoints({
          user_id: referrerId,
          event_type: 'referral_accepted',
          points_delta: REFERRAL_REWARD_POINTS.referral_accepted,
          idempotency_key: `referral:accepted:${String(doc._id)}`,
          source_model: 'Referral',
          source_id: String(doc._id),
          metadata: { accepted_by_user_id: String(userId) },
        }).catch((e) => logger.warn('referral_accepted reward failed', { error: e?.message }));
        awardReferralPoints({
          user_id: referrerId,
          event_type: 'collaboration_success',
          points_delta: REWARD_RULES.collaboration_success,
          idempotency_key: `referral:collab:referrer:${String(doc._id)}`,
          source_model: 'Referral',
          source_id: String(doc._id),
        }).catch(() => {});
        if (targetId) {
          awardReferralPoints({
            user_id: targetId,
            event_type: 'collaboration_success',
            points_delta: REWARD_RULES.collaboration_success,
            idempotency_key: `referral:collab:target:${String(doc._id)}`,
            source_model: 'Referral',
            source_id: String(doc._id),
          }).catch(() => {});
        }
      } else if (newStatus === 'completed') {
        const referrerId = doc.user_id?._id || doc.user_id;
        const targetId = doc.target_user_id?._id || doc.target_user_id;
        awardReferralPoints({
          user_id: referrerId,
          event_type: 'referral_transaction_complete',
          points_delta: REWARD_RULES.referral_transaction_complete,
          idempotency_key: `referral:txn_complete:referrer:${String(doc._id)}`,
          source_model: 'Referral',
          source_id: String(doc._id),
        }).catch(() => {});
        if (targetId) {
          awardReferralPoints({
            user_id: targetId,
            event_type: 'referral_transaction_complete',
            points_delta: REWARD_RULES.referral_transaction_complete,
            idempotency_key: `referral:txn_complete:target:${String(doc._id)}`,
            source_model: 'Referral',
            source_id: String(doc._id),
          }).catch(() => {});
        }
        if (doc.lead_match_id) {
          const collabCount = await Referral.countDocuments({
            lead_match_id: doc.lead_match_id,
            status: { $in: ['accepted', 'completed'] },
          });
          if (collabCount >= 2) {
            const bonusEach = Math.floor(REWARD_RULES.multi_pro_deal_bonus / Math.max(collabCount, 2));
            const participants = [referrerId, targetId].filter(Boolean);
            for (const pid of participants) {
              awardReferralPoints({
                user_id: pid,
                event_type: 'multi_pro_deal_bonus',
                points_delta: bonusEach,
                idempotency_key: `referral:multi_pro:${String(doc.lead_match_id)}:${String(pid)}`,
                source_model: 'Referral',
                source_id: String(doc._id),
                metadata: { collaborators: collabCount },
              }).catch(() => {});
            }
          }
        }
      } else if (newStatus === 'rejected') {
        await notifyReferralRejected(doc, userId, actor || { _id: userId });
      }
    }
  } catch (e) {
    logger.warn('Referral PATCH status notify failed', { error: e?.message });
  }

  return { ok: true, referral: serializeReferral(updated || referral) };
}
