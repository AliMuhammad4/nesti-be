import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import User from '../../models/User.js';
import logger from '../../utils/logger.js';
import {
  displayName,
  normalizeId,
  rejoinRequestStatusForUser,
  threadSummary,
  toObjectId,
  userSummary,
} from '../../utils/proChatUtils.js';
import { assertGroupThread, assertThreadMembership, isCreator } from './accessService.js';
import { persistAndEmitProChatNotification } from './notificationService.js';

const USER_SELECT = 'first_name last_name email role profile_image';

export async function requestRejoinGroupThread({ currentUserId, threadId }) {
  const check = await assertThreadMembership(threadId, currentUserId, { allowLeftParticipant: true });
  if (check.status !== 200) return { status: check.status, body: check.body };
  if (String(check.thread?.thread_type || 'dm') !== 'group') {
    return { status: 400, body: { success: false, message: 'Not a group thread' } };
  }
  if (check.isMember) {
    return { status: 400, body: { success: false, message: 'You are already a member of this group' } };
  }
  if (!check.isLeftParticipant) {
    return { status: 403, body: { success: false, message: 'Only previous members can request rejoin' } };
  }
  const meObj = toObjectId(currentUserId);
  if (!meObj) return { status: 400, body: { success: false, message: 'Invalid user id' } };

  await ProfessionalChatThread.updateOne({ _id: threadId }, { $pull: { rejoin_requests: { user_id: meObj } } });
  await ProfessionalChatThread.updateOne(
    { _id: threadId },
    {
      $addToSet: {
        rejoin_requests: {
          user_id: meObj,
          status: 'pending',
          requested_at: new Date(),
          resolved_at: null,
          resolved_by: null,
        },
      },
    }
  );
  try {
    const requester = await User.findById(meObj).select(USER_SELECT).lean();
    const requesterName = displayName(requester);
    const groupTitle = String(check.thread?.title || '').trim() || 'Group chat';
    const creatorId = String(check.thread?.created_by || '').trim();
    if (creatorId && creatorId !== String(meObj)) {
      await persistAndEmitProChatNotification(creatorId, {
        notification_type: 'prochat_rejoin_requested',
        title: 'Rejoin request',
        body: `${requesterName} requested to rejoin "${groupTitle}".`,
        severity: 'info',
        action: {
          type: 'prochat_rejoin_request',
          thread_id: String(threadId),
          requester_user_id: String(meObj),
          requester: userSummary(requester),
          status: 'pending',
        },
      });
    }
  } catch (e) {
    logger.warn('prochat rejoin request notify failed', { message: e?.message });
  }
  const updated = await ProfessionalChatThread.findById(threadId).lean();
  return {
    status: 200,
    body: { success: true, status: rejoinRequestStatusForUser(updated, currentUserId) || 'pending' },
  };
}

export async function listGroupRejoinRequests({ currentUserId, threadId }) {
  const check = await assertGroupThread(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };
  if (!isCreator(check, currentUserId)) {
    return { status: 403, body: { success: false, message: 'Only the group creator can view requests' } };
  }
  const requests = Array.isArray(check.thread?.rejoin_requests) ? check.thread.rejoin_requests : [];
  const pending = requests.filter((r) => String(r?.status || '') === 'pending');
  const ids = pending.map((r) => String(r?.user_id || '')).filter(Boolean);
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select(USER_SELECT).lean() : [];
  const byId = new Map(users.map((u) => [String(u._id), userSummary(u)]));
  const items = pending.map((r) => ({
    user_id: String(r.user_id),
    status: r.status,
    requested_at: r.requested_at || null,
    user: byId.get(String(r.user_id)) || null,
  }));
  return { status: 200, body: { success: true, items } };
}

export async function resolveGroupRejoinRequest({ currentUserId, threadId, requesterUserId, action }) {
  const userId = normalizeId(requesterUserId);
  const safeAction = String(action || '').trim().toLowerCase();
  if (!userId) return { status: 400, body: { success: false, message: 'Missing user id' } };
  if (!['approve', 'reject'].includes(safeAction)) {
    return { status: 400, body: { success: false, message: 'Invalid action' } };
  }

  const check = await assertGroupThread(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };
  if (!isCreator(check, currentUserId)) {
    return { status: 403, body: { success: false, message: 'Only the group creator can resolve requests' } };
  }
  const userObj = toObjectId(userId);
  if (!userObj) return { status: 400, body: { success: false, message: 'Invalid user id' } };

  const requests = Array.isArray(check.thread?.rejoin_requests) ? check.thread.rejoin_requests : [];
  const existing = requests.find((r) => String(r?.user_id || '') === String(userId));
  if (!existing || String(existing?.status || '') !== 'pending') {
    return { status: 404, body: { success: false, message: 'Pending request not found' } };
  }

  await ProfessionalChatThread.updateOne({ _id: threadId }, { $pull: { rejoin_requests: { user_id: userObj } } });
  await ProfessionalChatThread.updateOne(
    { _id: threadId },
    {
      $addToSet: {
        rejoin_requests: {
          user_id: userObj,
          status: safeAction === 'approve' ? 'approved' : 'rejected',
          requested_at: existing.requested_at || new Date(),
          resolved_at: new Date(),
          resolved_by: toObjectId(currentUserId),
        },
      },
    }
  );
  if (safeAction === 'approve') {
    await ProfessionalChatThread.updateOne(
      { _id: threadId },
      { $addToSet: { participants: userObj }, $pull: { left_participants: userObj } }
    );
  }

  await ProfessionalNotification.updateMany(
    {
      user_id: toObjectId(currentUserId),
      'action.type': 'prochat_rejoin_request',
      'action.thread_id': String(threadId),
      'action.requester_user_id': String(userId),
    },
    {
      $set: {
        'action.status': safeAction === 'approve' ? 'approved' : 'rejected',
        'action.resolved_at': new Date().toISOString(),
        read_at: new Date(),
      },
    }
  );

  try {
    const resolver = await User.findById(currentUserId).select('first_name last_name email').lean();
    const resolverName = displayName(resolver, 'Group creator');
    const groupTitle = String(check.thread?.title || '').trim() || 'Group chat';
    await persistAndEmitProChatNotification(userObj, {
      notification_type: safeAction === 'approve' ? 'prochat_rejoin_approved' : 'prochat_rejoin_rejected',
      title: safeAction === 'approve' ? 'Rejoin approved' : 'Rejoin rejected',
      body:
        safeAction === 'approve'
          ? `${resolverName} approved your request to rejoin "${groupTitle}".`
          : `${resolverName} rejected your request to rejoin "${groupTitle}".`,
      severity: safeAction === 'approve' ? 'info' : 'high',
      action: { type: 'open_prochat_thread', thread_id: String(threadId) },
    });
  } catch (e) {
    logger.warn('prochat rejoin resolve notify failed', { message: e?.message });
  }
  const updated = await ProfessionalChatThread.findById(threadId).lean();
  return { status: 200, body: { success: true, action: safeAction, thread: threadSummary(updated) } };
}
