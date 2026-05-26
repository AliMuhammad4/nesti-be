import crypto from 'crypto';
import mongoose from 'mongoose';
import logger from '../../utils/logger.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import LeadAttribution from '../../models/LeadAttribution.js';
import ChatMessage from '../../models/ChatMessage.js';
import WorkspaceAppointment from '../../models/WorkspaceAppointment.js';
import { buildLeadConversionPack } from '../conversion/buildLeadConversionPack.js';
import { getBuyerPropertyMatches, getBuyerMatchesForSellerProperty } from '../agent/propertyMatch/matchService.js';
import { parsePageLimitPagination, buildPaginationMeta, PAGINATION_PRESETS } from '../../utils/pagination.js';
import { truthyQueryFlag } from './leadQueryUtils.js';
import { mapLeadMatchToListRow, mapLeadMatchToDetail, mapLeadMatchUnderProfile } from './leadResponseMappers.js';
import { buildCollectionEmptyState } from './leadExperienceContract.js';
import { formatLeadProfileSummary } from './leadProfileFormat.js';
import { buildAppointmentMongoFilter, buildAppointmentStatusByProfileIds } from './leadAppointmentStatus.js';
import { buildNurtureConsultationBookedFromEmailByProfileIds } from './leadNurtureBookingStatus.js';
import { recordLeadViewIfNeeded, recordLeadKpiEvent } from '../analytics/leadKpiService.js';
import {
  awardReferralPoints,
  REWARD_RULES,
} from '../referral/rewardService.js';
import { awardInviterMilestoneForUser } from '../referral/inviteService.js';
import { emitWorkspaceLeadEvent } from '../realtime/workspaceSocket.js';
import { AGENT_NOTES_MAX_ENTRIES, isTerminalMatchStatus } from '../../utils/leadMatchStatus.js';
import { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
import {
  recomputeLeadProfileLifecycle,
  syncLeadAttributionForMatchStatus,
} from './leadMatchFollowUpSync.js';
import {
  ownerQuery,
  skipAppointmentStatusFromQuery,
  buildProfileEmptyState,
  fetchProfilesForIcpTier,
  fetchProfilesDefault,
  enrichAndFormatProfiles,
  ICP_TIERS,
} from './leadProfileHelpers.js';
import { PROFESSIONAL_TYPE, USER_ROLE } from '../../constants/roles.js';
import { mapLeadProfileForApi } from './leadProfileFormat.js';

const INQUIRED_PROPERTY_LEAD_MATCH_FIELDS =
  '_id lead_profile_id conversation_id match_score match_status compatibility_factors lead_type createdAt updatedAt';
const INQUIRED_PROPERTY_PROFILE_FIELDS =
  'intent identity contact_preferences property qualification ownership createdAt updatedAt';
const INQUIRED_PROPERTY_CONVERSATION_FIELDS =
  '_id calendly_booking_status calendly_event_start session_id';

/** Lead rows where WorkspaceAppointment exists as booked (Calendly) but ChatConversation was not synced. */
async function leadMatchIdsWithBookedWorkspaceAppointment(userId, leadMatchObjectIds) {
  const ids = (leadMatchObjectIds || []).filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
  if (!ids.length) return new Set();
  const now = new Date();
  const rows = await WorkspaceAppointment.find({
    user_id: userId,
    lead_match_id: { $in: ids },
    status: 'booked',
    scheduled_start: { $gte: now },
  })
    .select('lead_match_id')
    .lean();
  return new Set(rows.map((r) => String(r.lead_match_id)));
}

/** Booked Calendly rows keyed by chat thread (covers orphan upserts where lead_match_id was null initially). */
async function conversationIdsWithBookedWorkspaceAppointment(userId, conversationObjectIds) {
  const ids = (conversationObjectIds || []).filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
  if (!ids.length) return new Set();
  const now = new Date();
  const rows = await WorkspaceAppointment.find({
    user_id: userId,
    status: 'booked',
    conversation_id: { $in: ids },
    scheduled_start: { $gte: now },
  })
    .select('conversation_id')
    .lean();
  return new Set(rows.map((r) => (r.conversation_id ? String(r.conversation_id) : '')).filter(Boolean));
}

async function workspaceBookingStartsByLeadAndConversation(userId, leadMatchObjectIds, conversationObjectIds) {
  const leadIds = (leadMatchObjectIds || []).filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
  const convoIds = (conversationObjectIds || []).filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
  if (!leadIds.length && !convoIds.length) {
    return { startByLeadId: new Map(), startByConversationId: new Map() };
  }
  const now = new Date();
  const rows = await WorkspaceAppointment.find({
    user_id: userId,
    status: 'booked',
    scheduled_start: { $gte: now },
    $or: [
      ...(leadIds.length ? [{ lead_match_id: { $in: leadIds } }] : []),
      ...(convoIds.length ? [{ conversation_id: { $in: convoIds } }] : []),
    ],
  })
    .select('lead_match_id conversation_id scheduled_start')
    .sort({ scheduled_start: 1, recorded_at: -1 })
    .lean();

  const startByLeadId = new Map();
  const startByConversationId = new Map();
  for (const row of rows) {
    const start = row?.scheduled_start ? new Date(row.scheduled_start) : null;
    if (!start || Number.isNaN(start.getTime())) continue;
    if (row?.lead_match_id) {
      const k = String(row.lead_match_id);
      if (!startByLeadId.has(k)) startByLeadId.set(k, start.toISOString());
    }
    if (row?.conversation_id) {
      const k = String(row.conversation_id);
      if (!startByConversationId.has(k)) startByConversationId.set(k, start.toISOString());
    }
  }
  return { startByLeadId, startByConversationId };
}

function mergeConvoWithWorkspaceBooking(
  conversation,
  leadMatchId,
  leadConversationId,
  bookedLeadIdSet,
  bookedConversationIdSet,
  startByLeadId = new Map(),
  startByConversationId = new Map(),
) {
  const c = conversation && typeof conversation === 'object' ? conversation : {};
  const convoKey = c._id ? String(c._id) : leadConversationId ? String(leadConversationId) : null;
  const leadKey = leadMatchId ? String(leadMatchId) : null;
  const leadBooked = leadKey && bookedLeadIdSet.has(leadKey);
  const convoBooked = convoKey && bookedConversationIdSet.has(convoKey);
  const startsAt =
    (leadKey ? startByLeadId.get(leadKey) : null) ||
    (convoKey ? startByConversationId.get(convoKey) : null) ||
    null;
  const next = { ...c };
  if ((leadBooked || convoBooked) && !c.calendly_booking_status) {
    next.calendly_booking_status = 'booked';
  }
  if (startsAt && !next.calendly_event_start) {
    next.calendly_event_start = startsAt;
  }
  return next;
}

function mapLeadMatchToInquiredPropertySellerLead(leadMatch, profile, convo, opts = {}) {
  const profType =
    leadMatch?.compatibility_factors?.professional_type ||
    profile?.ownership?.professional_type ||
    PROFESSIONAL_TYPE.AGENT;
  const profileView = mapLeadProfileForApi(profile, profType);
  const includeIntentField = opts.includeIntentField !== false;
  const appointmentDate =
    leadMatch?.compatibility_factors?.calendly?.calendly_event_start ||
    convo?.calendly_event_start ||
    null;
  const lead = {
    id: String(leadMatch._id),
    professional_type: profType,
    lead_type: leadMatch.lead_type,
    grade: leadMatch.lead_type?.split('_')[0] || null,
    score: leadMatch.match_score,
    status: leadMatch.match_status,
    contact: profileView.contact,
    property: profileView.property,
    qualification: profileView.qualification,
    appointment_status: resolveAppointmentStatus(
      leadMatch.match_status,
      convo?.calendly_booking_status,
      appointmentDate,
    ),
    calendly_booking_status: convo?.calendly_booking_status || null,
    conversation_id: String(leadMatch.conversation_id || ''),
    source: leadMatch?.compatibility_factors?.source || null,
    created_at: leadMatch.createdAt,
    updated_at: leadMatch.updatedAt,
  };
  if (includeIntentField) lead.intent = profileView.intent;
  return lead;
}

function extractInquiredPropertyContext(leadMatch) {
  const cf = leadMatch?.compatibility_factors || {};
  const inquiredProperty =
    cf.inquired_property && typeof cf.inquired_property === 'object'
      ? cf.inquired_property
      : null;
  const linkedSellerLeadMatchId = String(cf.linked_seller_lead_match_id || '').trim();
  return { inquiredProperty, linkedSellerLeadMatchId };
}

async function fetchInquiredPropertySellerLead({ userId, linkedSellerLeadMatchId, mapperOpts }) {
  if (!linkedSellerLeadMatchId || !mongoose.Types.ObjectId.isValid(linkedSellerLeadMatchId)) return null;
  const sellerMatch = await LeadMatch.findOne({ _id: linkedSellerLeadMatchId, user_id: userId })
    .select(INQUIRED_PROPERTY_LEAD_MATCH_FIELDS)
    .lean();
  if (!sellerMatch) return null;

  const [profile, convo] = await Promise.all([
    sellerMatch.lead_profile_id
      ? LeadProfile.findById(sellerMatch.lead_profile_id).select(INQUIRED_PROPERTY_PROFILE_FIELDS).lean()
      : null,
    sellerMatch.conversation_id
      ? ChatConversation.findById(sellerMatch.conversation_id).select(INQUIRED_PROPERTY_CONVERSATION_FIELDS).lean()
      : null,
  ]);

  return mapLeadMatchToInquiredPropertySellerLead(sellerMatch, profile, convo || {}, mapperOpts);
}

/** Buyer/seller `intent` is only for agent dashboards; omit for other roles. */
function leadMapperOptsFromRequest(req) {
  const includeIntentField = req.user?.role === USER_ROLE.AGENT;
  return { includeIntentField };
}

/** Attach profile-level nurture consultation flag (NurtureLog meeting_booked) to lead detail payloads. */
async function enrichLeadDetailWithProfileConsultation(userId, profile, leadDetail) {
  if (!profile?._id || !leadDetail) return leadDetail;
  const nurtureMap = await buildNurtureConsultationBookedFromEmailByProfileIds(userId, [profile._id]);
  const appointmentBooked = String(leadDetail.appointment_status || '').toLowerCase() === 'booked';
  return {
    ...leadDetail,
    nurture_consultation_booked: appointmentBooked && Boolean(nurtureMap.get(String(profile._id))),
  };
}

// ─── Lead match controllers ───────────────────────────────────────────────────

/**
 * LeadMatch rows created for the *recipient* when they accept a referral set
 * `compatibility_factors.referral_id`. Those should not show in GET /leads (own pipeline);
 * the lead remains managed under Referrals.
 */
function excludeAcceptedReferralRecipientMatchesFilter() {
  return {
    $or: [
      { 'compatibility_factors.referral_id': { $exists: false } },
      { 'compatibility_factors.referral_id': null },
    ],
  };
}

async function resolveLeadPropertyMatchCount({ userId, leadMatch, leadProfile }) {
  try {
    if (!leadMatch || !leadProfile) return 0;
    const prof =
      leadProfile?.ownership?.professional_type ||
      leadMatch?.compatibility_factors?.professional_type ||
      PROFESSIONAL_TYPE.AGENT;
    if (prof !== PROFESSIONAL_TYPE.AGENT) return 0;
    const isBuyer = /buy/i.test(leadProfile.intent || leadMatch.lead_type || '');
    const matches = isBuyer
      ? await getBuyerPropertyMatches({ userId, leadProfile, signals: {} })
      : await getBuyerMatchesForSellerProperty({ userId, leadProfile, signals: {} });
    return Array.isArray(matches) ? matches.length : 0;
  } catch {
    return 0;
  }
}

export const recordLeadView = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }
    const leadMatch = await LeadMatch.findOne({ _id: req.params.id, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });
    const result = await recordLeadViewIfNeeded({
      user_id: userId,
      lead_match_id: leadMatch._id,
      conversation_id: leadMatch.conversation_id || null,
      grade: leadMatch.lead_type?.split('_')[0] || null,
      metadata: { match_status: leadMatch.match_status },
    });
    return res.json({ success: true, ...result });
  } catch (err) { return next(err); }
};

