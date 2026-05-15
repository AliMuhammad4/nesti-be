import logger from '../../utils/logger.js';
import { emitNotification, getWorkspaceIo } from '../realtime/workspaceSocket.js';
import { createLeadLifecycleNotification } from '../notifications/notificationService.js';
import { displayName, userSummary } from '../../utils/proChatUtils.js';

export async function emitGroupInbox({ toUserIds, threadId, message }) {
  try {
    const io = getWorkspaceIo();
    if (!io) return;
    for (const uid of toUserIds || []) {
      io.to(`user:${String(uid)}`).emit('prochat:inbox', {
        schema: 1,
        occurred_at: new Date().toISOString(),
        thread_id: String(threadId),
        message,
      });
    }
  } catch (e) {
    logger.warn('prochat group inbox emit failed', { message: e?.message });
  }
}

export async function persistAndEmitProChatNotification(userId, payload) {
  const uid = userId?._id || userId;
  if (!uid) return;
  let notification_id = null;
  try {
    const doc = await createLeadLifecycleNotification(uid, payload);
    notification_id = doc?._id ? String(doc._id) : null;
  } catch (e) {
    logger.warn('prochat notification persist failed', {
      error: e?.message,
      user_id: String(uid),
      type: payload?.notification_type,
    });
  }
  emitNotification(uid, { notification_id, ...payload });
}

export async function notifyThreadStarted({ toUserId, thread, sender }) {
  try {
    const io = getWorkspaceIo();
    if (!io) return;
    const senderName = displayName(sender);
    io.to(`user:${String(toUserId)}`).emit('prochat:inbox', {
      schema: 1,
      occurred_at: new Date().toISOString(),
      thread_id: String(thread._id),
      message: {
        id: `thread:${String(thread._id)}`,
        thread_id: String(thread._id),
        sender_user_id: String(sender?._id || ''),
        client_id: null,
        body: `${senderName} started a chat with you.`,
        created_at: new Date().toISOString(),
        sender: sender ? { ...userSummary(sender), full_name: senderName } : null,
        kind: 'thread_started',
      },
    });
    logger.info('prochat thread_started notify', {
      thread_id: String(thread._id),
      from_user_id: String(sender?._id || ''),
      to_user_id: String(toUserId),
    });
  } catch (e) {
    logger.warn('prochat thread_started notify failed', { message: e?.message });
  }
}

export async function notifyGroupCreated({ toUserIds, thread, sender }) {
  try {
    const io = getWorkspaceIo();
    if (!io) return;
    const senderName = displayName(sender);
    for (const pid of toUserIds || []) {
      io.to(`user:${String(pid)}`).emit('prochat:inbox', {
        schema: 1,
        occurred_at: new Date().toISOString(),
        thread_id: String(thread._id),
        message: {
          id: `group:${String(thread._id)}`,
          thread_id: String(thread._id),
          sender_user_id: String(sender?._id || ''),
          client_id: null,
          body: `${senderName} added you to a group chat.`,
          created_at: new Date().toISOString(),
          sender: sender ? userSummary(sender) : null,
          kind: 'group_created',
        },
      });
    }
  } catch (e) {
    logger.warn('prochat group_created notify failed', { message: e?.message });
  }
}

export async function notifyGroupMemberAdded({ recipients, actor, thread }) {
  const actorName = displayName(actor);
  const groupTitle = String(thread?.title || '').trim() || 'Group chat';
  const tid = String(thread?._id || thread?.id || '').trim();
  const body = `${actorName} added you to "${groupTitle}".`;
  for (const uid of recipients || []) {
    await persistAndEmitProChatNotification(uid, {
      notification_type: 'prochat_group_member_added',
      title: 'Added to group chat',
      body,
      severity: 'info',
      action: { type: 'open_prochat_thread', thread_id: tid },
    });
  }
}
