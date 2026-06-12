import mongoose from 'mongoose';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ChatConversation from '../../models/ChatConversation.js';
import ChatMessage from '../../models/ChatMessage.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { formatLeadProfileSummary, mapLeadProfileForApi } from './leadProfileFormat.js';
import { buildProfileConsultationFlags } from './leadProfileSignals.js';
import {
  ICP_TIERS,
  leadMapperOptsFromRequest,
  truthyQueryFlag,
  buildLeadsListMatchFilter,
  excludeAcceptedReferralRecipientMatchesFilter,
  parseProfileIncludeQuery,
} from './leadQueryUtils.js';
import { buildPaginationMeta, PAGINATION_PRESETS, parsePageLimitPagination } from '../../utils/pagination.js';
import { buildCollectionEmptyState } from './leadExperienceContract.js';
import {
  buildAppointmentMongoFilter,
  fetchBookedWorkspaceAppointments,
  LEAD_LIST_CONVERSATION_FIELDS,
  mergeConvoWithWorkspaceBooking,
} from './leadAppointmentStatus.js';
import { mapLeadMatchToDetail, mapLeadMatchToListRow, mapLeadMatchUnderProfile } from './leadResponseMappers.js';
import {
  buildNurtureConsultationBookedFromLeadMatches,
  enrichLeadDetailWithProfileConsultation,
} from './leadNurtureBookingStatus.js';
import { listNurtureLogsForUser } from '../../controllers/nurtureController.js';
import { getOrCreateSubscriptionForUser } from '../billing/subscriptionService.js';
import {
  loadPlanVisibleLeadFilter,
  mergeLeadQueryWithPlanVisibility,
} from '../billing/planQuota.js';

export function ownerQuery(userId) {
  return { $or: [{ 'ownership.user_id': String(userId) }, { owner_user_id: String(userId) }] };
}

