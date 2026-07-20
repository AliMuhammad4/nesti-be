import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import User from '../../models/User.js';
import {
  displayName,
  isProfessionalRole,
  normalizeId,
  participantsKey,
  rejoinRequestStatusForUser,
  threadSummary,
  toObjectId,
  userSummary,
} from '../../utils/proChatUtils.js';
import { assertThreadMembership } from './accessService.js';
import { notifyGroupCreated, notifyThreadStarted } from './notificationService.js';
import { USER_ROLE } from '../../constants/roles.js';

const USER_SELECT = 'first_name last_name email role profile_image';

export async function createOrGetDirectThread({ currentUserId, otherUserId }) {
  const otherIdRaw = normalizeId(otherUserId);
  if (!otherIdRaw) return { status: 400, body: { success: false, message: 'other_user_id is required' } };
  if (String(otherIdRaw) === String(currentUserId)) {
    return { status: 400, body: { success: false, message: 'Cannot chat with yourself' } };
  }
  const meId = toObjectId(currentUserId);
  const otherId = toObjectId(otherIdRaw);
  if (!meId || !otherId) return { status: 400, body: { success: false, message: 'Invalid user id' } };

  const [currentUser, otherUser] = await Promise.all([
    User.findById(currentUserId).select(USER_SELECT).lean(),
    User.findById(otherIdRaw).select(USER_SELECT).lean(),
  ]);
  const currentRole = String(currentUser?.role || '').toLowerCase();
  const otherRole = String(otherUser?.role || '').toLowerCase();
  if (!otherUser) return { status: 404, body: { success: false, message: 'Professional not found' } };
  const isProfessionalDm = isProfessionalRole(currentRole) && isProfessionalRole(otherRole);
  const isClientProfessionalDm =
    (currentRole === USER_ROLE.CLIENT && isProfessionalRole(otherRole)) ||
    (isProfessionalRole(currentRole) && otherRole === USER_ROLE.CLIENT);
  if (!isProfessionalDm && !isClientProfessionalDm) {
    return { status: 400, body: { success: false, message: 'Chat is for professionals only' } };
  }

  const key = participantsKey(meId, otherId);
  if (!key) return { status: 400, body: { success: false, message: 'Invalid participants' } };

  const existedBefore = await ProfessionalChatThread.findOne({ participants_key: key }).select('_id').lean();
  const saved = await ProfessionalChatThread.findOneAndUpdate(
    { participants_key: key },
    {
      $setOnInsert: {
        thread_type: 'dm',
        participants: [meId, otherId],
        participants_key: key,
        created_by: meId,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  ).lean();

  if (!existedBefore?._id && saved?._id) {
    const sender = await User.findById(meId).select(USER_SELECT).lean();
    await notifyThreadStarted({ toUserId: otherId, thread: saved, sender });
  }

  return {
    status: 200,
    body: { success: true, thread: threadSummary(saved), other_user: userSummary(otherUser) },
  };
}

export async function loadDirectThreadByParticipants({ currentUserId, otherUserId }) {
  const key = participantsKey(currentUserId, otherUserId);
  const existing = key ? await ProfessionalChatThread.findOne({ participants_key: key }).lean() : null;
  return existing ? { success: true, thread: threadSummary(existing) } : null;
}

export async function createGroupThread({ currentUser, title: titleRaw, participantIds }) {
  const me = currentUser?._id;
  const meId = toObjectId(me);
  if (!meId) return { status: 401, body: { success: false, message: 'Unauthorized' } };

  const title = titleRaw != null && String(titleRaw).trim() ? String(titleRaw).trim().slice(0, 120) : null;
  const rawIds = Array.isArray(participantIds) ? participantIds : [];
  const cleaned = rawIds
    .map(normalizeId)
    .filter(Boolean)
    .filter((id) => String(id) !== String(meId));
  const uniq = Array.from(new Set(cleaned));
  if (uniq.length < 1) {
    return { status: 400, body: { success: false, message: 'participant_ids must include at least 1 other professional' } };
  }
  const ids = uniq.map(toObjectId).filter(Boolean);
  if (ids.length !== uniq.length) {
    return { status: 400, body: { success: false, message: 'Invalid participant id in participant_ids' } };
  }

  const users = await User.find({ _id: { $in: ids } }).select(USER_SELECT).lean();
  if (users.length !== ids.length) {
    return { status: 404, body: { success: false, message: 'One or more professionals not found' } };
  }
  for (const u of users) {
    if (!isProfessionalRole(u.role)) {
      return { status: 400, body: { success: false, message: 'Group chat is for professionals only' } };
    }
  }

  const created = await ProfessionalChatThread.create({
    thread_type: 'group',
    title,
    participants: [meId, ...ids],
    created_by: meId,
  });

  const sender = await User.findById(meId).select(USER_SELECT).lean();
  await notifyGroupCreated({ toUserIds: ids, thread: created, sender });

  return {
    status: 200,
    body: {
      success: true,
      thread: threadSummary(created),
      members: [userSummary(currentUser), ...users.map(userSummary)].filter(Boolean),
    },
  };
}

export async function updateGroupTitle({ currentUserId, threadId, title: titleRaw, check }) {
  const title =
    titleRaw === null
      ? null
      : titleRaw != null && String(titleRaw).trim()
        ? String(titleRaw).trim().slice(0, 120)
        : null;

  const updated = await ProfessionalChatThread.findByIdAndUpdate(
    threadId,
    { $set: { title } },
    { returnDocument: 'after' },
  ).lean();
  const meId = String(currentUserId);
  const to = (check.participants || []).filter((p) => String(p) !== meId);
  const sender = await User.findById(currentUserId).select(USER_SELECT).lean();
  const senderName = displayName(sender);

  return {
    updated,
    to,
    message: {
      id: `group:update:${String(threadId)}:${Date.now()}`,
      thread_id: String(threadId),
      sender_user_id: String(currentUserId),
      client_id: null,
      body: `${senderName} updated the group.`,
      created_at: new Date().toISOString(),
      sender: userSummary(sender),
      kind: 'group_updated',
    },
  };
}

export async function getThreadById({ currentUserId, threadId }) {
  const check = await assertThreadMembership(threadId, currentUserId, { allowLeftParticipant: true });
  if (check.status !== 200) return { status: check.status, body: check.body };

  const thread = check.thread;
  const isGroup = String(thread?.thread_type || 'dm') === 'group';
  const others = (check.participants || []).filter((p) => String(p) !== String(currentUserId));
  const otherUserId = !isGroup ? (others[0] || null) : null;
  const otherUser = otherUserId ? await User.findById(otherUserId).select(USER_SELECT).lean() : null;
  const members = isGroup
    ? await User.find({ _id: { $in: check.participants || [] } }).select(USER_SELECT).lean()
    : null;

  return {
    status: 200,
    body: {
      success: true,
      thread: {
        ...threadSummary(thread),
        is_member: Boolean(check.isMember),
        can_reply: Boolean(check.isMember),
        rejoin_request_status: check.isMember ? null : rejoinRequestStatusForUser(thread, currentUserId),
      },
      other_user: userSummary(otherUser),
      members: members ? members.map(userSummary) : null,
    },
  };
}

export async function listMyThreads({ currentUserId, limitRaw = 20, pageRaw = 1, includeLeadThreadsRaw = true }) {
  const limitNum = Number(limitRaw);
  const pageNum = Number(pageRaw);
  const limit = Math.min(Math.max(Number.isFinite(limitNum) ? limitNum : 20, 1), 100);
  const page = Math.max(Number.isFinite(pageNum) ? pageNum : 1, 1);
  const skip = (page - 1) * limit;
  const includeLeadThreads = includeLeadThreadsRaw !== false && String(includeLeadThreadsRaw) !== '0';

  const threadFilter = {
    $or: [{ participants: currentUserId }, { left_participants: currentUserId }],
  };
  if (!includeLeadThreads) {
    threadFilter.participants_key = { $not: /^lead:/ };
  }
  const [facet] = await ProfessionalChatThread.aggregate([
    { $match: threadFilter },
    {
      $facet: {
        total: [{ $count: 'count' }],
        items: [
          { $sort: { last_message_at: -1, updatedAt: -1 } },
          { $skip: skip },
          { $limit: limit },
        ],
      },
    },
  ]);
  const total = facet?.total?.[0]?.count || 0;
  const items = Array.isArray(facet?.items) ? facet.items : [];

  const participantIds = new Set();
  for (const t of items) {
    for (const pid of t.participants || []) participantIds.add(String(pid));
  }
  const users = participantIds.size
    ? await User.find({ _id: { $in: [...participantIds] } }).select(USER_SELECT).lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const out = items.map((t) => {
    const type = t.thread_type || 'dm';
    const isGroup = String(type) === 'group';
    const participantsKey = String(t.participants_key || '');
    const isLeadThread = participantsKey.startsWith('lead:');
    const participants = (t.participants || [])
      .map((pid) => userById.get(String(pid)))
      .filter(Boolean);
    const other = (!isGroup || isLeadThread)
      ? participants.find((p) => String(p?._id || '') !== String(currentUserId)) || null
      : null;
    const membersPreview = isGroup
      ? participants.slice(0, 3).map(userSummary).filter(Boolean)
      : null;
    const isMember = participants.some((p) => String(p?._id || '') === String(currentUserId));
    return {
      id: String(t._id),
      thread_type: type,
      title: t.title || null,
      is_lead_thread: isLeadThread,
      lead_id: isLeadThread ? (participantsKey.split(':')[1] || null) : null,
      created_by: t.created_by ? String(t.created_by) : null,
      member_count: participants.length,
      is_member: isMember,
      can_reply: isMember,
      rejoin_request_status: rejoinRequestStatusForUser(t, currentUserId),
      last_message_at: t.last_message_at || null,
      last_message_text: t.last_message_text || null,
      last_message_sender_id: t.last_message_sender_id ? String(t.last_message_sender_id) : null,
      other_user: userSummary(other),
      members_preview: membersPreview,
      updated_at: t.updatedAt || null,
    };
  });

  return {
    success: true,
    items: out,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.max(Math.ceil(total / limit), 1),
      has_prev_page: page > 1,
      has_next_page: page * limit < total,
    },
  };
}
