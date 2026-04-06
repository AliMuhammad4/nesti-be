import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../../models/User.js';
import logger from '../../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
let io = null;
function userRoom(userId) {
  return `user:${String(userId)}`;
}
function parseOrigins() {
  const raw = process.env.CLIENT_ORIGIN || process.env.SOCKET_CORS_ORIGIN || '';
  if (!raw.trim()) return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
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
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        null;
      if (!token || typeof token !== 'string') {
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
    logger.debug('Workspace socket connected', { user_id: uid });
  });
  logger.info('Workspace Socket.IO initialized');
  return io;
}
export function getWorkspaceIo() {
  return io;
}

export function emitWorkspaceLeadEvent(ownerUserId, payload) {
  if (!io || !ownerUserId) return;
  const room = userRoom(ownerUserId);
  const body = {
    schema: 1,
    occurred_at: new Date().toISOString(),
    ...payload,
  };
  io.to(room).emit('workspace:lead', body);
}

export function emitNotification(ownerUserId, payload) {
  if (!io || !ownerUserId) return;
  const room = userRoom(ownerUserId);
  const body = {
    schema: 1,
    occurred_at: new Date().toISOString(),
    ...payload,
  };
  io.to(room).emit('notifications:item', body);
}
