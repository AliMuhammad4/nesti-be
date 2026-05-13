import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../../models/User.js';
import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import ProfessionalChatMessage from '../../models/ProfessionalChatMessage.js';
import logger from '../../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
let io = null;
function userRoom(userId) {
  return `user:${String(userId)}`;
}
function proChatRoom(threadId) {
  return `prochat:${String(threadId)}`;
}

function normalizeHandshakeToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let t = raw.trim();
  if (t.toLowerCase().startsWith('bearer ')) t = t.slice(7).trim();
  return t || null;
}
function parseOrigins() {
  const raw = process.env.CLIENT_ORIGIN || process.env.SOCKET_CORS_ORIGIN || '';
  if (!raw.trim()) return true;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    const devDefaults = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
    ];
    for (const o of devDefaults) {
      if (!list.includes(o)) list.push(o);
    }
  }
  return list;
}

export function initWorkspaceSocket(httpServer) {
  if (io) return io;
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: parseOrigins(),
      credentials: true,
    },
  });
  io.use(async (socket, next) => {
    try {
      const token = normalizeHandshakeToken(
        socket.handshake.auth?.token || socket.handshake.query?.token || null
      );
      if (!token) {
        return next(new Error('auth_required'));
      }
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select('_id role');
      if (!user) return next(new Error('user_not_found'));
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      next();
    } catch (e) {
      logger.warn('Socket auth failed', { message: e.message });
      next(new Error('invalid_token'));
    }
  });
  io.on('connection', (socket) => {
    const uid = socket.data.userId;
    socket.join(userRoom(uid));
    socket.emit('workspace:ready', {
      schema: 1,
      user_id: uid,
    });
    logger.info('Workspace socket connected', {
      user_id: uid,
      socket_id: socket.id,
      transport: socket.conn?.transport?.name,
    });

    const safeAck = (ack, payload) => {
      if (typeof ack === 'function') {
        try {
          ack(payload);
        } catch {
          /* ignore ack errors */
        }
      }
    };

    const assertThreadMembership = async (threadId) => {
      const tid = String(threadId || '').trim();
      if (!tid) {
        const err = new Error('missing_thread_id');
        err.code = 'missing_thread_id';
        throw err;
      }
      const thread = await ProfessionalChatThread.findById(tid).select('participants').lean();
      if (!thread) {
        const err = new Error('thread_not_found');
        err.code = 'thread_not_found';
        throw err;
      }
      const me = String(uid);
      const parts = (thread.participants || []).map((p) => String(p));
      if (!parts.includes(me)) {
        const err = new Error('not_a_participant');
        err.code = 'not_a_participant';
        throw err;
      }
      return { thread, participants: parts };
    };

    socket.on('prochat:join', async (payload, ack) => {
      try {
        const { thread_id } = payload || {};
        await assertThreadMembership(thread_id);
        socket.join(proChatRoom(thread_id));
        safeAck(ack, { success: true, thread_id: String(thread_id) });
      } catch (e) {
        safeAck(ack, { success: false, code: e.code || 'join_failed', message: e.message });
      }
    });

    socket.on('prochat:send', async (payload, ack) => {
      try {
        const { thread_id, body, client_id } = payload || {};
        const text = String(body || '').trim();
        if (!text) {
          const err = new Error('empty_message');
          err.code = 'empty_message';
          throw err;
        }
        if (text.length > 5000) {
          const err = new Error('message_too_long');
          err.code = 'message_too_long';
          throw err;
        }
        const { participants } = await assertThreadMembership(thread_id);
        const msg = await ProfessionalChatMessage.create({
          thread_id,
          sender_user_id: uid,
          client_id: client_id ? String(client_id).slice(0, 128) : null,
          body: text,
        });
        await ProfessionalChatThread.updateOne(
          { _id: thread_id },
          {
            $set: {
              last_message_at: msg.createdAt,
              last_message_text: text.slice(0, 280),
              last_message_sender_id: uid,
            },
          }
        );

        const sender = await User.findById(uid)
          .select('first_name last_name email role profile_image')
          .lean();
        const senderFullName = sender
          ? [sender.first_name, sender.last_name].filter(Boolean).join(' ').trim()
          : '';
        const out = {
          id: String(msg._id),
          thread_id: String(thread_id),
          sender_user_id: String(uid),
          client_id: msg.client_id || null,
          body: msg.body,
          created_at: msg.createdAt,
          sender: sender
            ? {
                id: String(uid),
                first_name: sender.first_name || '',
                last_name: sender.last_name || '',
                full_name: senderFullName,
                email: sender.email || '',
                role: sender.role || null,
                profile_image: sender.profile_image || null,
              }
            : null,
        };
        io.to(proChatRoom(thread_id)).emit('prochat:message', out);
        for (const pid of participants) {
          io.to(userRoom(pid)).emit('prochat:inbox', {
            schema: 1,
            occurred_at: new Date().toISOString(),
            thread_id: String(thread_id),
            message: out,
          });
        }
        safeAck(ack, { success: true, message: out });
      } catch (e) {
        logger.warn('prochat:send failed', { user_id: uid, message: e.message });
        safeAck(ack, { success: false, code: e.code || 'send_failed', message: e.message });
      }
    });

    socket.on('prochat:typing', async (payload, ack) => {
      try {
        const { thread_id, is_typing } = payload || {};
        await assertThreadMembership(thread_id);
        const body = {
          thread_id: String(thread_id),
          user_id: String(uid),
          is_typing: Boolean(is_typing),
          occurred_at: new Date().toISOString(),
        };
        socket.to(proChatRoom(thread_id)).emit('prochat:typing', body);
        safeAck(ack, { success: true });
      } catch (e) {
        safeAck(ack, { success: false, code: e.code || 'typing_failed', message: e.message });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.debug('Workspace socket disconnected', { user_id: uid, reason });
    });
  });
  logger.info('Workspace Socket.IO initialized on path /socket.io');
  return io;
}
export function getWorkspaceIo() {
  return io;
}

export function emitWorkspaceLeadEvent(ownerUserId, payload) {
  if (!io || !ownerUserId) {
    logger.warn('emitWorkspaceLeadEvent skipped (no io or user)', {
      has_io: !!io,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
    });
    return;
  }
  const room = userRoom(ownerUserId);
  const body = {
    schema: 1,
    occurred_at: new Date().toISOString(),
    ...payload,
  };
  io.to(room).emit('workspace:lead', body);
  logger.info('Socket emit workspace:lead', {
    user_id: String(ownerUserId),
    room,
    kind: payload?.kind ?? null,
    lead_match_id: payload?.lead_match_id ?? null,
  });
}

export function emitNotification(ownerUserId, payload) {
  if (!io || !ownerUserId) {
    logger.warn('emitNotification skipped (no io or user)', {
      has_io: !!io,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
    });
    return;
  }
  const room = userRoom(ownerUserId);
  const body = {
    schema: 1,
    occurred_at: new Date().toISOString(),
    ...payload,
  };
  io.to(room).emit('notifications:item', body);
  logger.info('Socket emit notifications:item', {
    user_id: String(ownerUserId),
    room,
    notification_type: payload?.notification_type ?? null,
    title: payload?.title ? String(payload.title).slice(0, 80) : null,
  });
}
