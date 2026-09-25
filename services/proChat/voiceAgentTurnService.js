import OpenAI from 'openai';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalCallTranscriptSegment from '../../models/ProfessionalCallTranscriptSegment.js';
import VoiceAgentSuggestion from '../../models/VoiceAgentSuggestion.js';
import EnterpriseInquiry from '../../models/EnterpriseInquiry.js';
import { BILLING_PLANS } from '../billing/plans.js';
import { CLIENT_PLANS } from '../client/plans.js';
import { ingestFinalTranscriptSegment } from './transcriptSegmentService.js';
import { voiceAgentAutocommitEnabled } from './callProviders.js';
import { applyVoiceSuggestion } from '../admin/adminVoiceActionService.js';

const ALLOWED = new Set([
  'lead.patch',
  'lead.nurture.draft',
  'lead.insights.refresh',
  'client.patch',
]);

let client = null;
function openai() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

function text(value) {
  return String(value || '').trim();
}

export function normalizeSuggestions(raw, { callId, targetType, targetId, leadIds = [] }) {
  const list = Array.isArray(raw) ? raw : [];
  const allowedLeads = new Set(leadIds.map(String));
  return list
    .map((item) => {
      const action = text(item?.action);
      if (!ALLOWED.has(action)) return null;
      const payload = item?.payload && typeof item.payload === 'object' ? { ...item.payload } : {};
      let storedTargetType = targetType;
      let storedTargetId = String(targetId);
      if (action.startsWith('lead.')) {
        const leadId = text(payload.lead_id) || (targetType === 'lead' ? String(targetId) : '');
        if (!leadId || (allowedLeads.size && !allowedLeads.has(leadId))) return null;
        payload.lead_id = leadId;
        storedTargetType = 'lead';
        storedTargetId = leadId;
      } else if (targetType !== 'client') {
        return null;
      }
      const confidence = Math.max(0, Math.min(1, Number(item?.confidence) || 0));
      const key = `${callId}:${action}:${storedTargetId}:${JSON.stringify(payload)}`;
      return {
        call_id: callId,
        target_type: storedTargetType,
        target_id: storedTargetId,
        action,
        payload,
        confidence,
        rationale: text(item?.rationale).slice(0, 1000),
        idempotency_key: key.slice(0, 400),
        status: 'pending',
      };
    })
    .filter(Boolean);
}

const SALES_OUTCOMES = new Set(['interested', 'callback', 'declined', 'plan_recommended']);

export function subscriptionPitchFacts(role) {
  const client = String(role || '').toLowerCase() === 'client';
  const plans = Object.values(client ? CLIENT_PLANS : BILLING_PLANS);
  const catalog = plans
    .map((plan) => `${plan.name} at ${plan.display_amount} per month${plan.features ? ` (${plan.features.slice(0, 2).join('; ')})` : ''}`)
    .join('. ');
  const tools = client
    ? 'Clients use progress tracking, budget tools, and professional matching.'
    : 'Professionals use lead qualification, nurture, consultations, a storefront, and the chatbot.';
  return `${tools} Only mention these plans: ${catalog}. Do not invent prices, features, or a checkout.`;
}

async function requestVoiceReply({ call, history, spoken, fallback }) {
  try {
    const sales = call.voice_target_type === 'sales';
    const inquiry = sales
      ? await EnterpriseInquiry.findById(call.voice_target_id).select('interest_role').lean()
      : null;
    const completion = await openai().chat.completions.create({
      model: process.env.OPENAI_VOICE_AGENT_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: sales
            ? `You are Maya, Nesti's subscription advisor. Speak as a calm professional woman. This person is not subscribed and came from a demo or contact request. Teach first, then recommend one plan. ${subscriptionPitchFacts(inquiry?.interest_role)} In order: ask what they want to do, explain only the tools that fit, name one real plan and its price, and ask them to subscribe in their Nesti account. Two short spoken sentences. Reply JSON with say, done, suggestions, outcome, plan. suggestions must be []. outcome is interested, callback, declined, plan_recommended, or empty. Never say the purchase is complete.`
            : 'You are Nesti sales voice agent for admin clients. Reply JSON with say, done, suggestions. suggestions items: action, payload, confidence, rationale. Allowed actions: lead.patch, lead.nurture.draft, lead.insights.refresh, client.patch. For lead actions set payload.lead_id to one of the provided pipeline lead ids. Never invent an action outside the list.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            target_type: call.voice_target_type,
            target_id: call.voice_target_id,
            pipeline_lead_ids: call.voice_lead_ids || [],
            transcript: history.map((row) => row.text),
            latest: spoken,
          }),
        },
      ],
    });
    return JSON.parse(completion.choices?.[0]?.message?.content || '{}');
  } catch {
    return {
      ...fallback,
      say: 'I noted that. A specialist will follow up shortly.',
      done: false,
      suggestions: [],
    };
  }
}