export const getLeads = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const userRole = req.user?.role;
    const includePropertyMatchCounts =
      userRole === USER_ROLE.AGENT || userRole === USER_ROLE.ADMIN;
    const q = req.query || {};
    const { page, limit, skip } = parsePageLimitPagination(q, PAGINATION_PRESETS.leadList);
    const { embedToken, intent, grade, status, appointment, pipeline } = q;

    const match = { user_id: userId };
    const pipelineNorm = String(pipeline || '').trim().toLowerCase();
    if (status) {
      match.match_status = status;
    } else if (pipelineNorm === 'active') {
      match.match_status = { $nin: ['converted', 'closed_lost'] };
    } else if (pipelineNorm === 'closed') {
      match.match_status = { $in: ['converted', 'closed_lost'] };
    } else if (pipelineNorm === 'referrals') {
      /** UI uses GET /referrals?status=accepted; guard getLeads if this param is sent. */
      match._id = { $in: [] };
    }
    if (grade)     match.lead_type = new RegExp(`^${grade}_`);
    if (intent === 'buy' || intent === 'sell')
      match.lead_type = new RegExp(`${intent === 'sell' ? 'seller' : '(buyer|client)'}$`);
    if (embedToken) match['compatibility_factors.embed_token'] = embedToken;

    const apptFilter = await buildAppointmentMongoFilter(userId, appointment);
    /** Recipient LeadMatch rows created when a referral is accepted are tagged with `compatibility_factors.referral_id`; they must not appear in the main Leads list (only under Referrals / pipeline referral UI). */
    const hideReferralRecipientLeads = excludeAcceptedReferralRecipientMatchesFilter();
    const query = apptFilter
      ? { $and: [match, apptFilter, hideReferralRecipientLeads] }
      : { $and: [match, hideReferralRecipientLeads] };

    const [total, leadMatches] = await Promise.all([
      LeadMatch.countDocuments(query),
      LeadMatch.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    if (!total) return res.json({ success: true, leads: [], empty_state: buildCollectionEmptyState('leads'), pagination: buildPaginationMeta({ page, limit, total: 0 }) });

    const profileIds = leadMatches.map((m) => m.lead_profile_id).filter(Boolean);
    const convoIds   = leadMatches.map((m) => m.conversation_id).filter(Boolean);
    const [profiles, conversations] = await Promise.all([
      LeadProfile.find({ _id: { $in: profileIds } }).lean(),
      ChatConversation.find({ _id: { $in: convoIds } }).lean(),
    ]);
    const profileById = new Map(profiles.map((p) => [String(p._id), p]));
    const convoById   = new Map(conversations.map((c) => [String(c._id), c]));

    const uniqueProfileKeys = [...new Set(profileIds.map((id) => String(id)))];
    const nurtureBookedByProfile =
      uniqueProfileKeys.length > 0
        ? await buildNurtureConsultationBookedFromEmailByProfileIds(userId, uniqueProfileKeys)
        : new Map();

    const workspaceBookedLeadIds = await leadMatchIdsWithBookedWorkspaceAppointment(
      userId,
      leadMatches.map((m) => m._id),
    );
    const workspaceBookedConversationIds = await conversationIdsWithBookedWorkspaceAppointment(
      userId,
      convoIds,
    );
    const { startByLeadId, startByConversationId } = await workspaceBookingStartsByLeadAndConversation(
      userId,
      leadMatches.map((m) => m._id),
      convoIds,
    );

    const leads = await Promise.all(
      leadMatches.map(async (m) => {
        const profile = profileById.get(String(m.lead_profile_id)) || null;
        const rawConvo = convoById.get(String(m.conversation_id)) || {};
        const conversation = mergeConvoWithWorkspaceBooking(
          rawConvo,
          m._id,
          m.conversation_id,
          workspaceBookedLeadIds,
          workspaceBookedConversationIds,
          startByLeadId,
          startByConversationId,
        );
        const row = mapLeadMatchToListRow(
          m,
          profile || {},
          conversation,
          truthyQueryFlag(q.include_conversion),
          leadMapperOptsFromRequest(req),
        );
        const matchCount = includePropertyMatchCounts
          ? await resolveLeadPropertyMatchCount({
              userId,
              leadMatch: m,
              leadProfile: profile,
            })
          : 0;
        const pid = m.lead_profile_id ? String(m.lead_profile_id) : '';
        const rowAppointmentBooked = String(row.appointment_status || '').toLowerCase() === 'booked';
        const nurture_consultation_booked =
          rowAppointmentBooked && pid ? nurtureBookedByProfile.get(pid) ?? false : false;
        return { ...row, match_count: matchCount, nurture_consultation_booked };
      }),
    );
    return res.json({ success: true, leads, empty_state: null, pagination: buildPaginationMeta({ page, limit, total }) });
  } catch (err) { return next(err); }
};

