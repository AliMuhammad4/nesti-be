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
import { canReactivateVoiceCall } from './raviAgentConstants.js';
import { fieldsForVoiceOutcome } from '../admin/adminPipelineStage.js';

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
    .map((plan) => `${plan.name} at ${plan.display_amount} per month${plan.features ? ` (${plan.features.slice(0, 4).join('; ')})` : ''}`)
    .join('. ');
  const tools = client
    ? 'Nesti helps clients buy a home. Services: homeownership progress tracking, budget and financial planning tools, matching with agents and other professionals, priority matching, recommendations, market insights, and support. Guide them to use these inside their Nesti account.'
    : 'Nesti helps professionals win clients. Services: lead qualification, nurture, consultations, a storefront, and the chatbot.';
  return `${tools} Only mention these plans: ${catalog}. Do not invent prices, features, or a checkout.`;
}

async function requestVoiceReply({ call, history, spoken, fallback }) {
  try {
    const guiding = call.voice_target_type === 'sales' || call.voice_target_type === 'client';
    const inquiry = call.voice_target_type === 'sales'
      ? await EnterpriseInquiry.findById(call.voice_target_id).select('interest_role').lean()
      : null;
    const role = call.voice_target_type === 'client' ? 'client' : inquiry?.interest_role;
    const completion = await openai().chat.completions.create({
      model: process.env.OPENAI_VOICE_AGENT_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: guiding
            ? `${raviSalesInstructions(role)} Reply JSON with say, done, suggestions, outcome, plan. suggestions must be []. outcome is interested, callback, declined, plan_recommended, or empty. Set done true only after they agree, decline, or ask to stop.`
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
      await saveSalesVoiceOutcome(call, {
        voice_outcome: outcome,
        voice_outcome_plan: text(parsed.plan).slice(0, 80),
        voice_outcome_note: say.slice(0, 240),
        voice_outcome_at: new Date(),
      });
    }
  }
  if (parsed.done) {
    call.status = 'ended';
    call.ended_at = new Date();
    call.transcription_status = 'completed';
    call.minutes_status = 'pending';
    call.active_thread_key = null;
    await call.save();
  } else if (canReactivateVoiceCall(call.status) && call.status !== 'active') {
    call.status = 'active';
    call.started_at = call.started_at || new Date();
    call.transcription_started_at = call.transcription_started_at || new Date();
    call.transcription_status = 'active';
    await call.save();
  }
  return { say, audio: await synthesizeMayaVoice(say, call.voice_agent_voice), done: Boolean(parsed.done) };
}

async function saveSalesVoiceOutcome(call, fields) {
  const row = await EnterpriseInquiry.findById(call.voice_target_id).select('pipeline_stage close_outcome').lean();
  await EnterpriseInquiry.updateOne(
    { _id: call.voice_target_id },
    { $set: { ...fields, ...fieldsForVoiceOutcome(fields.voice_outcome, row) } },
  );
  await ProfessionalCall.updateOne({ _id: call._id }, { $set: fields });
}

export function raviSalesInstructions(role) {
  return `You are Ravi, a passionate Nesti sales advisor on a live phone call. You lead. The caller may be a man or a woman. Sound energetic, warm, and sure of the product. Use contractions. Never assume their gender, pronouns, family, or budget. Start in English, introduce yourself as Ravi from Nesti, and ask what they want to get done. Languages: English first, then Urdu, Spanish, and French. If they speak one of those or ask you to switch, stay in that language. Never say you cannot speak them. ${subscriptionPitchFacts(role)} Every reply is two short sentences and the second one is a question. After they answer, connect one real benefit, name one plan and its monthly price when it fits, and ask the next question. Do not stop, summarize, or wait for them to carry the call. When they agree, decline, ask for a callback, or you recommend a plan, call record_sales_outcome. Never say the purchase is complete.`;
}

export async function persistSalesOutcome({ callId, outcome, plan, note }) {
  const call = await ProfessionalCall.findById(callId).select('voice_target_type voice_target_id status').lean();
  if (!call) return { ok: false, message: 'Call was not found.' };
  const normalized = text(outcome).toLowerCase();
  if (!SALES_OUTCOMES.has(normalized)) {
    return { ok: false, message: 'Outcome must be interested, callback, declined, or plan_recommended.' };
  }
  const fields = {
    voice_outcome: normalized,
    voice_outcome_plan: text(plan).slice(0, 80),
    voice_outcome_note: text(note).slice(0, 240),
    voice_outcome_at: new Date(),
  };
  if (call.voice_target_type === 'sales') {
    await saveSalesVoiceOutcome(call, fields);
    return { ok: true, message: 'Saved.' };
  }
  if (call.voice_target_type === 'client' || call.voice_target_type === 'lead') {
    await ProfessionalCall.updateOne({ _id: callId }, { $set: fields });
    return { ok: true, message: 'Saved.' };
  }
  return { ok: false, message: 'This call cannot store a sales outcome.' };
}

export function agentName() {
  return 'Ravi';
}

export async function synthesizeMayaVoice(spoken) {
  const line = text(spoken).slice(0, 700);
  if (!line || !process.env.OPENAI_API_KEY) return '';
  try {
    const speech = await openai().audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'ash',
      input: line,
      instructions: 'Speak as a real man on a phone call. Warm, calm, and confident. Natural pace with small rises and falls, like a trusted advisor, not an announcer or a recording. Contractions. Brief pauses between thoughts.',
    });
    return Buffer.from(await speech.arrayBuffer()).toString('base64');
  } catch {
    return '';
  }
}