export async function handleVoiceGather({ callId, speechResult }) {
  const call = await ProfessionalCall.findById(callId);
  if (!call) return { say: 'This call is no longer available.', done: true };
  const spoken = text(speechResult);
  if (!spoken) {
    const misses = Number(call.voice_empty_turns || 0) + 1;
    call.voice_empty_turns = misses;
    const done = misses >= 2;
    const say = done
      ? 'I could not hear you. A specialist will follow up. Goodbye.'
      : 'I did not catch that. Could you tell me what you want to use Nesti for?';
    if (done) {
      call.status = 'ended';
      call.ended_at = new Date();
      call.active_thread_key = null;
      call.transcription_status = 'completed';
      call.minutes_status = call.started_at ? 'pending' : 'not_ready';
    }
    await call.save();
    return { say, done };
  }
  call.voice_empty_turns = 0;
  const turnStamp = Date.now();
  await ingestFinalTranscriptSegment({
    callId: call._id,
    segmentId: `caller-${turnStamp}`,
    speakerUserId: 'caller',
    speakerName: 'Caller',
    text: spoken,
    language: 'en',
    startTimeMs: 0,
    endTimeMs: 0,
    provider: 'twilio',
    providerEventId: `gather:${call._id}:${turnStamp}`,
    model: 'twilio-gather',
  });
  const historyDesc = await ProfessionalCallTranscriptSegment.find({ call_id: call._id, final: true })
    .sort({ createdAt: -1 })
    .limit(12)
    .lean();
  const history = historyDesc.reverse().filter((row) => row.provider_event_id !== `gather:${call._id}:${turnStamp}`);
  let parsed = {
    say: 'Thanks for sharing that. A specialist will follow up with the next step.',
    done: history.length > 8,
    suggestions: [],
  };
  if (process.env.OPENAI_API_KEY) {
    parsed = await requestVoiceReply({ call, history, spoken, fallback: parsed });
  }
  const say = text(parsed.say) || 'Thank you. We will follow up shortly.';
  await ingestFinalTranscriptSegment({
    callId: call._id,
    segmentId: `agent-${Date.now()}`,
    speakerUserId: 'nesti-voice-agent',
    speakerName: 'Nesti Voice',
    text: say,
    provider: 'openai',
    providerEventId: `agent:${call._id}:${turnStamp}`,
    model: process.env.OPENAI_VOICE_AGENT_MODEL || 'gpt-4o-mini',
  });
  const suggestions = normalizeSuggestions(parsed.suggestions, {
    callId: call._id,
    targetType: call.voice_target_type,
    targetId: call.voice_target_id,
    leadIds: call.voice_lead_ids || [],
  });
  for (const suggestion of suggestions) {
    await VoiceAgentSuggestion.updateOne(
      { idempotency_key: suggestion.idempotency_key },
      { $setOnInsert: suggestion },
      { upsert: true },
    );
    if (voiceAgentAutocommitEnabled() && suggestion.confidence >= 0.9 && suggestion.action === 'lead.insights.refresh') {
      await applyVoiceSuggestion({ suggestion, actorUser: { _id: call.caller_id, role: 'admin' } }).catch(() => {});
    }
  }
  if (call.voice_target_type === 'sales') {
    const outcome = text(parsed.outcome).toLowerCase();
    if (SALES_OUTCOMES.has(outcome)) {
      await EnterpriseInquiry.updateOne(
        { _id: call.voice_target_id },
        { $set: { voice_outcome: outcome, voice_outcome_plan: text(parsed.plan).slice(0, 80), voice_outcome_note: say.slice(0, 240), voice_outcome_at: new Date() } },
      );
    }
  }
  if (parsed.done) {
    call.status = 'ended';
    call.ended_at = new Date();
    call.transcription_status = 'completed';
    call.minutes_status = 'pending';
    call.active_thread_key = null;
    await call.save();
  } else if (call.status !== 'active') {
    call.status = 'active';
    call.started_at = call.started_at || new Date();
    call.transcription_started_at = call.transcription_started_at || new Date();
    call.transcription_status = 'active';
    await call.save();
  }
  return { say, done: Boolean(parsed.done) };
}
