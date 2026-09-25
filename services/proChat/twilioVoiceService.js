import { randomUUID } from 'node:crypto';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import LeadMatch from '../../models/LeadMatch.js';
import LeadProfile from '../../models/LeadProfile.js';
import ClientProfile from '../../models/ClientProfile.js';
import User from '../../models/User.js';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import logger from '../../utils/logger.js';
import { fail, ok } from '../admin/adminCommon.js';
import { recordAdminAudit } from '../admin/adminAuditService.js';
import { CALL_PROVIDERS, twilioVoiceEnabled, voiceRecordingEnabled } from './callProviders.js';
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

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FEMALE_VOICE = 'Polly.Joanna';

export function buildVoiceTwiml({ callId, say, done = false }) {
  const message = xmlEscape(say || 'Hello, this is Maya from Nesti. I can walk you through the tools and the plan that fits your work.');
  const action = `${text(process.env.TWILIO_WEBHOOK_BASE_URL).replace(/\/+$/, '')}/api/webhooks/twilio/gather?callId=${encodeURIComponent(callId)}`;
  const sayTag = `<Say voice="${FEMALE_VOICE}" language="en-US">${message}</Say>`;
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

export async function stopAdminVoiceCall({ actorUser, callId, fetchImpl = fetch }) {
  const call = await ProfessionalCall.findById(callId);
  if (!call || call.provider !== CALL_PROVIDERS.TWILIO) return fail(404, 'Voice call not found');
  const config = twilioConfig();
  if (call.provider_call_sid && twilioConfigured(config)) {
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