function assertMatchStatusTransition(prevStatus, nextStatus) {
  if (prevStatus === nextStatus) return;
  if (isTerminalMatchStatus(prevStatus)) {
    if (isTerminalMatchStatus(nextStatus)) return;
    if (nextStatus !== 'nurturing' && nextStatus !== 'new') {
      const err = new Error('Closed leads can only be reopened to Nurturing or New');
      err.statusCode = 400;
      throw err;
    }
  }
}

const ROLE_CLOSE_REASONS = {
  agent: {
    converted: new Set(['deal_closed', 'buyer_found_match', 'seller_accepted_offer', 'other']),
    closed_lost: new Set(['went_with_another_agent', 'changed_mind', 'not_ready', 'unresponsive', 'other']),
  },
  lawyer: {
    converted: new Set(['matter_retained', 'case_completed', 'other']),
    closed_lost: new Set(['went_elsewhere', 'declined_service', 'matter_withdrawn', 'other']),
  },
  mortgage_broker: {
    converted: new Set(['loan_funded', 'pre_approval_secured', 'other']),
    closed_lost: new Set(['went_with_another_lender', 'application_denied', 'not_qualified', 'other']),
  },
};

function leadProfessionalType(lead, professionalTypeOverride = '') {
  const override = String(professionalTypeOverride || '')
    .trim()
    .toLowerCase();
  if (override === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (override === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  if (override === PROFESSIONAL_TYPE.AGENT) return PROFESSIONAL_TYPE.AGENT;
  const raw = String(
    lead?.compatibility_factors?.professional_type ||
      lead?.professional_type ||
      '',
  )
    .trim()
    .toLowerCase();
  if (raw === PROFESSIONAL_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  if (raw === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  return PROFESSIONAL_TYPE.AGENT;
}

function validateCloseReasonForLead({ lead, nextStatus, closeReason, professionalTypeOverride = '' }) {
  if (!isTerminalMatchStatus(nextStatus)) return null;
  const reason = String(closeReason || '').trim();
  if (!reason) return 'close_reason is required when closing a lead';
  const role = leadProfessionalType(lead, professionalTypeOverride);
  const allowed =
    ROLE_CLOSE_REASONS[role]?.[nextStatus] ||
    ROLE_CLOSE_REASONS[PROFESSIONAL_TYPE.AGENT][nextStatus];
  if (!allowed || !allowed.has(reason)) {
    return `Invalid close_reason '${reason}' for ${role.replace('_', ' ')} lead`;
  }
  return null;
}

function isReferralRecipientLead(lead) {
  const factors =
    lead?.compatibility_factors && typeof lead.compatibility_factors === 'object'
      ? lead.compatibility_factors
      : {};
  return Boolean(
    String(factors.referral_id || '').trim() ||
      String(factors.referral_source_user_id || '').trim(),
  );
}

export const updateLeadMatch = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }
    const { match_status: nextStatus, note } = req.body;
    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    const hasNote = trimmedNote.length > 0;
    const hasStatus = nextStatus !== undefined;
    if (!hasStatus && !hasNote) {
      return res.status(400).json({ success: false, message: 'Provide match_status and/or a non-empty note' });
    }

    const lead = await LeadMatch.findOne({ _id: req.params.id, user_id: userId });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const prevStatus = lead.match_status;
    if (hasStatus) assertMatchStatusTransition(prevStatus, nextStatus);
    if (hasStatus && nextStatus !== prevStatus && isReferralRecipientLead(lead)) {
      const closeValidationError = validateCloseReasonForLead({
        lead,
        nextStatus,
        closeReason: req.body?.close_reason,
        professionalTypeOverride: req.user?.role,
      });
      if (closeValidationError) {
        return res.status(400).json({ success: false, message: closeValidationError });
      }
    }

    const statusChanged = hasStatus && nextStatus !== prevStatus;
    const authorLabel =
      [req.user.first_name, req.user.last_name].filter(Boolean).join(' ').trim() || null;
    const authorUserIdStr = userId != null ? String(userId) : null;
    const now = new Date().toISOString();
    const notesToPush = [];

    if (statusChanged && !hasNote) {
      const readable = (s) => ({ new: 'New', nurturing: 'Nurturing', converted: 'Closed — won', closed_lost: 'Closed — lost', consult_booked: 'Consult booked', showing_booked: 'Showing booked' }[s] || s);
      notesToPush.push({
        id: crypto.randomUUID(),
        text: `Status changed from ${readable(prevStatus)} to ${readable(nextStatus)}`,
        created_at: now,
        author_user_id: authorUserIdStr,
        author_label: authorLabel,
        system: true,
      });
    }

    if (hasNote) {
      notesToPush.push({
        id: crypto.randomUUID(),
        text: trimmedNote.slice(0, 8000),
        created_at: now,
        author_user_id: authorUserIdStr,
        author_label: authorLabel,
      });
    }

    const mongoUpdate = {};
    if (statusChanged) mongoUpdate.$set = { match_status: nextStatus };

    const wasTerminal = isTerminalMatchStatus(prevStatus);
    if (statusChanged && isTerminalMatchStatus(nextStatus)) {
      const closeSummary = {
        status: nextStatus,
        reason: req.body.close_reason || null,
        note: req.body.close_note || null,
        value: req.body.closed_value ?? null,
        closed_at: now,
        closed_by_user_id: authorUserIdStr,
        closed_by_label: authorLabel,
      };
      mongoUpdate.$set = {
        ...mongoUpdate.$set,
        'compatibility_factors.close_summary': closeSummary,
      };
    } else if (statusChanged && wasTerminal && !isTerminalMatchStatus(nextStatus)) {
      mongoUpdate.$set = {
        ...mongoUpdate.$set,
        'compatibility_factors.close_summary.reopened_at': now,
      };
    }

    if (notesToPush.length) {
      mongoUpdate.$push = {
        'compatibility_factors.agent_notes': {
          $each: notesToPush,
          $slice: -AGENT_NOTES_MAX_ENTRIES,
        },
      };
    }

    const dirty = Object.keys(mongoUpdate).length > 0;
    if (dirty) {
      let updatedOk = false;
      try {
        const result = await LeadMatch.updateOne({ _id: lead._id, user_id: userId }, mongoUpdate);
        if (result.matchedCount === 0) {
          return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        updatedOk = true;
      } catch (mongoErr) {
        logger.warn('LeadMatch updateOne failed; falling back to document save', {
          leadId: String(lead._id),
          error: mongoErr.message,
        });
        try {
          if (statusChanged) lead.match_status = nextStatus;
          if (notesToPush.length) {
            const factors =
              lead.compatibility_factors && typeof lead.compatibility_factors === 'object'
                ? { ...lead.compatibility_factors }
                : {};
            const existing = Array.isArray(factors.agent_notes) ? [...factors.agent_notes] : [];
            for (const n of notesToPush) existing.push(n);
            factors.agent_notes = existing.slice(-AGENT_NOTES_MAX_ENTRIES);
            lead.compatibility_factors = factors;
            lead.markModified('compatibility_factors');
          }
          await lead.save();
          updatedOk = true;
        } catch (saveErr) {
          logger.error('LeadMatch save fallback failed', { leadId: String(lead._id), error: saveErr.message });
          throw saveErr;
        }
      }

      if (updatedOk && statusChanged) {
        try {
          await syncLeadAttributionForMatchStatus(lead, nextStatus);
          if (lead.lead_profile_id) {
            await recomputeLeadProfileLifecycle(userId, lead.lead_profile_id);
          }
        } catch (syncErr) {
          logger.warn('Lead follow-up sync failed (attribution/lifecycle); lead update kept', {
            leadId: String(lead._id),
            error: syncErr.message,
          });
        }
        if (nextStatus === 'converted' && prevStatus !== 'converted') {
          recordLeadKpiEvent({
            user_id: userId,
            lead_match_id: lead._id,
            conversation_id: lead.conversation_id || null,
            event_type: 'lead_updated',
            metadata: { match_status: 'converted', deal_closed: true },
          }).catch(() => {});
          awardReferralPoints({
            user_id: userId,
            event_type: 'deal_closed',
            points_delta: REWARD_RULES.deal_closed,
            idempotency_key: `lead:deal_closed:${String(lead._id)}`,
            source_model: 'LeadMatch',
            source_id: String(lead._id),
          }).catch((e) => logger.warn('deal_closed reward failed', { error: e?.message }));
          awardInviterMilestoneForUser(userId, 'pro_first_deal', String(lead._id)).catch(() => {});
        }
        if (nextStatus === 'nurturing' && prevStatus === 'new') {
          awardReferralPoints({
            user_id: userId,
            event_type: 'lead_active_client',
            points_delta: REWARD_RULES.lead_active_client,
            idempotency_key: `lead:active_client:${String(lead._id)}`,
            source_model: 'LeadMatch',
            source_id: String(lead._id),
          }).catch((e) => logger.warn('lead_active_client reward failed', { error: e?.message }));
        }
      }
      emitWorkspaceLeadEvent(userId, {
        kind: 'lead_updated',
        lead_match_id: String(lead._id),
        match_status: statusChanged ? nextStatus : prevStatus,
      });
    }

    const leadMatch = await LeadMatch.findOne({ _id: lead._id, user_id: userId }).lean();
    if (!leadMatch) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const [profile, convo, workspaceBookedIds, workspaceBookedConvIds, workspaceStartMaps] = await Promise.all([
      leadMatch.lead_profile_id ? LeadProfile.findById(leadMatch.lead_profile_id).lean() : null,
      leadMatch.conversation_id ? ChatConversation.findById(leadMatch.conversation_id).lean() : null,
      leadMatchIdsWithBookedWorkspaceAppointment(userId, [leadMatch._id]),
      leadMatch.conversation_id
        ? conversationIdsWithBookedWorkspaceAppointment(userId, [leadMatch.conversation_id])
        : Promise.resolve(new Set()),
      workspaceBookingStartsByLeadAndConversation(
        userId,
        [leadMatch._id],
        leadMatch.conversation_id ? [leadMatch.conversation_id] : [],
      ),
    ]);
    const mergedConvo = mergeConvoWithWorkspaceBooking(
      convo || {},
      leadMatch._id,
      leadMatch.conversation_id,
      workspaceBookedIds,
      workspaceBookedConvIds,
      workspaceStartMaps.startByLeadId,
      workspaceStartMaps.startByConversationId,
    );
    const leadDetail = mapLeadMatchToDetail(
      leadMatch,
      profile,
      mergedConvo,
      leadMapperOptsFromRequest(req),
    );
    const leadPayload = await enrichLeadDetailWithProfileConsultation(userId, profile, leadDetail);
    return res.json({
      success: true,
      conversation_id: leadMatch.conversation_id ? String(leadMatch.conversation_id) : null,
      lead: leadPayload,
    });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return next(err);
  }
};

export const getLeadById = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }
    const leadMatch = await LeadMatch.findOne({ _id: req.params.id, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });
    const [profile, convo, workspaceBookedIds, workspaceBookedConvIds, workspaceStartMaps] = await Promise.all([
      leadMatch.lead_profile_id ? LeadProfile.findById(leadMatch.lead_profile_id).lean() : null,
      leadMatch.conversation_id ? ChatConversation.findById(leadMatch.conversation_id).lean() : null,
      leadMatchIdsWithBookedWorkspaceAppointment(userId, [leadMatch._id]),
      leadMatch.conversation_id
        ? conversationIdsWithBookedWorkspaceAppointment(userId, [leadMatch.conversation_id])
        : Promise.resolve(new Set()),
      workspaceBookingStartsByLeadAndConversation(
        userId,
        [leadMatch._id],
        leadMatch.conversation_id ? [leadMatch.conversation_id] : [],
      ),
    ]);
    const mergedConvo = mergeConvoWithWorkspaceBooking(
      convo || {},
      leadMatch._id,
      leadMatch.conversation_id,
      workspaceBookedIds,
      workspaceBookedConvIds,
      workspaceStartMaps.startByLeadId,
      workspaceStartMaps.startByConversationId,
    );
    const leadDetail = mapLeadMatchToDetail(
      leadMatch,
      profile,
      mergedConvo,
      leadMapperOptsFromRequest(req),
    );
    const lead = await enrichLeadDetailWithProfileConsultation(userId, profile, leadDetail);
    return res.json({
      success: true,
      conversation_id: leadMatch.conversation_id ? String(leadMatch.conversation_id) : null,
      lead,
    });
  } catch (err) { return next(err); }
};

