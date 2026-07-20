import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import jwt from 'jsonwebtoken';
import mongoose, { isValidObjectId } from 'mongoose';
import User from '../../models/User.js';
import ProfessionalChatThread from '../../models/ProfessionalChatThread.js';
import ProfessionalChatMessage from '../../models/ProfessionalChatMessage.js';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import logger from '../../utils/logger.js';
import { normalizeAttachments, validateProChatAttachmentLimits } from '../../utils/proChatUtils.js';
import {
  declineCall,
  endCall,
  leaveCall,
  markCallActive,
  markCallInvited,
} from '../proChat/callRegistry.js';
import {
  scheduleCallRoomCleanup,
  startCallRoomCleanupReconciliation,
} from '../proChat/liveKitRoomService.js';
import { scheduleTranscriptionWorkerDispatch } from '../proChat/callTranscriptionDispatchService.js';

let io = null;
const recentCallEvents = new Map();
let socketRateIndexPromise = null;
async function assertSharedCallEventRate(userId, eventName, threadId) {
  const key = `${String(userId)}:${eventName}:${String(threadId || '')}`;
  const now = Date.now();
  const entry = recentCallEvents.get(key) || { lastAt: 0, windowAt: now, count: 0 };
  if (now - entry.windowAt >= 60_000) {
    entry.windowAt = now;
    entry.count = 0;
  }
  if (now - entry.lastAt < 750 || entry.count >= 20) {
    const error = new Error('call_action_rate_limited');
    error.code = 'call_action_rate_limited';
    throw error;
  }
  entry.lastAt = now;
  entry.count += 1;
  recentCallEvents.set(key, entry);
  if (recentCallEvents.size > 10_000) {
    for (const [storedKey, stored] of recentCallEvents) {
      if (now - stored.windowAt > 120_000) recentCallEvents.delete(storedKey);
    }
  }
  if (mongoose.connection.readyState === 1) {
    const collection = mongoose.connection.collection('socket_call_rate_limits');
    socketRateIndexPromise ||= collection
      .createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
      .catch(() => null);
    const minuteBucket = Math.floor(now / 60_000);
    const shared = await collection.findOneAndUpdate(
      { _id: `${key}:${minuteBucket}` },
      {
        $inc: { count: 1 },
        $setOnInsert: { expires_at: new Date(now + 120_000) },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (Number(shared?.count || shared?.value?.count || 0) > 20) {
      const error = new Error('call_action_rate_limited');
      error.code = 'call_action_rate_limited';
      throw error;
    }
  }
}

function userRoom(userId) {
  return `user:${String(userId)}`;
}
function proChatRoom(threadId) {
  return `prochat:${String(threadId)}`;
}

function normalizeCallRoomName(threadId, value) {
  const base = proChatRoom(threadId);
  const roomName = String(value || '').trim();
  if (roomName === base) return roomName; // Backward compatibility for an in-flight legacy call.
  if (roomName.startsWith(`${base}:`)) {
    const callId = roomName.slice(base.length + 1);
    if (/^[a-zA-Z0-9_-]{8,128}$/.test(callId)) return roomName;
  }
  const error = new Error('invalid_call_room');
  error.code = 'invalid_call_room';
  throw error;
}

function normalizeCallType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'voice' || normalized === 'video') return normalized;
  const error = new Error('invalid_call_type');
  error.code = 'invalid_call_type';
  throw error;
}

function normalizeHandshakeToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let t = raw.trim();
  if (t.toLowerCase().startsWith('bearer ')) t = t.slice(7).trim();
  return t || null;
}
function parseOrigins() {
  const raw =
    process.env.CLIENT_ORIGIN ||
    process.env.SOCKET_CORS_ORIGIN ||
    process.env.FRONTEND_URL ||
    '';
  if (!raw.trim()) return process.env.NODE_ENV !== 'production';
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

export async function initWorkspaceSocket(httpServer) {
  if (io) return io;
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required to initialize Workspace Socket.IO');
  }
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: parseOrigins(),
      credentials: true,
    },
  });
  const adapterCollection = mongoose.connection.db.collection('socket_io_adapter_events');
  await adapterCollection.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 60 * 60, background: true },
  );
  io.adapter(createAdapter(adapterCollection, { addCreatedAtField: true }));
  startCallRoomCleanupReconciliation();
  io.use(async (socket, next) => {
    try {
      const token = normalizeHandshakeToken(
        socket.handshake.auth?.token || null
      );
      if (!token) {
        return next(new Error('auth_required'));
      }
      const decoded = jwt.verify(token, jwtSecret);
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
    void (async () => {
      // Replay unanswered rings, including mid-call reinvites while the room is active.
      const pendingInvites = await ProfessionalCall.find({
        participant_ids: uid,
        caller_id: { $ne: uid },
        status: { $in: ['ringing', 'connecting', 'active'] },
        expires_at: { $gt: new Date() },
        participant_states: {
          $elemMatch: {
            user_id: uid,
            status: 'invited',
          },
        },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      const callerIds = [...new Set(pendingInvites.map((call) => String(call.caller_id)))];
      const callers = await User.find({ _id: { $in: callerIds } })
        .select('first_name last_name email')
        .lean();
      const callerById = new Map(callers.map((caller) => [String(caller._id), caller]));
      for (const call of pendingInvites) {
        const caller = callerById.get(String(call.caller_id));
        const myState = (call.participant_states || []).find(
          (participant) => String(participant?.user_id || '') === String(uid),
        );
        const inviteOccurredAt = myState?.invited_at
          ? new Date(myState.invited_at).toISOString()
          : new Date().toISOString();
        socket.emit('prochat:call_invite', {
          schema: 2,
          call_id: String(call._id),
          thread_id: String(call.thread_id),
          room_name: call.room_name,
          call_type: call.call_type,
          call_status: call.status,
          call_scope: call.call_scope || 'direct',
          participant_ids: call.participant_ids || [],
          participant_states: call.participant_states || [],
          transcription_status: call.transcription_status || 'pending',
          minutes_status: call.minutes_status || 'not_ready',
          user_id: String(call.caller_id),
          sender_name:
            [caller?.first_name, caller?.last_name].filter(Boolean).join(' ').trim() ||
            caller?.email ||
            'Participant',
          occurred_at: inviteOccurredAt,
          replayed: true,
        });
      }
    })().catch((error) => {
      logger.warn('Could not reconcile calls after socket reconnect', {
        user_id: uid,
        message: error?.message,
      });
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
    const assertCallEventRate = async (eventName, threadId) => {
      await assertSharedCallEventRate(uid, eventName, threadId);
    };

    const assertThreadMembership = async (threadId) => {
      const tid = String(threadId || '').trim();
      if (!tid) {
        const err = new Error('missing_thread_id');
        err.code = 'missing_thread_id';
        throw err;
      }
      if (!isValidObjectId(tid)) {
        const err = new Error('invalid_thread_id');
        err.code = 'invalid_thread_id';
        throw err;
      }
      const thread = await ProfessionalChatThread.findById(tid)
        .select('participants participants_key thread_type')
        .lean();
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
        const { thread_id, body, client_id, attachments } = payload || {};
        const text = String(body || '').trim();
        if (text.length > 5000) {
          const err = new Error('message_too_long');
          err.code = 'message_too_long';
          throw err;
        }
        const attsRaw = Array.isArray(attachments) ? attachments : [];
        if (!text && attsRaw.length < 1) {
          const err = new Error('empty_message');
          err.code = 'empty_message';
          throw err;
        }
        const atts = normalizeAttachments(attsRaw);
        if (atts.length !== attsRaw.length) {
          const err = new Error('invalid_attachments');
          err.code = 'invalid_attachments';
          throw err;
        }
        const attachmentLimit = validateProChatAttachmentLimits(atts);
        if (!attachmentLimit.ok) {
          const err = new Error(attachmentLimit.message);
          err.code = attachmentLimit.code;
          throw err;
        }
        const { participants, thread } = await assertThreadMembership(thread_id);
        const participantsKey = String(thread?.participants_key || '');
        const isLeadThread = participantsKey.startsWith('lead:');
        const leadId = isLeadThread ? (participantsKey.split(':')[1] || null) : null;
        const msg = await ProfessionalChatMessage.create({
          thread_id,
          sender_user_id: uid,
          client_id: client_id ? String(client_id).slice(0, 128) : null,
          body: text,
          attachments: atts,
        });
        await ProfessionalChatThread.updateOne(
          { _id: thread_id },
          {
            $set: {
              last_message_at: msg.createdAt,
              last_message_text: text ? text.slice(0, 280) : (atts.length === 1 ? 'Attachment' : 'Attachments'),
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
          attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
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
            is_lead_thread: isLeadThread,
            lead_id: leadId,
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

    socket.on('prochat:call_invite', async (payload, ack) => {
      try {
        const { thread_id, room_name, call_type, target_user_id } = payload || {};
        await assertCallEventRate('invite', thread_id);
        const { participants, thread } = await assertThreadMembership(thread_id);
        const participantsKey = String(thread?.participants_key || '');
        const isLeadThread = participantsKey.startsWith('lead:');
        const leadId = isLeadThread ? (participantsKey.split(':')[1] || null) : null;
        const normalizedRoomName = normalizeCallRoomName(thread_id, room_name);
        const normalizedCallType = normalizeCallType(call_type);
        const registryResult = await markCallInvited({
          threadId: thread_id,
          roomName: normalizedRoomName,
          callerId: uid,
          callType: normalizedCallType,
          targetUserId: target_user_id,
          currentParticipantIds: participants,
        });
        if (!registryResult.ok) {
          const error = new Error(registryResult.message);
          error.code = registryResult.code;
          throw error;
        }
        if (registryResult.call?.call_type !== normalizedCallType) {
          const error = new Error('call_type_mismatch');
          error.code = 'call_type_mismatch';
          throw error;
        }
        const sender = await User.findById(uid).select('first_name last_name email').lean();
        const senderName =
          [sender?.first_name, sender?.last_name].filter(Boolean).join(' ').trim() ||
          sender?.email ||
          'Participant';
        const inviteOccurredAt = (() => {
          const inviteeId = String(
            target_user_id || (registryResult.invitee_ids || [])[0] || '',
          );
          const state = (registryResult.call?.participant_states || []).find(
            (participant) => String(participant?.user_id || '') === inviteeId,
          );
          if (state?.invited_at) return new Date(state.invited_at).toISOString();
          return new Date().toISOString();
        })();
        const body = {
          schema: 2,
          call_id: registryResult.call.call_id,
          thread_id: String(thread_id),
          room_name: normalizedRoomName,
          call_type: registryResult.call.call_type,
          call_status: registryResult.call?.status || 'ringing',
          call_scope: registryResult.call?.call_scope || 'direct',
          participant_ids: registryResult.call?.participant_ids || [],
          participant_states: registryResult.call?.participant_states || [],
          transcription_policy_version:
            registryResult.call?.transcription_policy_version || '1',
          transcription_status: registryResult.call?.transcription_status || 'pending',
          minutes_status: registryResult.call?.minutes_status || 'not_ready',
          invitee_ids: registryResult.invitee_ids || [],
          target_user_id: target_user_id ? String(target_user_id) : null,
          user_id: String(uid),
          sender_name: senderName,
          // Prefer DB invited_at so reinvites always outrank a prior local "handled" stamp.
          occurred_at: inviteOccurredAt,
        };
        for (const pid of registryResult.invitee_ids || []) {
          io.to(userRoom(pid)).emit('prochat:call_invite', body);
          io.to(userRoom(pid)).emit('prochat:inbox', {
            schema: 2,
            occurred_at: body.occurred_at,
            thread_id: String(thread_id),
            is_lead_thread: isLeadThread,
            lead_id: leadId,
            kind: 'call_invite',
            call: body,
          });
        }
        safeAck(ack, { success: true, call: body });
      } catch (e) {
        safeAck(ack, { success: false, code: e.code || 'call_invite_failed', message: e.message });
      }
    });

    socket.on('prochat:call_active', async (payload, ack) => {
      const activationStartedAt = Date.now();
      try {
        const { thread_id, room_name, call_type } = payload || {};
        await assertCallEventRate('active', thread_id);
        await assertThreadMembership(thread_id);
        const normalizedRoomName = normalizeCallRoomName(thread_id, room_name);
        const normalizedCallType = normalizeCallType(call_type);
        const registryResult = await markCallActive({
          threadId: thread_id,
          roomName: normalizedRoomName,
          userId: uid,
          callType: normalizedCallType,
        });
        if (!registryResult.ok) {
          const error = new Error(registryResult.message);
          error.code = registryResult.code;
          throw error;
        }
        scheduleTranscriptionWorkerDispatch(registryResult.call.call_id);
        const body = {
          schema: 2,
          call_id: registryResult.call.call_id,
          thread_id: String(thread_id),
          room_name: normalizedRoomName,
          call_type: registryResult.call.call_type,
          call_status: registryResult.call.status,
          call_scope: registryResult.call.call_scope || 'direct',
          participant_ids: registryResult.call.participant_ids || [],
          participant_states: registryResult.call.participant_states || [],
          transcription_policy_version:
            registryResult.call.transcription_policy_version || '1',
          transcription_status: registryResult.call.transcription_status,
          transcription_error_code:
            registryResult.call.transcription_error_code || '',
          minutes_status: registryResult.call.minutes_status || 'not_ready',
          user_id: String(uid),
          participant_status: 'joined',
          occurred_at: new Date().toISOString(),
        };
        for (const pid of registryResult.call.participant_ids || []) {
          if (String(pid) === String(uid)) continue;
          io.to(userRoom(pid)).emit('prochat:call_participant', body);
        }
        logger.info('Call media activation completed', {
          call_id: registryResult.call.call_id,
          room_name: normalizedRoomName,
          elapsed_ms: Date.now() - activationStartedAt,
        });
        safeAck(ack, { success: true, call: registryResult.call });
      } catch (e) {
        logger.warn('Call media activation did not complete', {
          room_name: String(payload?.room_name || ''),
          code: e.code || 'call_active_failed',
          elapsed_ms: Date.now() - activationStartedAt,
        });
        safeAck(ack, {
          success: false,
          code: e.code || 'call_active_failed',
          message: e.message,
        });
      }
    });

    socket.on('prochat:call_decline', async (payload, ack) => {
      try {
        const { thread_id, room_name } = payload || {};
        await assertCallEventRate('decline', thread_id);
        const { participants, thread } = await assertThreadMembership(thread_id);
        const participantsKey = String(thread?.participants_key || '');
        const isLeadThread = participantsKey.startsWith('lead:');
        const leadId = isLeadThread ? (participantsKey.split(':')[1] || null) : null;
        const normalizedRoomName = normalizeCallRoomName(thread_id, room_name);
        const registryResult = await declineCall({
          threadId: thread_id,
          roomName: normalizedRoomName,
          userId: uid,
        });
        if (!registryResult.ok) {
          const error = new Error(registryResult.message);
          error.code = registryResult.code;
          throw error;
        }
        const body = {
          schema: 2,
          call_id: registryResult.call.call_id,
          thread_id: String(thread_id),
          room_name: normalizedRoomName,
          call_type: registryResult.call.call_type,
          call_status: registryResult.call.status,
          call_scope: registryResult.call.call_scope || 'direct',
          participant_ids: registryResult.call.participant_ids || [],
          participant_states: registryResult.call.participant_states || [],
          transcription_policy_version:
            registryResult.call.transcription_policy_version || '1',
          transcription_status: registryResult.call.transcription_status || 'pending',
          minutes_status: registryResult.call.minutes_status || 'not_ready',
          user_id: String(uid),
          participant_status: 'declined',
          terminal: registryResult.terminal !== false,
          occurred_at: new Date().toISOString(),
        };
        const eventName =
          registryResult.call.call_scope === 'multiparty'
            ? 'prochat:call_participant'
            : 'prochat:call_decline';
        for (const pid of registryResult.call.participant_ids || participants) {
          if (String(pid) === String(uid)) continue;
          io.to(userRoom(pid)).emit(eventName, body);
          io.to(userRoom(pid)).emit('prochat:inbox', {
            schema: 2,
            occurred_at: body.occurred_at,
            thread_id: String(thread_id),
            is_lead_thread: isLeadThread,
            lead_id: leadId,
            kind: 'call_decline',
            call: body,
          });
        }
        safeAck(ack, { success: true, call: body });
        if (body.terminal) scheduleCallRoomCleanup(normalizedRoomName);
      } catch (e) {
        safeAck(ack, { success: false, code: e.code || 'call_decline_failed', message: e.message });
      }
    });

    socket.on('prochat:call_leave', async (payload, ack) => {
      try {
        const { thread_id, room_name } = payload || {};
        try {
          await assertCallEventRate('leave', thread_id);
        } catch (rateError) {
          if (rateError?.code === 'call_action_rate_limited') {
            // Duplicate leave/end from multi-tab close — treat as confirmed.
            safeAck(ack, { success: true, code: 'call_action_rate_limited' });
            return;
          }
          throw rateError;
        }
        await assertThreadMembership(thread_id);
        const normalizedRoomName = normalizeCallRoomName(thread_id, room_name);
        const registryResult = await leaveCall({
          threadId: thread_id,
          roomName: normalizedRoomName,
          userId: uid,
        });
        if (!registryResult.ok) {
          const error = new Error(registryResult.message);
          error.code = registryResult.code;
          throw error;
        }
        const body = {
          schema: 2,
          call_id: registryResult.call.call_id,
          thread_id: String(thread_id),
          room_name: normalizedRoomName,
          call_type: registryResult.call.call_type,
          call_status: registryResult.call.status,
          call_scope: registryResult.call.call_scope || 'direct',
          participant_ids: registryResult.call.participant_ids || [],
          participant_states: registryResult.call.participant_states || [],
          transcription_policy_version:
            registryResult.call.transcription_policy_version || '1',
          transcription_status: registryResult.call.transcription_status || 'pending',
          minutes_status: registryResult.call.minutes_status || 'not_ready',
          user_id: String(uid),
          participant_status: registryResult.action === 'left' ? 'left' : null,
          terminal: registryResult.terminal !== false,
          occurred_at: new Date().toISOString(),
        };
        const eventName = body.terminal ? 'prochat:call_ended' : 'prochat:call_participant';
        for (const pid of registryResult.call.participant_ids || []) {
          if (String(pid) === String(uid)) continue;
          io.to(userRoom(pid)).emit(eventName, body);
        }
        safeAck(ack, { success: true, call: body });
        if (body.terminal) scheduleCallRoomCleanup(normalizedRoomName);
      } catch (e) {
        safeAck(ack, { success: false, code: e.code || 'call_leave_failed', message: e.message });
      }
    });

    socket.on('prochat:call_ended', async (payload, ack) => {
      try {
        const { thread_id, room_name } = payload || {};
        try {
          await assertCallEventRate('ended', thread_id);
        } catch (rateError) {
          if (rateError?.code === 'call_action_rate_limited') {
            // Duplicate end from pagehide + UI close (or multi-tab) — already closing.
            safeAck(ack, { success: true, code: 'call_action_rate_limited' });
            return;
          }
          throw rateError;
        }
        const { participants, thread } = await assertThreadMembership(thread_id);
        const participantsKey = String(thread?.participants_key || '');
        const isLeadThread = participantsKey.startsWith('lead:');
        const leadId = isLeadThread ? (participantsKey.split(':')[1] || null) : null;
        const normalizedRoomName = normalizeCallRoomName(thread_id, room_name);
        const registryResult = await endCall({
          threadId: thread_id,
          roomName: normalizedRoomName,
          userId: uid,
        });
        if (!registryResult.ok) {
          const error = new Error(registryResult.message);
          error.code = registryResult.code;
          throw error;
        }
        const body = {
          schema: 2,
          call_id: registryResult.call.call_id,
          thread_id: String(thread_id),
          room_name: normalizedRoomName,
          call_type: registryResult.call.call_type,
          call_status: registryResult.call.status,
          call_scope: registryResult.call.call_scope || 'direct',
          participant_ids: registryResult.call.participant_ids || [],
          participant_states: registryResult.call.participant_states || [],
          transcription_policy_version:
            registryResult.call.transcription_policy_version || '1',
          transcription_status: registryResult.call.transcription_status || 'pending',
          minutes_status: registryResult.call.minutes_status || 'not_ready',
          user_id: String(uid),
          participant_status: registryResult.action === 'left' ? 'left' : null,
          terminal: registryResult.terminal !== false,
          occurred_at: new Date().toISOString(),
        };
        const eventName = body.terminal ? 'prochat:call_ended' : 'prochat:call_participant';
        for (const pid of registryResult.call.participant_ids || participants) {
          if (String(pid) === String(uid)) continue;
          io.to(userRoom(pid)).emit(eventName, body);
          io.to(userRoom(pid)).emit('prochat:inbox', {
            schema: 2,
            occurred_at: body.occurred_at,
            thread_id: String(thread_id),
            is_lead_thread: isLeadThread,
            lead_id: leadId,
            kind: body.terminal ? 'call_ended' : 'call_participant',
            call: body,
          });
        }
        safeAck(ack, { success: true, call: body });
        if (body.terminal) scheduleCallRoomCleanup(normalizedRoomName);
      } catch (e) {
        safeAck(ack, { success: false, code: e.code || 'call_end_failed', message: e.message });
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

export function emitCallAccepted(callerId, payload) {
  const normalizedCallerId = String(callerId || '').trim();
  if (!io || !normalizedCallerId) return false;
  io.to(userRoom(normalizedCallerId)).emit('prochat:call_accepted', {
    schema: 2,
    occurred_at: new Date().toISOString(),
    ...payload,
  });
  return true;
}

export function emitCallArtifactsReady(participantIds, payload) {
  if (!io) return false;
  const body = {
    schema: 1,
    occurred_at: new Date().toISOString(),
    ...payload,
  };
  for (const participantId of [...new Set((participantIds || []).map(String))]) {
    if (participantId) io.to(userRoom(participantId)).emit('prochat:call_artifacts_ready', body);
  }
  return true;
}

export function emitCallTerminal(participantIds, payload) {
  if (!io) return false;
  const body = {
    schema: 1,
    occurred_at: new Date().toISOString(),
    ...payload,
  };
  for (const participantId of [...new Set((participantIds || []).map(String))]) {
    if (participantId) io.to(userRoom(participantId)).emit('prochat:call_ended', body);
  }
  return true;
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
