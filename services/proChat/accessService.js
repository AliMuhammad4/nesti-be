import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import { normalizeId } from '../../utils/proChatUtils.js';

export async function assertThreadMembership(threadId, userId, options = {}) {
  const allowLeftParticipant = Boolean(options?.allowLeftParticipant);
  const tid = normalizeId(threadId);
  if (!tid) return { status: 400, body: { success: false, message: 'Missing thread id' } };
  const thread = await ProfessionalChatThread.findById(tid).lean();
  if (!thread) return { status: 404, body: { success: false, message: 'Thread not found' } };
  const me = String(userId);
  const parts = (thread.participants || []).map((p) => String(p));
  const leftParts = (thread.left_participants || []).map((p) => String(p));
  const isMember = parts.includes(me);
  const isLeftParticipant = leftParts.includes(me);
  if (!isMember && !(allowLeftParticipant && isLeftParticipant)) {
    return { status: 403, body: { success: false, message: 'Not a participant' } };
  }
  return { status: 200, thread, participants: parts, left_participants: leftParts, isMember, isLeftParticipant };
}

export async function assertGroupThread(threadId, userId) {
  const check = await assertThreadMembership(threadId, userId);
  if (check.status !== 200) return check;
  const type = String(check.thread?.thread_type || 'dm');
  if (type !== 'group') {
    return { status: 400, body: { success: false, message: 'Not a group thread' } };
  }
  return check;
}

export function isCreator(check, userId) {
  const createdBy = String(check?.thread?.created_by || '').trim();
  const me = String(userId || '').trim();
  return Boolean(createdBy && me && createdBy === me);
}