export const getLeadInquiredProperty = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }

    const leadMatch = await LeadMatch.findOne({ _id: req.params.id, user_id: userId })
      .select('compatibility_factors')
      .lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });

    const { inquiredProperty, linkedSellerLeadMatchId } = extractInquiredPropertyContext(leadMatch);

    if (!inquiredProperty && !linkedSellerLeadMatchId) {
      return res.json({
        success: true,
        inquired_property: null,
        linked_seller_lead_match_id: null,
        seller_lead: null,
      });
    }

    const sellerLead = await fetchInquiredPropertySellerLead({
      userId,
      linkedSellerLeadMatchId,
      mapperOpts: leadMapperOptsFromRequest(req),
    });

    return res.json({
      success: true,
      inquired_property: inquiredProperty,
      linked_seller_lead_match_id: linkedSellerLeadMatchId || null,
      seller_lead: sellerLead,
    });
  } catch (err) { return next(err); }
};

export const getLeadConversation = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }
    const { page, limit, skip } = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.leadList);
    const leadMatch = await LeadMatch.findOne({ _id: req.params.id, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });

    if (!leadMatch.conversation_id) {
      return res.json({ success: true, lead_id: req.params.id, conversation_id: null, messages: [], empty_state: { reason: 'No conversation thread exists for this lead yet.', action: 'Start outreach from the lead card and message history will appear here.' }, pagination: buildPaginationMeta({ page, limit, total: 0 }) });
    }

    const convFilter = { conversation_id: leadMatch.conversation_id };
    const [convoExists, total, messages] = await Promise.all([
      ChatConversation.exists({ _id: leadMatch.conversation_id }),
      ChatMessage.countDocuments(convFilter),
      ChatMessage.find(convFilter).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
    ]);
    const conversationMessages = messages.map((m) => ({ id: String(m._id), role: m.role, content: m.content, intent: m.intent || null, created_at: m.createdAt }));
    let emptyState = null;
    if (conversationMessages.length === 0) {
      if (!convoExists) {
        emptyState = {
          reason:
            'The chat thread record was removed (for example, the visitor reset the chat before this fix, which deleted the conversation while the lead stayed in CRM). New widget chats create a new thread.',
          action: 'Reference compatibility/session metadata on the lead, or continue outreach from here; transcript cannot be recovered.',
        };
      } else {
        emptyState = {
          reason: 'Conversation thread is created but has no messages yet.',
          action: 'Send the first outreach message to activate this thread.',
        };
      }
    }
    return res.json({
      success: true,
      lead_id: req.params.id,
      conversation_id: String(leadMatch.conversation_id),
      messages: conversationMessages,
      empty_state: emptyState,
      pagination: buildPaginationMeta({ page, limit, total }),
    });
  } catch (err) { return next(err); }
};

