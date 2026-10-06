import { randomUUID } from 'node:crypto';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ClientProfile from '../../models/ClientProfile.js';
import User from '../../models/User.js';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import logger from '../../utils/logger.js';
import { fail, ok } from '../admin/adminCommon.js';
import { recordAdminAudit } from '../admin/adminAuditService.js';
import { CALL_PROVIDERS, twilioVoiceEnabled, voiceAgentEnabled, voiceRecordingEnabled } from './callProviders.js';
import { isPrivateRecordingsConfigured } from '../media/r2Client.js';
import { emitMayaIncomingCall } from '../realtime/workspaceSocket.js';
import { ingestFinalTranscriptSegment } from './transcriptSegmentService.js';
import { handleVoiceGather } from './voiceAgentTurnService.js';
import { dispatchRaviAgent } from './raviAgentDispatchService.js';
import { normalizeE164, pickSalesPhone } from './voicePhone.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { TERMINAL_RETENTION_MS } from './callRegistryShared.js';

const ACTIVE_TTL_MS = 2 * 60 * 60 * 1000;

function text(value) {
  return String(value || '').trim();
}

function twilioConfig() {
  return {
    accountSid: text(process.env.TWILIO_ACCOUNT_SID),
    authToken: text(process.env.TWILIO_AUTH_TOKEN),
    from: text(process.env.TWILIO_FROM_NUMBER),
    webhookBase: text(process.env.TWILIO_WEBHOOK_BASE_URL).replace(/\/+$/, ''),
  };
}

export function twilioConfigured(config = twilioConfig()) {
  return Boolean(config.accountSid && config.authToken && config.from && config.webhookBase);
}

export function agentVoice(value) {
  return value === 'female' ? 'female' : 'male';
}

