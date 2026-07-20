import { parsePageLimitPagination, PAGINATION_PRESETS } from '../../utils/pagination.js';
import { findOwnedVisibleLeadMatch, handleLeadServiceError } from './leadQueryUtils.js';
import { recordLeadViewIfNeeded } from '../analytics/leadKpiService.js';
import { patchLeadMatchForUser, deleteOwnedLeadMatch } from './leadMatchFollowUpSync.js';
import {
  buildLeadsListPayload,
  buildLeadsByProfileIdPayload,
  buildLeadProfileDetailPayload,
  buildLeadProfilesListPayload,
  buildLeadConversationPayload,
  postClientInquiryDirectConversationMessage,
  formatLeadDetailApiResponse,
} from './leadProfileHelpers.js';
import { buildInquiredPropertyPayload } from './inquiredProperty.js';
import { buildLeadPropertyMatchesPayload } from './leadPropertyMatchHelpers.js';

export const recordLeadView = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const leadMatch = await findOwnedVisibleLeadMatch(userId, req.params.id);
    const result = await recordLeadViewIfNeeded({
      user_id: userId,
      lead_match_id: leadMatch._id,
      conversation_id: leadMatch.conversation_id || null,
      grade: leadMatch.lead_type?.split('_')[0] || null,
      metadata: { match_status: leadMatch.match_status },
    });
    return res.json({ success: true, ...result });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const getLeads = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const pagination = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.leadList);
    const payload = await buildLeadsListPayload(req, userId, req.query || {}, pagination);
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const updateLeadMatch = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const leadMatch = await patchLeadMatchForUser({
      userId,
      user: req.user,
      leadId: req.params.id,
      body: req.body,
    });
    const payload = await formatLeadDetailApiResponse(req, userId, leadMatch);
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const getLeadById = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const leadMatch = await findOwnedVisibleLeadMatch(userId, req.params.id);
    const payload = await formatLeadDetailApiResponse(req, userId, leadMatch);
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const getLeadInquiredProperty = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const leadMatch = await findOwnedVisibleLeadMatch(userId, req.params.id, { select: 'compatibility_factors' });
    const payload = await buildInquiredPropertyPayload(req, leadMatch);
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const getLeadConversation = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const leadMatch = await findOwnedVisibleLeadMatch(userId, req.params.id);
    const payload = await buildLeadConversationPayload(req.params.id, leadMatch, req.query);
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const postLeadConversationMessage = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const leadMatch = await findOwnedVisibleLeadMatch(userId, req.params.id);
    const payload = await postClientInquiryDirectConversationMessage(
      userId,
      req.params.id,
      leadMatch,
      req.body?.body,
    );
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const deleteLeadById = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    await deleteOwnedLeadMatch(userId, req.params.id);
    return res.json({ success: true, message: 'Lead and related conversation were deleted successfully' });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const getLeadProfileById = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const payload = await buildLeadProfileDetailPayload(req, userId, req.params.profileId, req.query || {});
    return res.json(payload);
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const getLeadProfiles = async (req, res, next) => {
  try {
    const payload = await buildLeadProfilesListPayload(req);
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const getLeadsByProfileId = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const pagination = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.leadList);
    const payload = await buildLeadsByProfileIdPayload(req, userId, req.params.profileId, pagination);
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};

export const getLeadPropertyMatches = async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const pagination = parsePageLimitPagination(req.query || {}, PAGINATION_PRESETS.propertyMatches);
    const leadMatch = await findOwnedVisibleLeadMatch(userId, req.params.id);
    const payload = await buildLeadPropertyMatchesPayload({
      user: req.user,
      leadMatch,
      ...pagination,
    });
    return res.json({ success: true, ...payload });
  } catch (err) { return handleLeadServiceError(res, err, next); }
};
