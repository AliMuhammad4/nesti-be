import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../../models/User.js';
import logger from '../../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
let io = null;
function userRoom(userId) {
  return `user:${String(userId)}`;
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