export function spokenGreeting() {
  return 'Hi, I am Ravi from Nesti, and I am glad we connected. People use Nesti to track the goal, plan the money, and get matched with the right professional. What are you hoping to get done?';
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildVoiceTwiml({ callId, say, done = false }) {
  const polly = 'Polly.Matthew';
  const message = xmlEscape(say || 'Hello, this is Ravi from Nesti. I can walk you through the tools and the plan that fits your work.');
  const action = `${text(process.env.TWILIO_WEBHOOK_BASE_URL).replace(/\/+$/, '')}/api/webhooks/twilio/gather?callId=${encodeURIComponent(callId)}`;
  const sayTag = `<Say voice="${polly}" language="en-US">${message}</Say>`;
  if (done) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${sayTag}<Hangup/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${sayTag}<Gather input="speech" language="en-US" speechTimeout="auto" actionOnEmptyResult="true" action="${xmlEscape(action)}" method="POST"/></Response>`;
}

async function leadPhone(lead) {
  const profile = lead?.lead_profile_id
    ? await LeadProfile.findById(lead.lead_profile_id).select('identity.phone identity.canonical_phone').lean()
    : null;
  const inquirerId = lead?.compatibility_factors?.client_user_id;
  const inquirer = inquirerId
    ? await User.findById(inquirerId).select('phone').lean()
    : null;
  return text(profile?.identity?.phone || profile?.identity?.canonical_phone || inquirer?.phone);
}

async function clientPipelineLeadIds(userId) {
  if (!userId) return [];
  const leads = await LeadMatch.find({
    'compatibility_factors.client_user_id': userId,
    match_status: { $nin: ['converted', 'closed_lost'] },
  })
    .select('_id')
    .limit(20)
    .lean();
  return leads.map((lead) => String(lead._id));
}

async function loadTarget({ targetType, targetId }) {
  if (targetType === 'lead') {
    const lead = await LeadMatch.findById(targetId).lean();
    if (!lead) return { error: fail(404, 'Lead not found') };
    return { lead, phone: await leadPhone(lead), leadIds: [String(lead._id)], label: 'lead' };
  }
  if (targetType === 'sales') {
    const inquiry = await EnterpriseInquiry.findById(targetId).lean();
    if (!inquiry) return { error: fail(404, 'Sales lead not found') };
    const user = inquiry.user_id ? await User.findById(inquiry.user_id).select('phone').lean() : null;
    const profile = inquiry.user_id
      ? await ProfessionalProfile.findOne({ user_id: inquiry.user_id }).select('phone').lean()
      : null;
    return {
      phone: pickSalesPhone({
        inquiryPhone: inquiry.phone,
        profilePhone: profile?.phone,
        userPhone: user?.phone,
      }),
      leadIds: [],
      label: 'sales',
      role: inquiry.interest_role || '',
    };
  }
  const client = await ClientProfile.findById(targetId).populate('user_id', 'phone first_name last_name email').lean();
  if (!client) return { error: fail(404, 'Client not found') };
  const userId = client.user_id?._id || client.user_id;
  return {
    client,
    phone: text(client.user_id?.phone),
    leadIds: await clientPipelineLeadIds(userId),
    label: 'client',
  };
}

export async function startAdminVoiceCall({
  actorUser,
  targetType,
  targetId,
  toPhone,
  transcriptionConsent,
  voice,
  fetchImpl = fetch,
}) {
  if (!twilioVoiceEnabled()) return fail(503, 'Voice agent is disabled');
  if (transcriptionConsent !== true) {
    return fail(400, 'Recording and transcription consent is required');
  }
  if (!['lead', 'client', 'sales'].includes(targetType)) return fail(400, 'Invalid voice target');
  const config = twilioConfig();
  if (!twilioConfigured(config)) return fail(503, 'Twilio is not configured');
  const loaded = await loadTarget({ targetType, targetId });
  if (loaded.error) return loaded.error;
  const destination = normalizeE164(toPhone) || loaded.phone;
  if (!destination) return fail(400, 'A destination phone number is required');

  const roomName = `twilio:${targetType}:${targetId}:${randomUUID()}`;
  const threadId = `admin-voice:${targetType}:${targetId}`;
  const actorId = String(actorUser?._id || actorUser?.id || '');
  const now = new Date();
  const call = await ProfessionalCall.create({
    room_name: roomName,
    thread_id: threadId,
    active_thread_key: `${threadId}:live`,
    caller_id: actorId || 'voice-agent',
    participant_ids: [actorId || 'voice-agent'],
    participant_states: [{
      user_id: actorId || 'voice-agent',
      status: 'joined',
      joined_at: now,
      transcription_consent: true,
      transcription_consented_at: now,
      transcription_consent_recorded_at: now,
      transcription_consent_version: '1',
    }],
    call_scope: 'direct',
    call_type: 'voice',
    provider: CALL_PROVIDERS.TWILIO,
    voice_target_type: targetType,
    voice_target_id: String(targetId),
    voice_to_phone: destination,
    voice_agent_voice: agentVoice(voice),
    voice_lead_ids: loaded.leadIds || [],
    transcription_policy_version: '1',
    transcription_status: 'pending',
    minutes_status: 'not_ready',
    recording_status: voiceRecordingEnabled() ? 'pending' : 'not_requested',
    status: 'connecting',
    connecting_at: now,
    expires_at: new Date(Date.now() + ACTIVE_TTL_MS),
    delete_at: new Date(Date.now() + ACTIVE_TTL_MS + TERMINAL_RETENTION_MS),
  });

  const voiceUrl = `${config.webhookBase}/api/webhooks/twilio/voice?callId=${call._id}`;
  const statusUrl = `${config.webhookBase}/api/webhooks/twilio/status?callId=${call._id}`;
  const recordingUrl = `${config.webhookBase}/api/webhooks/twilio/recording?callId=${call._id}`;
  const body = new URLSearchParams({
    To: destination,
    From: config.from,
    Url: voiceUrl,
    Method: 'POST',
    StatusCallback: statusUrl,
    StatusCallbackMethod: 'POST',
    Record: voiceRecordingEnabled() ? 'true' : 'false',
    RecordingStatusCallback: recordingUrl,
    RecordingStatusCallbackMethod: 'POST',
  });
  ['initiated', 'ringing', 'answered', 'completed'].forEach((eventName) => body.append('StatusCallbackEvent', eventName));
  let response;
  try {
    response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch (error) {
    await ProfessionalCall.updateOne(
      { _id: call._id },
      { $set: { ...terminalVoiceUpdate(call), transcription_error_code: 'twilio_create_failed', transcription_error_message: text(error?.message).slice(0, 500) } },
    );
    return fail(502, 'Twilio could not start the call');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await ProfessionalCall.updateOne(
      { _id: call._id },
      {
        $set: {
          ...terminalVoiceUpdate(call),
          transcription_error_code: 'twilio_create_failed',
          transcription_error_message: text(payload?.message).slice(0, 500),
        },
      },
    );
    return fail(502, payload?.message || 'Twilio could not start the call');
  }
  await ProfessionalCall.updateOne(
    { _id: call._id },
    { $set: { provider_call_sid: text(payload.sid), status: 'ringing', invited_at: new Date() } },
  );
  if (targetType === 'sales') {
    await EnterpriseInquiry.updateOne(
      { _id: targetId, status: 'pending' },
      { $set: { status: 'contacted' } },
    );
  }
  await recordAdminAudit({
    actorUserId: actorId,
    action: 'voice.call.start',
    targetType: targetType === 'lead' ? 'LeadMatch' : targetType === 'sales' ? 'EnterpriseInquiry' : 'ClientProfile',
    targetId,
    meta: { call_id: String(call._id), provider: 'twilio' },
  });
  logger.info('Twilio voice call started', { call_id: String(call._id) });
  return ok({ call: { id: String(call._id), status: 'ringing', provider: 'twilio', to: destination } });
}

export async function startAdminVoicePreview({ actorUser, targetType, targetId, voice }) {
  if (!voiceAgentEnabled()) return fail(503, 'Voice agent is disabled');
  if (!['lead', 'client', 'sales'].includes(targetType)) return fail(400, 'Invalid voice target');
  const loaded = await loadTarget({ targetType, targetId });
  if (loaded.error) return loaded.error;
  const roomName = `preview:${targetType}:${targetId}:${randomUUID()}`;
  const threadId = `admin-voice:${targetType}:${targetId}`;
  const actorId = String(actorUser?._id || actorUser?.id || '');
  const now = new Date();
  let call;
  try {
    call = await ProfessionalCall.create({
      room_name: roomName,
      thread_id: threadId,
      active_thread_key: `${threadId}:live`,
      caller_id: actorId || 'voice-agent',
      participant_ids: [actorId || 'voice-agent'],
      participant_states: [{
        user_id: actorId || 'voice-agent',
        status: 'joined',
        joined_at: now,
        transcription_consent: true,
        transcription_consented_at: now,
        transcription_consent_recorded_at: now,
        transcription_consent_version: '1',
      }],
      call_scope: 'direct',
      call_type: 'voice',
      provider: CALL_PROVIDERS.PREVIEW,
      voice_target_type: targetType,
      voice_target_id: String(targetId),
      voice_to_phone: loaded.phone || '',
    voice_lead_ids: loaded.leadIds || [],
    voice_agent_voice: agentVoice(voice),
    transcription_policy_version: '1',
    transcription_status: 'active',
    transcription_started_at: now,
    minutes_status: 'not_ready',
    recording_status: 'not_requested',
    status: 'active',
    started_at: now,
    connecting_at: now,
    expires_at: new Date(Date.now() + ACTIVE_TTL_MS),
    delete_at: new Date(Date.now() + ACTIVE_TTL_MS + TERMINAL_RETENTION_MS),
  });
  } catch (error) {
    if (error?.code === 11000) return fail(409, 'A call is already open for this person');
    throw error;
  }
  const greeting = spokenGreeting(call.voice_agent_voice);
  await ingestFinalTranscriptSegment({
    callId: call._id,
    segmentId: `agent-open-${call._id}`,
    speakerUserId: 'nesti-voice-agent',
    speakerName: 'Nesti Voice',
    text: greeting,
    provider: 'openai',
    providerEventId: `agent:${call._id}:open`,
    model: process.env.OPENAI_VOICE_AGENT_MODEL || 'gpt-4o-mini',
  });
  return ok({ call: { id: String(call._id), status: 'active', provider: 'preview' }, say: greeting });
}

export async function startAdminLiveKitVoice({ actorUser, targetType, targetId, voice }) {
  if (!voiceAgentEnabled()) return fail(503, 'Voice agent is disabled');
  const livekitUrl = text(process.env.LIVEKIT_URL);
  const apiKey = text(process.env.LIVEKIT_API_KEY);
  const apiSecret = text(process.env.LIVEKIT_API_SECRET);
  if (!livekitUrl || !apiKey || !apiSecret) return fail(503, 'LiveKit is not configured');
  if (!['lead', 'client', 'sales'].includes(targetType)) return fail(400, 'Invalid voice target');
  const loaded = await loadTarget({ targetType, targetId });
  if (loaded.error) return loaded.error;
  const threadId = `admin-voice:${targetType}:${targetId}`;
  await ProfessionalCall.updateMany(
    { thread_id: threadId, provider: { $in: [CALL_PROVIDERS.PREVIEW, CALL_PROVIDERS.LIVEKIT] }, status: { $in: ['connecting', 'ringing', 'active'] } },
    { $set: { status: 'ended', ended_at: new Date(), active_thread_key: null, transcription_status: 'completed' } },
  );
  const roomName = `admin-voice:${targetType}:${targetId}:${randomUUID()}`;
  const actorId = String(actorUser?._id || actorUser?.id || 'admin');
  const now = new Date();
  const call = await ProfessionalCall.create({
    room_name: roomName,
    thread_id: threadId,
    active_thread_key: `${threadId}:live`,
    caller_id: actorId,
    participant_ids: [actorId],
    participant_states: [{
      user_id: actorId,
      status: 'joined',
      joined_at: now,
      transcription_consent: true,
      transcription_consented_at: now,
      transcription_consent_recorded_at: now,
      transcription_consent_version: '1',
    }],
    call_scope: 'direct',
    call_type: 'voice',
    provider: CALL_PROVIDERS.LIVEKIT,
    voice_target_type: targetType,
    voice_target_id: String(targetId),
    voice_to_phone: loaded.phone || '',
    voice_lead_ids: loaded.leadIds || [],
    voice_agent_voice: agentVoice(voice),
    transcription_policy_version: '1',
    transcription_status: 'active',
    transcription_started_at: now,
    minutes_status: 'not_ready',
    recording_status: isPrivateRecordingsConfigured() ? 'pending' : 'not_requested',
    status: 'connecting',
    connecting_at: now,
    expires_at: new Date(Date.now() + ACTIVE_TTL_MS),
    delete_at: new Date(Date.now() + ACTIVE_TTL_MS + TERMINAL_RETENTION_MS),
  });
  const greeting = spokenGreeting();
  const dispatched = await dispatchRaviAgent({
    roomName,
    callId: call._id,
    role: targetType === 'client' ? 'client' : loaded.role || 'professional',
    greeting,
  });
  if (!dispatched.ok) {
    await ProfessionalCall.updateOne(
      { _id: call._id },
      { $set: { status: 'ended', ended_at: new Date(), active_thread_key: null, transcription_error_message: dispatched.message } },
    );
    return fail(503, dispatched.message);
  }
  const token = new AccessToken(apiKey, apiSecret, { identity: actorId, ttl: 60 * 30 });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishSources: [TrackSource.MICROPHONE],
  });
  const clientUserId = String(loaded.client?.user_id?._id || loaded.client?.user_id || '');
  let ringing = false;
  if (targetType === 'client' && clientUserId) {
    const clientToken = new AccessToken(apiKey, apiSecret, { identity: `client:${clientUserId}`, ttl: 60 * 30 });
    clientToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishSources: [TrackSource.MICROPHONE],
    });
    ringing = emitMayaIncomingCall(clientUserId, {
      call_id: String(call._id),
      url: livekitUrl,
      token: await clientToken.toJwt(),
      say: greeting,
      agent_name: 'Ravi',
    });
  }
  const nextStatus = ringing ? 'ringing' : 'active';
  await ProfessionalCall.updateOne(
    { _id: call._id, status: 'connecting' },
    { $set: nextStatus === 'active' ? { status: 'active', started_at: new Date() } : { status: 'ringing', invited_at: new Date() } },
  );
  return ok({
    call: { id: String(call._id), status: nextStatus, provider: 'livekit' },
    url: livekitUrl,
    token: ringing ? '' : await token.toJwt(),
    say: greeting,
    agent_name: 'Ravi',
    ringing,
    offline: Boolean(targetType === 'client' && clientUserId && !ringing),
  });
}

async function clientOwnsCall(userId, call) {
  const profile = await ClientProfile.findById(call.voice_target_id).select('user_id').lean();
  const owner = String(profile?.user_id?._id || profile?.user_id || '');
  return Boolean(owner) && owner === String(userId || '');
}

async function closeClientCall(callId, status) {
  await ProfessionalCall.updateOne(
    { _id: callId, status: { $in: ['connecting', 'ringing', 'active'] } },
    { $set: { status, ended_at: new Date(), active_thread_key: null, transcription_status: 'completed' } },
  );
}

export async function answerClientRaviCall({ userId, callId }) {
  const call = await ProfessionalCall.findById(callId).select('provider status voice_target_type voice_target_id').lean();
  if (!call || call.provider !== CALL_PROVIDERS.LIVEKIT || call.voice_target_type !== 'client') return fail(404, 'Call not found');
  if (!(await clientOwnsCall(userId, call))) return fail(403, 'This call is for another client');
  if (['ended', 'expired', 'declined'].includes(call.status)) return fail(400, 'This call has ended');
  await ProfessionalCall.updateOne(
    { _id: callId, status: { $in: ['connecting', 'ringing', 'active'] } },
    { $set: { status: 'active', started_at: new Date() } },
  );
  return ok({ call: { id: String(callId), status: 'active' } });
}

export async function declineClientRaviCall({ userId, callId }) {
  const call = await ProfessionalCall.findById(callId).select('provider status voice_target_type voice_target_id').lean();
  if (!call || call.provider !== CALL_PROVIDERS.LIVEKIT || call.voice_target_type !== 'client') return fail(404, 'Call not found');
  if (!(await clientOwnsCall(userId, call))) return fail(403, 'This call is for another client');
  await closeClientCall(callId, 'declined');
  return ok({ call: { id: String(callId), status: 'declined' } });
}

export async function endClientRaviCall({ userId, callId }) {
  const call = await ProfessionalCall.findById(callId).select('provider status voice_target_type voice_target_id').lean();
  if (!call || call.provider !== CALL_PROVIDERS.LIVEKIT || call.voice_target_type !== 'client') return fail(404, 'Call not found');
  if (!(await clientOwnsCall(userId, call))) return fail(403, 'This call is for another client');
  await closeClientCall(callId, 'ended');
  return ok({ call: { id: String(callId), status: 'ended' } });
}

export async function clientMayaTurn({ userId, callId, text: spoken }) {
  const call = await ProfessionalCall.findById(callId).select('provider status voice_target_type voice_target_id').lean();
  if (!call || call.provider !== CALL_PROVIDERS.LIVEKIT || call.voice_target_type !== 'client') {
    return fail(404, 'Call not found');
  }
  const profile = await ClientProfile.findById(call.voice_target_id).select('user_id').lean();
  const owner = String(profile?.user_id?._id || profile?.user_id || '');
  if (!owner || owner !== String(userId || '')) return fail(403, 'This call is for another client');
  if (call.status === 'ended') return fail(400, 'This call has ended');
  const reply = await handleVoiceGather({ callId, speechResult: spoken });
  return ok({ say: reply.say, audio: reply.audio || '', done: Boolean(reply.done) });
}

export async function sendAdminVoicePreviewTurn({ callId, text: spoken }) {
  const call = await ProfessionalCall.findById(callId).select('provider status').lean();
  if (!call || (call.provider !== CALL_PROVIDERS.PREVIEW && call.provider !== CALL_PROVIDERS.LIVEKIT)) {
    return fail(404, 'Preview call not found');
  }
  if (call.status === 'ended') return fail(400, 'This test has ended');
  const reply = await handleVoiceGather({ callId, speechResult: spoken });
  return ok({ say: reply.say, audio: reply.audio || '', done: Boolean(reply.done) });
}

export async function stopAdminVoiceCall({ actorUser, callId, fetchImpl = fetch }) {
  const call = await ProfessionalCall.findById(callId);
  if (!call || ![CALL_PROVIDERS.TWILIO, CALL_PROVIDERS.PREVIEW, CALL_PROVIDERS.LIVEKIT].includes(call.provider)) {
    return fail(404, 'Voice call not found');
  }
  const config = twilioConfig();
  if (call.provider === CALL_PROVIDERS.TWILIO && call.provider_call_sid && twilioConfigured(config)) {
    const body = new URLSearchParams({ Status: 'completed' });
    await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls/${call.provider_call_sid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    ).catch((error) => logger.warn('Twilio hangup failed', { message: error?.message }));
  }
  const ended = terminalVoiceUpdate(call);
  call.status = ended.status;
  call.ended_at = ended.ended_at;
  call.ended_by_id = String(actorUser?._id || '');
  call.active_thread_key = null;
  call.transcription_status = ended.transcription_status;
  call.minutes_status = ended.minutes_status;
  await call.save();
  await recordAdminAudit({
    actorUserId: actorUser?._id,
    action: 'voice.call.stop',
    targetType: 'ProfessionalCall',
    targetId: callId,
  });
  return ok({ call: { id: String(call._id), status: 'ended' } });
}

const STATUS_RANK = { connecting: 1, ringing: 2, active: 3, ended: 4 };

export function terminalVoiceUpdate(call, endedAt = new Date()) {
  const started = Boolean(call?.started_at || call?.transcription_started_at);
  return {
    status: 'ended',
    ended_at: call?.ended_at || endedAt,
    active_thread_key: null,
    transcription_status: 'completed',
    minutes_status: started ? 'pending' : 'not_ready',
  };
}

export function shouldAdvanceCallStatus(current, next) {
  return (STATUS_RANK[next] || 0) >= (STATUS_RANK[current] || 0);
}

export function mapTwilioStatus(status) {
  const value = text(status).toLowerCase();
  if (['queued', 'initiated'].includes(value)) return 'connecting';
  if (value === 'ringing') return 'ringing';
  if (['in-progress', 'answered'].includes(value)) return 'active';
  if (['busy', 'no-answer', 'canceled', 'cancelled', 'failed'].includes(value)) return 'ended';
  if (value === 'completed') return 'ended';
  return '';
}
