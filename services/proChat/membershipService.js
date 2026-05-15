import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import ProfessionalChatMessage from '../../models/ProfessionalChatMessage.js';
import ProfessionalNotification from '../../models/ProfessionalNotification.js';
import User from '../../models/User.js';
import logger from '../../utils/logger.js';
import {
  displayName,
  isProfessionalRole,
  normalizeId,
  threadSummary,
  toObjectId,
  userSummary,
} from '../../utils/proChatUtils.js';
import { assertGroupThread, isCreator } from './accessService.js';
import { emitGroupInbox, notifyGroupMemberAdded } from './notificationService.js';
import { updateGroupTitle } from './threadService.js';

const USER_SELECT = 'first_name last_name email role profile_image';

async function loadValidNewMembers({ participantIds, existingParticipantIds }) {
  const rawIds = Array.isArray(participantIds) ? participantIds : [];
  const cleaned = rawIds.map(normalizeId).filter(Boolean);
  const uniq = Array.from(new Set(cleaned)).filter((id) => !existingParticipantIds.includes(String(id)));
  if (uniq.length < 1) {
    return { error: { status: 400, body: { success: false, message: 'No new members to add' } } };
  }
  const ids = uniq.map(toObjectId).filter(Boolean);
  if (ids.length !== uniq.length) {
    return { error: { status: 400, body: { success: false, message: 'Invalid participant id in participant_ids' } } };
  }
  const users = await User.find({ _id: { $in: ids } }).select(USER_SELECT).lean();
  if (users.length !== ids.length) {
    return { error: { status: 404, body: { success: false, message: 'One or more professionals not found' } } };
  }
  for (const u of users) {
    if (!isProfessionalRole(u.role)) {
      return { error: { status: 400, body: { success: false, message: 'Group chat is for professionals only' } } };
    }
  }
  return { uniq, ids, users };
}

export async function updateGroupThread({ currentUserId, threadId, body }) {
  const check = await assertGroupThread(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };
  if (!isCreator(check, currentUserId)) {
    return { status: 403, body: { success: false, message: 'Only the group creator can update this group' } };
  }

  if (Array.isArray(body?.participant_ids) && body.participant_ids.length) {
    logger.info('prochat group update: participant_ids via PATCH', {
      thread_id: String(threadId),
      actor_user_id: String(currentUserId),
      count: body.participant_ids.length,
    });
    const loaded = await loadValidNewMembers({
      participantIds: body.participant_ids,
      existingParticipantIds: check.participants,
    });
    if (loaded.error) return loaded.error;
    await ProfessionalChatThread.updateOne(
      { _id: threadId },
      { $addToSet: { participants: { $each: loaded.ids } } }
    );
    const updated = await ProfessionalChatThread.findById(threadId).lean();
    logger.info('prochat group members added (via PATCH fallback)', {
      thread_id: String(threadId),
      actor_user_id: String(currentUserId),
      added_count: loaded.users.length,
    });
    return {
      status: 200,
      body: { success: true, thread: threadSummary(updated), added: loaded.users.map(userSummary) },
    };
  }

  const { updated, to, message } = await updateGroupTitle({
    currentUserId,
    threadId,
    title: body?.title,
    check,
  });
  await emitGroupInbox({ toUserIds: to, threadId, message });
  return { status: 200, body: { success: true, thread: threadSummary(updated) } };
}

export async function addGroupMembers({ currentUserId, threadId, participantIds }) {
  const check = await assertGroupThread(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };
  if (!isCreator(check, currentUserId)) {
    return { status: 403, body: { success: false, message: 'Only the group creator can add members' } };
  }

  const loaded = await loadValidNewMembers({
    participantIds,
    existingParticipantIds: check.participants,
  });
  if (loaded.error) return loaded.error;

  await ProfessionalChatThread.updateOne(
    { _id: threadId },
    { $addToSet: { participants: { $each: loaded.ids } } }
  );
  const updated = await ProfessionalChatThread.findById(threadId).lean();
  logger.info('prochat group members added', {
    thread_id: String(threadId),
    actor_user_id: String(currentUserId),
    added_count: loaded.users.length,
  });

  const sender = await User.findById(currentUserId).select(USER_SELECT).lean();
  const senderName = displayName(sender);
  await emitGroupInbox({
    toUserIds: loaded.uniq,
    threadId,
    message: {
      id: `group:added:${String(threadId)}:${Date.now()}`,
      thread_id: String(threadId),
      sender_user_id: String(currentUserId),
      client_id: null,
      body: `${senderName} added you to a group chat.`,
      created_at: new Date().toISOString(),
      sender: userSummary(sender),
      kind: 'group_member_added',
    },
  });

  try {
    await notifyGroupMemberAdded({ recipients: loaded.uniq, actor: sender, thread: updated });
  } catch (e) {
    logger.warn('prochat notifyGroupMemberAdded failed', { message: e?.message });
  }

  const toExisting = (updated?.participants || [])
    .map(String)
    .filter((p) => String(p) !== String(currentUserId) && !loaded.uniq.includes(String(p)));
  await emitGroupInbox({
    toUserIds: toExisting,
    threadId,
    message: {
      id: `group:members_updated:${String(threadId)}:${Date.now()}`,
      thread_id: String(threadId),
      sender_user_id: String(currentUserId),
      client_id: null,
      body: `${senderName} added ${loaded.users.length} member(s) to the group.`,
      created_at: new Date().toISOString(),
      sender: userSummary(sender),
      kind: 'group_members_added',
    },
  });

  return {
    status: 200,
    body: { success: true, thread: threadSummary(updated), added: loaded.users.map(userSummary) },
  };
}