export const deleteLeadById = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid lead id' });
    }
    const leadMatch = await LeadMatch.findOne({ _id: req.params.id, user_id: userId });
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });

    const { lead_profile_id: profileId, conversation_id: conversationId, _id: leadMatchId } = leadMatch;
    await LeadMatch.deleteOne({ _id: leadMatchId });

    if (profileId) {
      await LeadProfile.findByIdAndUpdate(profileId, { $pull: { lead_refs: leadMatchId } });
      if (await LeadMatch.countDocuments({ lead_profile_id: profileId }) === 0) {
        await Promise.all([LeadProfile.deleteOne({ _id: profileId }), LeadAttribution.deleteMany({ lead_profile_id: profileId })]);
      }
    }
    if (conversationId) {
      await Promise.all([ChatConversation.deleteOne({ _id: conversationId }), ChatMessage.deleteMany({ conversation_id: conversationId })]);
    }
    return res.json({ success: true, message: 'Lead and related conversation were deleted successfully' });
  } catch (err) { return next(err); }
};

// ─── Lead profile controllers ─────────────────────────────────────────────────

export const getLeadProfileById = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const profile = await LeadProfile.findOne({ _id: req.params.profileId, ...ownerQuery(userId) }).lean();
    if (!profile) return res.status(404).json({ success: false, message: 'Lead profile not found' });

    const [apptMap, nurtureMap] = await Promise.all([
      buildAppointmentStatusByProfileIds(userId, [profile._id]),
      buildNurtureConsultationBookedFromEmailByProfileIds(userId, [profile._id]),
    ]);
    return res.json({
      success: true,
      lead_profile: formatLeadProfileSummary(profile, {
        appointment_status: apptMap.get(String(profile._id)) ?? 'not_booked',
        nurture_consultation_booked: nurtureMap.get(String(profile._id)) ?? false,
      }),
    });
  } catch (err) { return next(err); }
};

