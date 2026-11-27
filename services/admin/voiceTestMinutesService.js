import OpenAI from 'openai';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalCallTranscriptSegment from '../../models/ProfessionalCallTranscriptSegment.js';
import logger from '../../utils/logger.js';
const TTL_MS = 60 * 60 * 1000;
const SETTLE_MS = 2500;
const MAX_ENTRIES = 50;
const cache = new Map();
let client = null;

function text(value) {
  return String(value || '').trim();
}

function list(value, max = 8) {
  return (Array.isArray(value) ? value : [])
    .map((item) => text(typeof item === 'string' ? item : item?.text || item?.task))
    .filter(Boolean)
    .slice(0, max);
}

export function setTestMinutesClientForTests(value) {
  client = value;
}

export function clearTestMinutesForTests() {
  cache.clear();
}

function openai() {
  if (client) return client;
  const apiKey = text(process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
  return client;
}

const ROLE_LABELS = { client: 'Client', agent: 'Real estate agent', broker: 'Mortgage broker', lawyer: 'Real estate lawyer' };

const PROMPT = [
  'You write short minutes for a sales call between Ravi (the Nesti AI sales assistant) and a caller.',
  'Return only JSON with keys: summary (string, 1-3 sentences), key_points (string[]), caller_needs (string[]),',
  'interest (one of "high", "medium", "low", "unclear"), plan (string, the plan discussed or empty), objections (string[]), next_steps (string[]).',
  'Always write the minutes in plain English, whatever language the call was in; translate what was said into English. Do not invent facts, prices, names, or commitments that are not in the transcript. Prefer empty arrays when unsupported.',
].join(' ');

export function normalizeTestMinutes(raw) {
  const interest = text(raw?.interest).toLowerCase();
  return {
    summary: text(raw?.summary).slice(0, 1200),
    key_points: list(raw?.key_points),
    caller_needs: list(raw?.caller_needs),
    interest: ['high', 'medium', 'low'].includes(interest) ? interest : 'unclear',
    plan: text(raw?.plan).slice(0, 80),
    objections: list(raw?.objections),
    next_steps: list(raw?.next_steps),
  };
}

function transcriptText(segments) {
  return segments
    .map((row) => `${row.speaker_user_id === 'nesti-voice-agent' ? 'Ravi' : 'Caller'}: ${text(row.text)}`)
    .join('\n')
    .slice(0, 24000);
}

function durationSeconds(call) {
  const start = new Date(call.started_at || call.connecting_at || call.createdAt || 0).getTime();
  const end = new Date(call.ended_at || Date.now()).getTime();
  return start && end > start ? Math.round((end - start) / 1000) : 0;
}

function prune(now = Date.now()) {
  for (const [key, entry] of cache) {
    if (now - entry.at > TTL_MS) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

async function generate(callId, call, role) {
  const entry = cache.get(callId);
  if (!entry) return;
  try {
    let segments = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      segments = await ProfessionalCallTranscriptSegment.find({ call_id: call._id, final: true })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      const heardCaller = segments.some((row) => row.speaker_user_id !== 'nesti-voice-agent');
      if (heardCaller || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const callerSpoke = segments.some((row) => row.speaker_user_id !== 'nesti-voice-agent');
    const base = {
      caller_role: ROLE_LABELS[role] || ROLE_LABELS.client,
      duration_seconds: durationSeconds(call),
      ended_at: call.ended_at || null,
    };
    if (!segments.length || !callerSpoke) {
      Object.assign(entry, { status: 'empty', message: 'Nothing was said by the caller on this call, so there are no minutes.', minutes: null });
      return;
    }
    const completion = await openai().chat.completions.create({
      model: text(process.env.CALL_MINUTES_MODEL) || 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: `Caller role: ${base.caller_role}.\n\nTranscript:\n${transcriptText(segments)}` },
      ],
    });
    const minutes = normalizeTestMinutes(JSON.parse(completion.choices?.[0]?.message?.content || '{}'));
    if (!minutes.summary) throw new Error('The summary came back empty.');
    Object.assign(entry, { status: 'ready', minutes: { ...base, ...minutes }, message: '' });
  } catch (error) {
    logger.warn('Test call minutes failed', { call_id: callId, message: error?.message });
    Object.assign(entry, { status: 'failed', minutes: null, message: "Minutes couldn't be prepared for this call. Check OPENAI_API_KEY in the backend .env, then try again." });
  }
}

// status: live (call still running), preparing, ready, empty, failed.
export async function testCallMinutes(callId, { role = 'client', retry = false } = {}) {
  const id = text(callId);
  prune();
  const call = await ProfessionalCall.findById(id)
    .select('voice_target_type status started_at connecting_at createdAt ended_at')
    .lean();
  if (!call || call.voice_target_type !== 'test') return null;
  if (!['ended', 'expired'].includes(call.status)) return { status: 'live', minutes: null, message: '' };
  let entry = cache.get(id);
  if (entry && retry && entry.status === 'failed') {
    cache.delete(id);
    entry = null;
  }
  if (!entry) {
    entry = { status: 'preparing', minutes: null, message: '', at: Date.now() };
    cache.set(id, entry);
    const wait = Math.max(0, SETTLE_MS - (Date.now() - new Date(call.ended_at || 0).getTime()));
    const timer = setTimeout(() => void generate(id, call, role), wait);
    timer.unref?.();
  }
  return { status: entry.status, minutes: entry.minutes, message: entry.message };
}