export async function removeGroupMember({ currentUserId, threadId, removeUserId }) {
  const removeId = normalizeId(removeUserId);
  const check = await assertGroupThread(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };
  if (!isCreator(check, currentUserId)) {
    return { status: 403, body: { success: false, message: 'Only the group creator can remove members' } };
  }
  if (!removeId) return { status: 400, body: { success: false, message: 'Missing user id' } };
  if (!check.participants.includes(String(removeId))) {
    return { status: 404, body: { success: false, message: 'User is not a member of this group' } };
  }
  if ((check.participants || []).length <= 2) {
    return { status: 400, body: { success: false, message: 'Group must have at least 2 members' } };
  }

  await ProfessionalChatThread.updateOne({ _id: threadId }, { $pull: { participants: toObjectId(removeId) } });
  const updated = await ProfessionalChatThread.findById(threadId).lean();
  const sender = await User.findById(currentUserId).select(USER_SELECT).lean();
  const senderName = displayName(sender);

  if (String(removeId) !== String(currentUserId)) {
    await emitGroupInbox({
      toUserIds: [removeId],
      threadId,
      message: {
        id: `group:removed:${String(threadId)}:${Date.now()}`,
        thread_id: String(threadId),
        sender_user_id: String(currentUserId),
        client_id: null,
        body: `${senderName} removed you from the group.`,
        created_at: new Date().toISOString(),
        sender: userSummary(sender),
        kind: 'group_member_removed',
      },
    });
  }

  const remaining = (updated?.participants || []).map(String).filter((p) => String(p) !== String(currentUserId));
  await emitGroupInbox({
    toUserIds: remaining,
    threadId,
    message: {
      id: `group:members_updated:${String(threadId)}:${Date.now()}`,
      thread_id: String(threadId),
      sender_user_id: String(currentUserId),
      client_id: null,
      body: `${senderName} updated group members.`,
      created_at: new Date().toISOString(),
      sender: userSummary(sender),
      kind: 'group_members_updated',
    },
  });

  return { status: 200, body: { success: true, thread: threadSummary(updated) } };
}

export async function leaveGroupThread({ currentUserId, threadId }) {
  const check = await assertGroupThread(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };
  if ((check.participants || []).length <= 2) {
    return { status: 400, body: { success: false, message: 'Group must have at least 2 members' } };
  }

  await ProfessionalChatThread.updateOne(
    { _id: threadId },
    {
      $pull: { participants: toObjectId(currentUserId) },
      $addToSet: { left_participants: toObjectId(currentUserId) },
    }
  );
  const updated = await ProfessionalChatThread.findById(threadId).lean();
  const sender = await User.findById(currentUserId).select(USER_SELECT).lean();
  const senderName = displayName(sender);
  const remaining = (updated?.participants || []).map(String);
  await emitGroupInbox({
    toUserIds: remaining,
    threadId,
    message: {
      id: `group:left:${String(threadId)}:${Date.now()}`,
      thread_id: String(threadId),
      sender_user_id: String(currentUserId),
      client_id: null,
      body: `${senderName} left the group.`,
      created_at: new Date().toISOString(),
      sender: userSummary(sender),
      kind: 'group_member_left',
    },
  });

  return { status: 200, body: { success: true, thread: threadSummary(updated) } };
}

export async function deleteGroupThread({ currentUserId, threadId }) {
  const check = await assertGroupThread(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };
  if (!isCreator(check, currentUserId)) {
    return { status: 403, body: { success: false, message: 'Only the group creator can delete this group' } };
  }

  const [messagesResult, notificationsResult, threadResult] = await Promise.all([
    ProfessionalChatMessage.deleteMany({ thread_id: threadId }),
    ProfessionalNotification.deleteMany({ 'action.thread_id': String(threadId) }),
    ProfessionalChatThread.deleteOne({ _id: threadId }),
  ]);

  logger.info('prochat group deleted', {
    thread_id: String(threadId),
    actor_user_id: String(currentUserId),
    deleted_messages: messagesResult.deletedCount || 0,
    deleted_notifications: notificationsResult.deletedCount || 0,
    deleted_threads: threadResult.deletedCount || 0,
  });

  return {
    status: 200,
    body: {
      success: true,
      deleted: true,
      thread_id: String(threadId),
      deleted_messages: messagesResult.deletedCount || 0,
      deleted_notifications: notificationsResult.deletedCount || 0,
    },
  };
}
