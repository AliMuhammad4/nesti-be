import ProfessionalChatMessage from '../../models/ProfessionalChatMessage.js';
import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import User from '../../models/User.js';
import {
  messageSummary,
  normalizeAttachments,
  validateProChatAttachmentLimits,
  userSummary,
} from '../../utils/proChatUtils.js';
import { assertThreadMembership } from './accessService.js';

const USER_SELECT = 'first_name last_name email role profile_image';

export async function listThreadMessages({ currentUserId, threadId, limitRaw = 50, pageRaw = 1 }) {
  const check = await assertThreadMembership(threadId, currentUserId, { allowLeftParticipant: true });
  if (check.status !== 200) return { status: check.status, body: check.body };

  const limitNum = Number(limitRaw);
  const pageNum = Number(pageRaw);
  const limit = Math.min(Math.max(limitNum, 1), 100);
  const page = Math.max(pageNum, 1);
  const skip = (page - 1) * limit;

  const [total, rows] = await Promise.all([
    ProfessionalChatMessage.countDocuments({ thread_id: threadId }),
    ProfessionalChatMessage.find({ thread_id: threadId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const senderIds = Array.from(new Set(rows.map((m) => String(m.sender_user_id || '')).filter(Boolean)));
  const senders = senderIds.length ? await User.find({ _id: { $in: senderIds } }).select(USER_SELECT).lean() : [];
  const senderMap = new Map(senders.map((u) => [String(u._id), userSummary(u)]));

  const messages = rows
    .slice()
    .reverse()
    .map((m) => {
      const sid = String(m.sender_user_id);
      return {
        id: String(m._id),
        thread_id: String(m.thread_id),
        sender_user_id: sid,
        client_id: m.client_id || null,
        body: m.body,
        attachments: Array.isArray(m.attachments) ? m.attachments : [],
        created_at: m.createdAt,
        sender: senderMap.get(sid) || null,
      };
    });

  return {
    status: 200,
    body: {
      success: true,
      items: messages,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(Math.ceil(total / limit), 1),
        has_prev_page: page > 1,
        has_next_page: page * limit < total,
      },
    },
  };
}

export async function postThreadMessage({ currentUserId, threadId, body, attachments, clientId: rawClientId }) {
  const check = await assertThreadMembership(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };

  const text = String(body || '').trim();
  if (text.length > 5000) {
    return { status: 400, body: { success: false, message: 'Message is too long' } };
  }
  const attsRaw = Array.isArray(attachments) ? attachments : [];
  if (!text && attsRaw.length < 1) {
    return { status: 400, body: { success: false, message: 'Message must include text or at least one attachment' } };
  }
  const atts = normalizeAttachments(attsRaw);
  if (atts.length !== attsRaw.length) {
    return { status: 400, body: { success: false, message: 'Invalid attachments payload' } };
  }
  const attachmentLimit = validateProChatAttachmentLimits(atts);
  if (!attachmentLimit.ok) {
    return { status: 400, body: { success: false, message: attachmentLimit.message } };
  }
  const clientId = rawClientId ? String(rawClientId).slice(0, 128) : null;

  if (clientId) {
    const dup = await ProfessionalChatMessage.findOne({
      thread_id: threadId,
      sender_user_id: currentUserId,
      client_id: clientId,
    }).lean();
    if (dup) {
      const sender = await User.findById(currentUserId).select(USER_SELECT).lean();
      return { status: 200, body: { success: true, message: messageSummary(dup, sender) } };
    }
  }

  const msg = await ProfessionalChatMessage.create({
    thread_id: threadId,
    sender_user_id: currentUserId,
    client_id: clientId,
    body: text,
    attachments: atts,
  });

  await ProfessionalChatThread.updateOne(
    { _id: threadId },
    {
      $set: {
        last_message_at: msg.createdAt,
        last_message_text: text ? text.slice(0, 280) : (atts.length === 1 ? 'Attachment' : 'Attachments'),
        last_message_sender_id: currentUserId,
      },
    }
  );

  const sender = await User.findById(currentUserId).select(USER_SELECT).lean();
  return { status: 200, body: { success: true, message: messageSummary(msg, sender) } };
}
