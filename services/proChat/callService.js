import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import User from '../../models/User.js';
import logger from '../../utils/logger.js';
import { assertThreadMembership } from './accessService.js';
import {
  authorizeCallJoin,
  createPendingCall,
  recheckCallJoin,
} from './callRegistry.js';
import { ensureTranscriptionForActiveCall } from './callTranscriptionDispatchService.js';
import { callScopeForThread, supportsCall } from './callPolicy.js';
import { displayName } from '../../utils/proChatUtils.js';
import { emitCallAccepted } from '../realtime/workspaceSocket.js';

// Tokens only authorize joining; keep the window short so removed members
// cannot reuse an old token hours after a call has ended.
// Must outlast video preview (50s) plus ICE/connect headroom.
const TOKEN_TTL_SECONDS = 180;

function getLiveKitConfig() {
  return {
    url: String(process.env.LIVEKIT_URL || '').trim(),
    apiKey: String(process.env.LIVEKIT_API_KEY || '').trim(),
    apiSecret: String(process.env.LIVEKIT_API_SECRET || '').trim(),
  };
}

function resolveCallType(rawValue) {
  const value = String(rawValue || 'voice').trim().toLowerCase();
  return value === 'voice' || value === 'video' ? value : '';
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
  action,
  transcriptionConsent,
}) {
  if (typeof transcriptionConsent !== 'boolean') {
    return {
      status: 400,
      body: {
        success: false,
        code: 'transcription_consent_choice_required',
        message: 'An explicit transcription consent choice is required before joining the call.',
        transcription_policy_version:
          String(process.env.CALL_TRANSCRIPTION_CONSENT_VERSION || '1').trim() || '1',
      },
    };
  }
  const check = await assertThreadMembership(threadId, currentUserId);
  if (check.status !== 200) return { status: check.status, body: check.body };
  if (!supportsCall(check.thread, check.participants)) {
    return {
      status: 400,
      body: { success: false, message: 'This conversation cannot start a call.' },
    };
  }

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

  const normalizedCallType = resolveCallType(callType);
  if (!normalizedCallType) {
    return { status: 400, body: { success: false, message: 'Invalid call type' } };
  }

  const normalizedAction = String(action || '').trim().toLowerCase();
  if (normalizedAction !== 'start' && normalizedAction !== 'join') {
    return { status: 400, body: { success: false, message: 'Invalid call action' } };
  }
  const roomName =
    normalizedAction === 'start'
      ? roomNameForThread(threadId)
      : roomNameForThread(threadId, requestedRoomName);
  if (!roomName || !String(threadId || '').trim()) {
    return { status: 400, body: { success: false, message: 'Invalid thread id' } };
  }

  const userPromise = User.findById(currentUserId)
    .select('first_name last_name email profile_image')
    .lean();

  const registryResult =
    normalizedAction === 'start'
      ? await createPendingCall({
          threadId,
          roomName,
          callerId: currentUserId,
          callType: normalizedCallType,
          participantIds: check.participants,
          callScope: callScopeForThread(check.thread, check.participants),
          transcriptionConsent,
        })
      : await authorizeCallJoin({
          threadId,
          roomName: requestedRoomName,
          userId: currentUserId,
          callType: normalizedCallType,
          transcriptionConsent,
        });
  if (!registryResult.ok) {
    return {
      status: registryResult.status,
      body: {
        success: false,
        code: registryResult.code,
        message: registryResult.message,
      },
    };
  }
  const effectiveCallType = String(registryResult.call?.call_type || '');
  const effectiveRoomName = String(registryResult.call?.room_name || '');
  if (effectiveCallType !== normalizedCallType) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'call_type_mismatch',
        message: 'The call type does not match the active call.',
      },
    };
  }

  const user = await userPromise;
  const userId = String(currentUserId);
  const callId = String(registryResult.call?.call_id || '');
  const identity = userId;
  const participantState = (registryResult.call?.participant_states || []).find(
    (participant) => String(participant.user_id) === userId,
  );
  const consentVersion =
    participantState?.transcription_consent_version ||
    registryResult.call?.transcription_policy_version ||
    '1';
  const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity,
    name: displayName(user, userId),
    metadata: JSON.stringify({
      user_id: userId,
      call_id: callId,
      profile_image: String(user?.profile_image || '').trim() || null,
      transcription_consent: participantState?.transcription_consent === true,
      transcription_consent_version: consentVersion,
      transcription_policy_version: registryResult.call?.transcription_policy_version || '1',
    }),
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    roomJoin: true,
    room: effectiveRoomName,
    canPublish: true,
    canPublishSources:
      effectiveCallType === 'video'
        ? [
            TrackSource.MICROPHONE,
            TrackSource.CAMERA,
            TrackSource.SCREEN_SHARE,
            TrackSource.SCREEN_SHARE_AUDIO,
          ]
        : [TrackSource.MICROPHONE],
    canPublishData: true,
    canSubscribe: true,
  });

  const jwt = await token.toJwt();
  const finalState = await recheckCallJoin({
    threadId,
    roomName: effectiveRoomName,
    userId: currentUserId,
    callType: effectiveCallType,
  });
  if (!finalState.ok) {
    return {
      status: finalState.status,
      body: {
        success: false,
        code: finalState.code,
        message: finalState.message,
      },
    };
  }
  const callerId = String(finalState.call?.caller_id || '');
  if (
    normalizedAction === 'join' &&
    finalState.call?.call_scope !== 'multiparty' &&
    finalState.call?.status === 'connecting' &&
    callerId &&
    callerId !== userId
  ) {
    emitCallAccepted(callerId, {
      call_id: callId,
      thread_id: String(threadId),
      room_name: effectiveRoomName,
      call_type: effectiveCallType,
      call_status: 'connecting',
      call_scope: 'direct',
      participant_ids: finalState.call?.participant_ids || [],
      participant_states: finalState.call?.participant_states || [],
      transcription_status: finalState.call?.transcription_status || 'pending',
      minutes_status: finalState.call?.minutes_status || 'not_ready',
      user_id: userId,
      participant_status: 'accepted',
    });
  }
  if (
    ['connecting', 'active'].includes(String(finalState.call?.status || '')) &&
    (finalState.call?.participant_states || []).some(
      (participant) => participant.transcription_consent === true,
    )
  ) {
    void ensureTranscriptionForActiveCall({
      ...finalState.call,
      call_id: callId,
      status: finalState.call?.status,
    }).catch((error) => {
      logger.warn('Transcription dispatch failed during call token issue', {
        call_id: callId,
        message: error?.message,
      });
    });
  }

  return {
    status: 200,
    body: {
      success: true,
      url: livekit.url,
      token: jwt,
      call_id: callId,
      room_name: effectiveRoomName,
      call_type: effectiveCallType,
      call_status: finalState.call?.status || '',
      call_scope: finalState.call?.call_scope || 'direct',
      participant_states: finalState.call?.participant_states || [],
      transcription_consent: participantState?.transcription_consent === true,
      transcription_consent_recorded_at:
        participantState?.transcription_consent_recorded_at || null,
      transcription_consent_version: consentVersion,
      transcription_policy_version:
        finalState.call?.transcription_policy_version || '1',
      transcription_status: finalState.call?.transcription_status || 'pending',
      minutes_status: finalState.call?.minutes_status || 'not_ready',
    },
  };
}

