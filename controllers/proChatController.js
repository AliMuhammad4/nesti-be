import ProfessionalChatThread from '../models/ProfessionalChatThread.js';
import ProfessionalChatMessage from '../models/ProfessionalChatMessage.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import mongoose from 'mongoose';
import { getWorkspaceIo } from '../services/realtime/workspaceSocket.js';
import { PROFESSIONAL_TYPE_VALUES, USER_ROLE } from '../constants/roles.js';

function normalizeId(value) {
  const s = String(value || '').trim();
  return s || null;
}

function userSummary(u) {
  if (!u) return null;
  return {
    id: String(u._id || u.id || ''),
    first_name: u.first_name || '',
    last_name: u.last_name || '',
    full_name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim(),
    email: u.email || '',
    role: u.role || null,
    profile_image: u.profile_image || null,
  };
}

function isProfessionalRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === String(USER_ROLE.ADMIN || '').toLowerCase()) return true;
  return PROFESSIONAL_TYPE_VALUES.includes(r);
}

function participantsKey(a, b) {
  const ids = [String(a || '').trim(), String(b || '').trim()].filter(Boolean).sort();
  return ids.length === 2 ? `${ids[0]}:${ids[1]}` : '';
}

function toObjectId(value) {
  const s = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

async function assertThreadMembership(threadId, userId) {
  const tid = normalizeId(threadId);
  if (!tid) return { status: 400, body: { success: false, message: 'Missing thread id' } };
  const thread = await ProfessionalChatThread.findById(tid).lean();
  if (!thread) return { status: 404, body: { success: false, message: 'Thread not found' } };
  const me = String(userId);
  const parts = (thread.participants || []).map((p) => String(p));
  if (!parts.includes(me)) {
    return { status: 403, body: { success: false, message: 'Not a participant' } };
  }
  return { status: 200, thread, participants: parts };
}

export const createOrGetThread = async (req, res, next) => {
  try {
    const me = req.user?._id;
    const otherUserId = normalizeId(req.body?.other_user_id);
    if (!otherUserId) {
      return res.status(400).json({ success: false, message: 'other_user_id is required' });
    }
    if (String(otherUserId) === String(me)) {
      return res.status(400).json({ success: false, message: 'Cannot chat with yourself' });
    }
    const meId = toObjectId(me);
    const otherId = toObjectId(otherUserId);
    if (!meId || !otherId) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }
    const otherUser = await User.findById(otherUserId)
      .select('first_name last_name email role profile_image')
      .lean();
    if (!otherUser) {
      return res.status(404).json({ success: false, message: 'Professional not found' });
    }
    if (!isProfessionalRole(otherUser.role)) {
      return res.status(400).json({ success: false, message: 'Chat is for professionals only' });
    }

    const key = participantsKey(meId, otherId);
    if (!key) {
      return res.status(400).json({ success: false, message: 'Invalid participants' });
    }

    // Reliable "created now" detection: check existence before upsert.
    // (Upsert metadata can vary across mongoose/driver versions.)
    const existedBefore = await ProfessionalChatThread.findOne({ participants_key: key })
      .select('_id')
      .lean();

    // Atomic idempotent upsert: guarantees 1 thread per (A,B) pair.
    const saved = await ProfessionalChatThread.findOneAndUpdate(
      { participants_key: key },
      {
        $setOnInsert: {
          participants: [meId, otherId],
          participants_key: key,
          created_by: meId,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      },
    ).lean();

    // Notify receiver only when the thread didn't exist previously.
    if (!existedBefore?._id && saved?._id) {
      try {
        const io = getWorkspaceIo();
        if (io) {
          const sender = await User.findById(meId)
            .select('first_name last_name email role profile_image')
            .lean();
          const senderName =
            [sender?.first_name, sender?.last_name].filter(Boolean).join(' ').trim() ||
            String(sender?.email || '').trim() ||
            'A professional';
          io.to(`user:${String(otherId)}`).emit('prochat:inbox', {
            schema: 1,
            occurred_at: new Date().toISOString(),
            thread_id: String(saved._id),
            message: {
              id: `thread:${String(saved._id)}`,
              thread_id: String(saved._id),
              sender_user_id: String(meId),
              client_id: null,
              body: `${senderName} started a chat with you.`,
              created_at: new Date().toISOString(),
              sender: sender
                ? {
                    id: String(meId),
                    first_name: sender.first_name || '',
                    last_name: sender.last_name || '',
                    full_name: senderName,
                    email: sender.email || '',
                    role: sender.role || null,
                    profile_image: sender.profile_image || null,
                  }
                : null,
              kind: 'thread_started',
            },
          });
          logger.info('prochat thread_started notify', {
            thread_id: String(saved._id),
            from_user_id: String(meId),
            to_user_id: String(otherId),
          });
        }
      } catch (e) {
        logger.warn('prochat thread_started notify failed', { message: e?.message });
      }
    }

    return res.json({
      success: true,
      thread: {
        id: String(saved?._id || ''),
        participants: saved?.participants?.map(String) || [],
        last_message_at: saved?.last_message_at || null,
        last_message_text: saved?.last_message_text || null,
        last_message_sender_id: saved?.last_message_sender_id ? String(saved.last_message_sender_id) : null,
        created_at: saved?.createdAt || null,
        updated_at: saved?.updatedAt || null,
      },
      other_user: userSummary(otherUser),
    });
  } catch (err) {
    // Handle unique index race: try to load.
    if (String(err?.code) === '11000') {
      try {
        const me = req.user?._id;
        const otherUserId = normalizeId(req.body?.other_user_id);
        const key = participantsKey(me, otherUserId);
        const existing = key ? await ProfessionalChatThread.findOne({ participants_key: key }).lean() : null;
        if (existing) {
          return res.json({
            success: true,
            thread: {
              id: String(existing._id),
              participants: existing.participants?.map(String) || [],
              last_message_at: existing.last_message_at || null,
              last_message_text: existing.last_message_text || null,
              last_message_sender_id: existing.last_message_sender_id ? String(existing.last_message_sender_id) : null,
              created_at: existing.createdAt || null,
              updated_at: existing.updatedAt || null,
            },
          });
        }
      } catch {
        // fall through
      }
    }
    return next(err);
  }
};

export const getThreadById = async (req, res, next) => {
  try {
    const me = req.user?._id;
    const tid = normalizeId(req.params?.id);
    const check = await assertThreadMembership(tid, me);
    if (check.status !== 200) return res.status(check.status).json(check.body);

    const thread = check.thread;
    const otherUserId = (check.participants || []).find((p) => p !== String(me)) || null;
    const otherUser = otherUserId
      ? await User.findById(otherUserId).select('first_name last_name email role profile_image').lean()
      : null;

    return res.json({
      success: true,
      thread: {
        id: String(thread._id),
        participants: thread.participants?.map(String) || [],
        last_message_at: thread.last_message_at || null,
        last_message_text: thread.last_message_text || null,
        last_message_sender_id: thread.last_message_sender_id ? String(thread.last_message_sender_id) : null,
        created_at: thread.createdAt || null,
        updated_at: thread.updatedAt || null,
      },
      other_user: userSummary(otherUser),
    });
  } catch (error) {
    next(error);
  }
};

export const listMyThreads = async (req, res, next) => {
  try {
    const me = req.user?._id;
    const items = await ProfessionalChatThread.find({ participants: me })
      .sort({ last_message_at: -1, updatedAt: -1 })
      .limit(200)
      .populate('participants', 'first_name last_name email role profile_image')
      .lean();

    const out = items.map((t) => {
      const other = Array.isArray(t.participants)
        ? t.participants.find((p) => String(p?._id || p?.id || '') !== String(me)) || null
        : null;
      return {
        id: String(t._id),
        last_message_at: t.last_message_at || null,
        last_message_text: t.last_message_text || null,
        last_message_sender_id: t.last_message_sender_id ? String(t.last_message_sender_id) : null,
        other_user: userSummary(other),
        updated_at: t.updatedAt || null,
      };
    });

    return res.json({ success: true, items: out });
  } catch (error) {
    next(error);
  }
};

export const listThreadMessages = async (req, res, next) => {
  try {
    const me = req.user?._id;
    const tid = normalizeId(req.params?.id);
    const check = await assertThreadMembership(tid, me);
    if (check.status !== 200) return res.status(check.status).json(check.body);

    const limitRaw = Number(req.query?.limit || 50);
    const pageRaw = Number(req.query?.page || 1);
    const limit = Math.min(Math.max(limitRaw, 1), 100);
    const page = Math.max(pageRaw, 1);
    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      ProfessionalChatMessage.countDocuments({ thread_id: tid }),
      ProfessionalChatMessage.find({ thread_id: tid })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const messages = rows
      .slice()
      .reverse()
      .map((m) => ({
        id: String(m._id),
        thread_id: String(m.thread_id),
        sender_user_id: String(m.sender_user_id),
        client_id: m.client_id || null,
        body: m.body,
        created_at: m.createdAt,
      }));

    return res.json({
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
    });
  } catch (error) {
    next(error);
  }
};

export const postThreadMessage = async (req, res, next) => {
  try {
    const me = req.user?._id;
    const tid = normalizeId(req.params?.id);
    const check = await assertThreadMembership(tid, me);
    if (check.status !== 200) return res.status(check.status).json(check.body);

    const text = String(req.body?.body || '').trim();
    if (!text) {
      return res.status(400).json({ success: false, message: 'Message body is required' });
    }
    if (text.length > 5000) {
      return res.status(400).json({ success: false, message: 'Message is too long' });
    }
    const clientId = req.body?.client_id ? String(req.body.client_id).slice(0, 128) : null;

    // Best-effort dedupe for retries.
    if (clientId) {
      const dup = await ProfessionalChatMessage.findOne({
        thread_id: tid,
        sender_user_id: me,
        client_id: clientId,
      }).lean();
      if (dup) {
        return res.json({
          success: true,
          message: {
            id: String(dup._id),
            thread_id: String(dup.thread_id),
            sender_user_id: String(dup.sender_user_id),
            client_id: dup.client_id || null,
            body: dup.body,
            created_at: dup.createdAt,
          },
        });
      }
    }

    const msg = await ProfessionalChatMessage.create({
      thread_id: tid,
      sender_user_id: me,
      client_id: clientId,
      body: text,
    });

    await ProfessionalChatThread.updateOne(
      { _id: tid },
      {
        $set: {
          last_message_at: msg.createdAt,
          last_message_text: text.slice(0, 280),
          last_message_sender_id: me,
        },
      }
    );

    return res.json({
      success: true,
      message: {
        id: String(msg._id),
        thread_id: String(msg.thread_id),
        sender_user_id: String(msg.sender_user_id),
        client_id: msg.client_id || null,
        body: msg.body,
        created_at: msg.createdAt,
      },
    });
  } catch (error) {
    logger.warn('postThreadMessage failed', { err: error?.message });
    next(error);
  }
};

