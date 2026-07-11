import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import User from '../../models/User.js';
import { assertThreadMembership } from './accessService.js';
import { displayName } from '../../utils/proChatUtils.js';

// Tokens only authorize joining; keep the window short so removed members
// cannot reuse an old token hours after a call has ended.
const TOKEN_TTL_SECONDS = 60 * 15;

function getLiveKitConfig() {
  return {
    url: String(process.env.LIVEKIT_URL || '').trim(),
    apiKey: String(process.env.LIVEKIT_API_KEY || '').trim(),
    apiSecret: String(process.env.LIVEKIT_API_SECRET || '').trim(),
  };
}

function resolveCallType(rawValue) {
  return String(rawValue || '').trim().toLowerCase() === 'video' ? 'video' : 'voice';
}

function roomNameForThread(threadId, requestedRoomName = '') {
  const base = `prochat:${String(threadId || '').trim()}`;
  const requested = String(requestedRoomName || '').trim();
  if (requested.startsWith(`${base}:`)) {
    const callId = requested.slice(base.length + 1);
    if (/^[a-zA-Z0-9_-]{8,128}$/.test(callId)) return requested;
  }
  return `${base}:${randomUUID()}`;
}

function liveKitConfigured(config = getLiveKitConfig()) {
  return Boolean(config.url && config.apiKey && config.apiSecret);
}

export async function createCallTokenForThread({
  currentUserId,
  threadId,
  callType,
  roomName: requestedRoomName,
}) {
  const check = await assertThreadMembership(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };

  const livekit = getLiveKitConfig();
  if (!liveKitConfigured(livekit)) {
    return {
      status: 503,
      body: {
        success: false,
        message: 'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
      },
    };
  }

  const roomName = roomNameForThread(threadId, requestedRoomName);
  if (!roomName || !String(threadId || '').trim()) {
    return { status: 400, body: { success: false, message: 'Invalid thread id' } };
  }

  const user = await User.findById(currentUserId).select('first_name last_name email').lean();
  const identity = String(currentUserId);
  const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity,
    name: displayName(user, identity),
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  return {
    status: 200,
    body: {
      success: true,
      url: livekit.url,
      token: await token.toJwt(),
      room_name: roomName,
      call_type: resolveCallType(callType),
    },
  };
}