export const getLeadProfiles = async (req, res, next) => {
  try {
    const userId = String(req.user._id);
    const userObjectId = req.user._id;
    const q = req.query || {};
    const { page, limit, skip } = parsePageLimitPagination(q, PAGINATION_PRESETS.leadList);
    const icpTier = String(q.icp_tier || '').trim().toLowerCase();
    const skipAppointment = skipAppointmentStatusFromQuery(q);

    if (icpTier && !ICP_TIERS.has(icpTier)) {
      return res.status(400).json({ success: false, message: 'Invalid icp_tier. Use perfect_match, good_match, or low_match' });
    }

    const { total, profiles } = icpTier
      ? await fetchProfilesForIcpTier({ userObjectId, userId, icpTier, skip, limit })
      : await fetchProfilesDefault({ userId, skip, limit });

    if (total === 0) return res.json({ success: true, lead_profiles: [], empty_state: buildProfileEmptyState(icpTier), pagination: buildPaginationMeta({ page, limit, total: 0 }) });

    return res.json({
      success: true,
      lead_profiles: await enrichAndFormatProfiles(profiles, userObjectId, skipAppointment),
      empty_state: null,
      pagination: buildPaginationMeta({ page, limit, total }),
    });
  } catch (err) { return next(err); }
};

export const getLeadsByProfileId = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const { profileId } = req.params;
    const { page, limit, skip } = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.leadList);

    const profile = await LeadProfile.findOne({ _id: profileId, ...ownerQuery(userId) }).lean();
    if (!profile) return res.status(404).json({ success: false, message: 'Lead profile not found' });

    const refLeadIds = Array.isArray(profile.lead_refs)
      ? profile.lead_refs
          .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
          .map((id) => new mongoose.Types.ObjectId(String(id)))
      : [];
    const listMatch = {
      user_id: userId,
      $or: [
        { lead_profile_id: profile._id },
        ...(refLeadIds.length ? [{ _id: { $in: refLeadIds } }] : []),
      ],
    };
    const [total, leadMatches] = await Promise.all([
      LeadMatch.countDocuments(listMatch),
      LeadMatch.find(listMatch).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const convoIds = leadMatches.map((m) => m.conversation_id).filter(Boolean);
    const convoById = new Map((await ChatConversation.find({ _id: { $in: convoIds } }).lean()).map((c) => [String(c._id), c]));
    const workspaceBookedLeadIds = await leadMatchIdsWithBookedWorkspaceAppointment(
      userId,
      leadMatches.map((m) => m._id),
    );
    const workspaceBookedConversationIds = await conversationIdsWithBookedWorkspaceAppointment(
      userId,
      convoIds,
    );
    const { startByLeadId, startByConversationId } = await workspaceBookingStartsByLeadAndConversation(
      userId,
      leadMatches.map((m) => m._id),
      convoIds,
    );
    const leads = leadMatches.map((m) => {
      const raw = convoById.get(String(m.conversation_id)) || {};
      const convo = mergeConvoWithWorkspaceBooking(
        raw,
        m._id,
        m.conversation_id,
        workspaceBookedLeadIds,
        workspaceBookedConversationIds,
        startByLeadId,
        startByConversationId,
      );
      return mapLeadMatchUnderProfile(m, profile, convo, leadMapperOptsFromRequest(req));
    });

    return res.json({ success: true, profile_id: String(profile._id), leads, empty_state: leads.length === 0 ? buildCollectionEmptyState('profile_leads') : null, pagination: buildPaginationMeta({ page, limit, total }) });
  } catch (err) { return next(err); }
};