export function skipAppointmentStatusFromQuery(q) {
  const v = String(q?.include_appointment_status ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
}

export function buildProfileEmptyState(icpTier) {
  return icpTier
    ? { reason: `No lead profiles match icp_tier=${icpTier}.`, action: 'Try a different ICP tier or review ICP settings to widen matches.' }
    : { reason: 'No lead profiles found yet.', action: 'Capture new leads or remove filters to populate this view.' };
}

export async function fetchProfilesForIcpTier({ userObjectId, userId, icpTier, skip, limit }) {
  const sharedStages = [
    { $match: { user_id: userObjectId, lead_profile_id: { $ne: null }, 'icp_fit.fit_tier': icpTier } },
    { $group: { _id: '$lead_profile_id' } },
    { $match: { _id: { $ne: null } } },
    { $lookup: { from: LeadProfile.collection.collectionName, localField: '_id', foreignField: '_id', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: false } },
    { $match: { $or: [{ 'profile.ownership.user_id': userObjectId }, { 'profile.owner_user_id': userId }, { 'profile.owner_user_id': userObjectId }] } },
  ];

  const [countRows, profiles] = await Promise.all([
    LeadMatch.aggregate([...sharedStages, { $count: 'total' }]),
    LeadMatch.aggregate([...sharedStages, { $replaceRoot: { newRoot: '$profile' } }, { $sort: { updatedAt: -1, createdAt: -1 } }, { $skip: skip }, { $limit: limit }]),
  ]);

  return { total: countRows[0]?.total ?? 0, profiles };
}

export async function fetchProfilesDefault({ userId, skip, limit }) {
  const q = ownerQuery(userId);
  const [total, profiles] = await Promise.all([
    LeadProfile.countDocuments(q),
    LeadProfile.find(q).sort({ updatedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
  ]);
  return { total, profiles };
}

function formatProfileWithConsultationFlags(profile, appointmentMap, nurtureMap, { skipAppointment = false, omitOwnership = false } = {}) {
  return formatLeadProfileSummary(profile, {
    appointment_status: skipAppointment ? 'not_booked' : appointmentMap.get(String(profile._id)) ?? 'not_booked',
    nurture_consultation_booked: nurtureMap.get(String(profile._id)) ?? false,
    ...(omitOwnership ? { omit_ownership: true } : {}),
  });
}

async function enrichProfilesWithConsultationFlags(profiles, userObjectId, { skipAppointment = false, omitOwnership = false } = {}) {
  const { appointmentMap, nurtureMap } = await buildProfileConsultationFlags(
    userObjectId,
    profiles.map((p) => p._id),
    { includeAppointment: !skipAppointment },
  );
  return profiles.map((profile) =>
    formatProfileWithConsultationFlags(profile, appointmentMap, nurtureMap, { skipAppointment, omitOwnership }),
  );
}

export async function enrichAndFormatProfiles(profiles, userObjectId, skipAppointment) {
  return enrichProfilesWithConsultationFlags(profiles, userObjectId, {
    skipAppointment,
    omitOwnership: true,
  });
}

async function loadConversationsAndWorkspaceForMatches(userId, leadMatches) {
  const convoIds = leadMatches.map((m) => m.conversation_id).filter(Boolean);
  const leadMatchIds = leadMatches.map((m) => m._id);
  const [conversations, workspaceBookings] = await Promise.all([
    convoIds.length
      ? ChatConversation.find({ _id: { $in: convoIds } }).select(LEAD_LIST_CONVERSATION_FIELDS).lean()
      : [],
    fetchBookedWorkspaceAppointments(userId, leadMatchIds, convoIds),
  ]);
  return {
    convoById: new Map(conversations.map((c) => [String(c._id), c])),
    workspaceBookings,
  };
}

function mergeLeadMatchConversation(rawConvo, match, workspaceBookings) {
  const {
    bookedLeadIds,
    bookedConvoIds,
    startByLeadId,
    startByConversationId,
  } = workspaceBookings;
  return mergeConvoWithWorkspaceBooking(
    rawConvo,
    match._id,
    match.conversation_id,
    bookedLeadIds,
    bookedConvoIds,
    startByLeadId,
    startByConversationId,
  );
}

export async function findOwnedLeadProfile(userId, profileId) {
  return LeadProfile.findOne({ _id: profileId, ...ownerQuery(userId) }).lean();
}

export async function aggregateLeadMatchesFacet(matchQuery, skip, limit) {
  const facetRows = await LeadMatch.aggregate([
    { $match: matchQuery },
    {
      $facet: {
        total: [{ $count: 'count' }],
        rows: [{ $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit }],
      },
    },
  ]);
  return {
    total: facetRows[0]?.total?.[0]?.count ?? 0,
    rows: facetRows[0]?.rows ?? [],
  };
}

async function mapLeadMatchesToListRows(req, userId, leadMatches, q, mapperOpts) {
  const profileIds = leadMatches.map((m) => m.lead_profile_id).filter(Boolean);
  const uniqueProfileKeys = [...new Set(profileIds.map((id) => String(id)))];
  const [profiles, { convoById, workspaceBookings }, nurtureBookedByProfile] = await Promise.all([
    profileIds.length ? LeadProfile.find({ _id: { $in: profileIds } }).lean() : [],
    loadConversationsAndWorkspaceForMatches(userId, leadMatches),
    uniqueProfileKeys.length > 0
      ? buildNurtureConsultationBookedFromLeadMatches(userId, leadMatches, uniqueProfileKeys)
      : Promise.resolve(new Map()),
  ]);
  const profileById = new Map(profiles.map((p) => [String(p._id), p]));

  return leadMatches.map((m) => {
    const profile = profileById.get(String(m.lead_profile_id)) || null;
    const conversation = mergeLeadMatchConversation(
      convoById.get(String(m.conversation_id)) || {},
      m,
      workspaceBookings,
    );
    const row = mapLeadMatchToListRow(
      m,
      profile || {},
      conversation,
      truthyQueryFlag(q?.include_conversion),
      mapperOpts,
    );
    const pid = m.lead_profile_id ? String(m.lead_profile_id) : '';
    const rowAppointmentBooked = String(row.appointment_status || '').toLowerCase() === 'booked';
    const nurture_consultation_booked =
      rowAppointmentBooked && pid ? nurtureBookedByProfile.get(pid) ?? false : false;
    return { ...row, nurture_consultation_booked };
  });
}

async function applyPlanLeadVisibility(userId, baseQuery) {
  const subscription = await getOrCreateSubscriptionForUser({ _id: userId });
  const visibilityFilter = await loadPlanVisibleLeadFilter(userId, subscription);
  return mergeLeadQueryWithPlanVisibility(baseQuery, visibilityFilter);
}

export async function buildLeadsListPayload(req, userId, q, { page, limit, skip }) {
  const match = buildLeadsListMatchFilter(userId, q);
  const apptFilter = await buildAppointmentMongoFilter(userId, q.appointment);
  const hideReferralRecipientLeads = excludeAcceptedReferralRecipientMatchesFilter();
  const andClauses = [match, hideReferralRecipientLeads];
  if (apptFilter) andClauses.push(apptFilter);

  const query = await applyPlanLeadVisibility(userId, { $and: andClauses });

  const { total, rows: leadMatches } = await aggregateLeadMatchesFacet(query, skip, limit);
  if (!total) {
    return {
      leads: [],
      empty_state: buildCollectionEmptyState('leads'),
      pagination: buildPaginationMeta({ page, limit, total: 0 }),
    };
  }

  const listMapperOpts = { ...leadMapperOptsFromRequest(req), includeExperienceBlocks: false };
  const leads = await mapLeadMatchesToListRows(req, userId, leadMatches, q, listMapperOpts);
  return {
    leads,
    empty_state: null,
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

export async function buildLeadsByProfileIdPayload(req, userId, profileId, pagination) {
  const profile = await findOwnedLeadProfile(userId, profileId);
  if (!profile) {
    const err = new Error('Lead profile not found');
    err.statusCode = 404;
    throw err;
  }
  return buildProfileLeadsPayload(req, userId, profile, pagination);
}

export async function buildProfileLeadsPayload(req, userId, profile, { page, limit, skip }) {
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
  const profileListMatch = await applyPlanLeadVisibility(userId, listMatch);
  const { total, rows: leadMatches } = await aggregateLeadMatchesFacet(profileListMatch, skip, limit);

  const { convoById, workspaceBookings } = await loadConversationsAndWorkspaceForMatches(userId, leadMatches);
  const profType = profile?.ownership?.professional_type || PROFESSIONAL_TYPE.AGENT;
  const profileView = mapLeadProfileForApi(profile, profType);
  const mapperOpts = { ...leadMapperOptsFromRequest(req), profileView, includeExperienceBlocks: false };
  const leads = leadMatches.map((m) => {
    const convo = mergeLeadMatchConversation(
      convoById.get(String(m.conversation_id)) || {},
      m,
      workspaceBookings,
    );
    return mapLeadMatchUnderProfile(m, profile, convo, mapperOpts);
  });

  return {
    profile_id: String(profile._id),
    leads,
    empty_state: leads.length === 0 ? buildCollectionEmptyState('profile_leads') : null,
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

export async function loadLeadDetailForRequest(req, userId, leadMatch) {
  const leadMatchId = leadMatch._id;
  const convoId = leadMatch.conversation_id;
  const [profile, convo, workspaceBookings] = await Promise.all([
    leadMatch.lead_profile_id ? LeadProfile.findById(leadMatch.lead_profile_id).lean() : null,
    convoId ? ChatConversation.findById(convoId).lean() : null,
    fetchBookedWorkspaceAppointments(userId, [leadMatchId], convoId ? [convoId] : []),
  ]);
  const mergedConvo = mergeLeadMatchConversation(convo || {}, leadMatch, workspaceBookings);
  const leadDetail = mapLeadMatchToDetail(
    leadMatch,
    profile,
    mergedConvo,
    leadMapperOptsFromRequest(req),
  );
  return enrichLeadDetailWithProfileConsultation(userId, profile, leadDetail);
}

export async function formatLeadDetailApiResponse(req, userId, leadMatch) {
  const lead = await loadLeadDetailForRequest(req, userId, leadMatch);
  return {
    conversation_id: leadMatch.conversation_id ? String(leadMatch.conversation_id) : null,
    lead,
  };
}

export async function buildLeadProfileDetailPayload(req, userId, profileId, query = {}) {
  const include = parseProfileIncludeQuery(query);
  const profile = await findOwnedLeadProfile(userId, profileId);
  if (!profile) {
    const err = new Error('Lead profile not found');
    err.statusCode = 404;
    throw err;
  }

  const leadsPagination = include.leads
    ? parsePageLimitPagination(query, PAGINATION_PRESETS.leadList)
    : null;
  const nurturePagination = include.nurture_logs
    ? parsePageLimitPagination(query, PAGINATION_PRESETS.leadList)
    : null;

  const [leadProfile, leadsPayload, nurturePayload] = await Promise.all([
    enrichProfilesWithConsultationFlags([profile], userId).then((rows) => rows[0]),
    include.leads
      ? buildProfileLeadsPayload(req, userId, profile, leadsPagination)
      : Promise.resolve(null),
    include.nurture_logs
      ? listNurtureLogsForUser(userId, {
          leadProfileId: profile._id,
          page: nurturePagination.page,
          limit: nurturePagination.limit,
          skip: nurturePagination.skip,
        })
      : Promise.resolve(null),
  ]);

  const response = {
    success: true,
    lead_profile: leadProfile,
  };
  if (leadsPayload) Object.assign(response, leadsPayload);
  if (nurturePayload) response.nurture_logs = nurturePayload;
  return response;
}

export async function buildLeadProfilesListPayload(req) {
  const userId = String(req.user._id);
  const userObjectId = req.user._id;
  const q = req.query || {};
  const { page, limit, skip } = parsePageLimitPagination(q, PAGINATION_PRESETS.leadList);
  const icpTier = String(q.icp_tier || '').trim().toLowerCase();
  const skipAppointment = skipAppointmentStatusFromQuery(q);

  if (icpTier && !ICP_TIERS.has(icpTier)) {
    const err = new Error('Invalid icp_tier. Use perfect_match, good_match, or low_match');
    err.statusCode = 400;
    throw err;
  }

  const { total, profiles } = icpTier
    ? await fetchProfilesForIcpTier({ userObjectId, userId, icpTier, skip, limit })
    : await fetchProfilesDefault({ userId, skip, limit });

  if (total === 0) {
    return {
      lead_profiles: [],
      empty_state: buildProfileEmptyState(icpTier),
      pagination: buildPaginationMeta({ page, limit, total: 0 }),
    };
  }

  return {
    lead_profiles: await enrichAndFormatProfiles(profiles, userObjectId, skipAppointment),
    empty_state: null,
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

export async function buildLeadConversationPayload(leadId, leadMatch, query = {}) {
  if (!leadMatch.conversation_id) {
    return {
      lead_id: leadId,
      conversation_id: null,
      messages: [],
      empty_state: {
        reason: 'No conversation thread exists for this lead yet.',
        action: 'Start outreach from the lead card and message history will appear here.',
      },
      pagination: buildPaginationMeta({ page: 1, limit: 0, total: 0 }),
    };
  }

  const convFilter = { conversation_id: leadMatch.conversation_id };
  const { page, limit, skip } = parsePageLimitPagination(query, PAGINATION_PRESETS.leadConversation);
  const [convoExists, total, messages] = await Promise.all([
    ChatConversation.exists({ _id: leadMatch.conversation_id }),
    ChatMessage.countDocuments(convFilter),
    ChatMessage.find(convFilter).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
  ]);
  const conversationMessages = messages.map((m) => ({
    id: String(m._id),
    role: m.role,
    content: m.content,
    intent: m.intent || null,
    created_at: m.createdAt,
  }));

  let emptyState = null;
  if (conversationMessages.length === 0) {
    emptyState = convoExists
      ? {
          reason: 'Conversation thread is created but has no messages yet.',
          action: 'Send the first outreach message to activate this thread.',
        }
      : {
          reason:
            'The chat thread record was removed (for example, the visitor reset the chat before this fix, which deleted the conversation while the lead stayed in CRM). New widget chats create a new thread.',
          action: 'Reference compatibility/session metadata on the lead, or continue outreach from here; transcript cannot be recovered.',
        };
  }

  return {
    lead_id: leadId,
    conversation_id: String(leadMatch.conversation_id),
    messages: conversationMessages,
    empty_state: emptyState,
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

export { ICP_TIERS, buildPaginationMeta, PAGINATION_PRESETS, parsePageLimitPagination };
