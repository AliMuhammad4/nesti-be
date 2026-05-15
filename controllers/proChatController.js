import logger from '../utils/logger.js';
import { normalizeId } from '../utils/proChatUtils.js';
import {
  createGroupThread as createGroupThreadService,
  createOrGetDirectThread,
  getThreadById as getThreadByIdService,
  listMyThreads as listMyThreadsService,
  loadDirectThreadByParticipants,
} from '../services/proChat/threadService.js';
import {
  addGroupMembers as addGroupMembersService,
  deleteGroupThread as deleteGroupThreadService,
  leaveGroupThread as leaveGroupThreadService,
  removeGroupMember as removeGroupMemberService,
  updateGroupThread as updateGroupThreadService,
} from '../services/proChat/membershipService.js';
import {
  listGroupRejoinRequests as listGroupRejoinRequestsService,
  requestRejoinGroupThread as requestRejoinGroupThreadService,
  resolveGroupRejoinRequest as resolveGroupRejoinRequestService,
} from '../services/proChat/rejoinService.js';
import {
  listThreadMessages as listThreadMessagesService,
  postThreadMessage as postThreadMessageService,
} from '../services/proChat/messageService.js';

function sendServiceResult(res, result) {
  return res.status(result?.status || 200).json(result?.body || result);
}

export const createOrGetThread = async (req, res, next) => {
  try {
    const result = await createOrGetDirectThread({
      currentUserId: req.user?._id,
      otherUserId: req.body?.other_user_id,
    });
    return sendServiceResult(res, result);
  } catch (err) {
    if (String(err?.code) === '11000') {
      try {
        const existing = await loadDirectThreadByParticipants({
          currentUserId: req.user?._id,
          otherUserId: req.body?.other_user_id,
        });
        if (existing) return res.json(existing);
      } catch {
        // fall through to normal error handling
      }
    }
    return next(err);
  }
};

export const createGroupThread = async (req, res, next) => {
  try {
    const result = await createGroupThreadService({
      currentUser: req.user,
      title: req.body?.title,
      participantIds: req.body?.participant_ids,
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const updateGroupThread = async (req, res, next) => {
  try {
    const result = await updateGroupThreadService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
      body: req.body,
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const addGroupMembers = async (req, res, next) => {
  try {
    const result = await addGroupMembersService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
      participantIds: req.body?.participant_ids,
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const removeGroupMember = async (req, res, next) => {
  try {
    const result = await removeGroupMemberService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
      removeUserId: req.params?.userId,
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const leaveGroupThread = async (req, res, next) => {
  try {
    const result = await leaveGroupThreadService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const deleteGroupThread = async (req, res, next) => {
  try {
    const result = await deleteGroupThreadService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const requestRejoinGroupThread = async (req, res, next) => {
  try {
    const result = await requestRejoinGroupThreadService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const listGroupRejoinRequests = async (req, res, next) => {
  try {
    const result = await listGroupRejoinRequestsService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const resolveGroupRejoinRequest = async (req, res, next) => {
  try {
    const result = await resolveGroupRejoinRequestService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
      requesterUserId: req.params?.userId,
      action: req.params?.action,
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const getThreadById = async (req, res, next) => {
  try {
    const result = await getThreadByIdService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const listMyThreads = async (req, res, next) => {
  try {
    const body = await listMyThreadsService({
      currentUserId: req.user?._id,
      limitRaw: req.query?.limit,
      pageRaw: req.query?.page,
    });
    return res.json(body);
  } catch (error) {
    next(error);
  }
};

export const listThreadMessages = async (req, res, next) => {
  try {
    const result = await listThreadMessagesService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
      limitRaw: req.query?.limit,
      pageRaw: req.query?.page,
    });
    return sendServiceResult(res, result);
  } catch (error) {
    next(error);
  }
};

export const postThreadMessage = async (req, res, next) => {
  try {
    const result = await postThreadMessageService({
      currentUserId: req.user?._id,
      threadId: normalizeId(req.params?.id),
      body: req.body?.body,
      attachments: req.body?.attachments,
      clientId: req.body?.client_id,
    });
    return sendServiceResult(res, result);
  } catch (error) {
    logger.warn('postThreadMessage failed', { err: error?.message });
    next(error);
  }
};