// ─── Property matches controller ─────────────────────────────────────────────

function professionalSummaryFromUser(user = {}) {
  const first = String(user?.first_name || '').trim();
  const last = String(user?.last_name || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ').trim() || null;
  return {
    id: user?._id ? String(user._id) : null,
    name: fullName,
    email: user?.email || null,
    role: user?.role || null,
    is_verified: user?.is_verified ?? null,
  };
}

function pickMatchedLeadForResponse(ml) {
  if (!ml || typeof ml !== 'object') return null;
  const out = {
    intent: ml.intent ?? null,
    preferred_contact_method: ml.preferred_contact_method ?? null,
    best_time_to_contact: ml.best_time_to_contact ?? null,
    property_location: ml.property_location ?? null,
    property_budget: ml.property_budget ?? null,
    property_timeline: ml.property_timeline ?? null,
    property_type: ml.property_type ?? null,
    bedrooms: ml.bedrooms ?? null,
    bathrooms: ml.bathrooms ?? null,
    mortgage_status: ml.mortgage_status ?? null,
    realtor_status: ml.realtor_status ?? null,
    motivation_reason: ml.motivation_reason ?? null,
    viewing_readiness: ml.viewing_readiness ?? null,
    living_situation: ml.living_situation ?? null,
    urgency_readiness: ml.urgency_readiness ?? null,
  };
  const has = Object.values(out).some((v) => v != null && v !== '');
  return has ? out : null;
}

/** Merge scorer row fields into matched_lead so the API only exposes one shape (no duplicate top-level listing fields). */
function mergeRowIntoMatchedLead(match = {}) {
  const base = match.matched_lead && typeof match.matched_lead === 'object' ? { ...match.matched_lead } : {};
  if (!base.property_location && match.location) base.property_location = match.location;
  if (!base.property_type && match.property_type) base.property_type = match.property_type;
  if ((base.bedrooms == null || base.bedrooms === '') && match.bedrooms != null && match.bedrooms !== '') {
    base.bedrooms = String(match.bedrooms);
  }
  if ((base.bathrooms == null || base.bathrooms === '') && match.bathrooms != null && match.bathrooms !== '') {
    base.bathrooms = String(match.bathrooms);
  }
  if (!base.property_budget) {
    if (match.budget_display) base.property_budget = match.budget_display;
    else if (match.price != null && match.price !== '') base.property_budget = String(match.price);
  }
  if (!base.mortgage_status && match.financing_status_code) base.mortgage_status = match.financing_status_code;
  return pickMatchedLeadForResponse(base);
}

function enrichPropertyMatch(match = {}) {
  const factors = Array.isArray(match?.reasons_for_matching) && match.reasons_for_matching.length
    ? match.reasons_for_matching.filter(Boolean)
    : Array.isArray(match?.match_reasons)
      ? match.match_reasons.filter(Boolean)
      : [];
  const mc = match.matched_contact && typeof match.matched_contact === 'object' ? match.matched_contact : null;
  const mergedLead = mergeRowIntoMatchedLead(match);
  return {
    id: match?.id || null,
    title: match?.title || null,
    match_score: match?.match_score ?? null,
    match_headline: match?.match_headline || null,
    source: match?.source || null,
    reasons_for_matching: factors,
    matched_contact: mc
      ? {
          full_name: mc.full_name || mc.fullName || null,
          email: mc.email || null,
          phone: mc.phone || null,
        }
      : null,
    matched_lead: mergedLead,
    lead_profile_id:
      match?.lead_profile_id ||
      (String(match?.id || '').startsWith('lead:') ? String(match.id).slice(5) : null),
  };
}

export const getLeadPropertyMatches = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const { id: leadMatchId } = req.params;
    const { page, limit, skip } = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.propertyMatches);

    if (!mongoose.Types.ObjectId.isValid(leadMatchId)) return res.status(400).json({ success: false, message: 'Invalid lead id' });

    const leadMatch = await LeadMatch.findOne({ _id: leadMatchId, user_id: userId }).lean();
    if (!leadMatch) return res.status(404).json({ success: false, message: 'Lead not found' });

    if (!leadMatch.lead_profile_id) {
      return res.json({ success: true, property_matches: [], property_matches_context: null, conversion: null, message: 'No lead profile attached to this lead yet.', empty_state: { reason: 'Property matching requires a lead profile.', action: 'Complete lead qualification fields (intent, budget, location, timeline) to enable matches.' } });
    }

    const leadProfile = await LeadProfile.findById(leadMatch.lead_profile_id).lean();
    if (!leadProfile) {
      return res.json({ success: true, property_matches: [], property_matches_context: null, conversion: null, message: 'Lead profile not found.', empty_state: { reason: 'Lead profile data is missing for this lead.', action: 'Re-run qualification or reconnect this lead to a valid profile.' } });
    }

    const prof =
      leadProfile?.ownership?.professional_type ||
      leadMatch?.compatibility_factors?.professional_type ||
      PROFESSIONAL_TYPE.AGENT;

    const conversation = leadMatch.conversation_id
      ? await ChatConversation.findById(leadMatch.conversation_id)
          .select('calendly_booking_status lead_reasons last_interaction_at intent')
          .lean()
      : null;

    let property_matches = [];
    let context = 'buy';
    if (prof === PROFESSIONAL_TYPE.AGENT) {
      const isBuyer = /buy/i.test(leadProfile.intent || leadMatch.lead_type || '');
      context = isBuyer ? 'buy' : 'sell';
      property_matches = isBuyer
        ? await getBuyerPropertyMatches({ userId, leadProfile, signals: {} })
        : await getBuyerMatchesForSellerProperty({ userId, leadProfile, signals: {} });
    }

    const conversion = buildLeadConversionPack({
      leadMatch,
      leadProfile,
      conversation,
      ...(prof === PROFESSIONAL_TYPE.AGENT ? { intent: context } : {}),
    });

    const matchesPaginated = property_matches.slice(skip, skip + limit).map(enrichPropertyMatch);

    return res.json({
      success: true,
      lead_id: String(leadMatch._id),
      user_name: professionalSummaryFromUser(req.user)?.name || null,
      property_matches: matchesPaginated,
      match_count: property_matches.length,
      next_steps: {
        primary_action: {
          id: conversion?.primary_action?.id || null,
          title: conversion?.primary_action?.title || null,
          channel: conversion?.primary_action?.channel || null,
          suggested_first_message:
            conversion?.primary_action?.follow_up_template || null,
        },
        secondary_actions: Array.isArray(conversion?.secondary_actions)
          ? conversion.secondary_actions.map((a) => ({
              id: a?.id || null,
              title: a?.title || null,
              priority: a?.priority || null,
            }))
          : [],
        booking_cta: conversion?.outcome?.booking_cta || null,
      },
      empty_state:
        property_matches.length === 0 && prof === PROFESSIONAL_TYPE.AGENT
          ? buildCollectionEmptyState('property_matches', { intent: context })
          : null,
      pagination: buildPaginationMeta({ page, limit, total: property_matches.length }),
    });
  } catch (err) { return next(err); }
};

export { resolveAppointmentStatus } from '../../utils/resolveAppointmentStatus.js';
