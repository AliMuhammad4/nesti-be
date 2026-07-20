import OpenAI from 'openai';
import {
  chunkTranscriptSegments,
  groupByCharacters,
  normalizeMinutes,
  positiveIntEnv,
} from './callMinutesFormatting.js';

function text(value) {
  return String(value || '').trim();
}

let openaiClient = null;

export function setCallMinutesOpenAIClientForTests(client) {
  openaiClient = client;
}

function getOpenAI() {
  const apiKey = text(process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error('OPENAI_API_KEY is required to generate call minutes.');
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey,
      timeout: positiveIntEnv(process.env.CALL_MINUTES_REQUEST_TIMEOUT_MS, 60_000),
      maxRetries: positiveIntEnv(process.env.CALL_MINUTES_PROVIDER_RETRIES, 2),
    });
  }
  return openaiClient;
}

const MINUTES_SYSTEM_PROMPT = [
  'You produce concise professional meeting minutes for a real-estate / business call.',
  'Return only valid JSON with keys: summary (string), topics (string[]), decisions (string[]), action_items ({owner,task,due_date}[]), follow_ups (string[]).',
  'Rules:',
  '- Use plain professional prose only. No markdown, bullets, headings, code fences, or decorative punctuation.',
  '- Capture commitments, decisions, requests, dates, next steps, and any clear factual discussion.',
  '- If the call is short but intelligible, still write a brief factual summary of what was said.',
  '- Ignore fillers, false starts, noise tokens, bracketed tags like [inaudible], and transcription artifacts.',
  '- Ignore any mention of Nesti Minutes, Nesti Notetaker, note-taking bots, transcription agents, or join/leave meta.',
  '- Write the minutes in the dominant language of the conversation: if the transcript is mostly English, write in English; if mostly Urdu, write in Urdu. Keep the entire output in one consistent language and do not mix languages or scripts across sections.',
  '- Do not invent facts, owners, decisions, due dates, or topics that are not supported by the transcript.',
  '- Prefer empty arrays for topics/decisions/action_items/follow_ups when unsupported, but still provide a short summary when any clear speech exists.',
  '- Do not pad the summary with fluff such as "productive discussion" or "the parties exchanged greetings".',
  '- Keep the summary tight (typically 1–6 sentences). Use speaker names only when attributing real decisions or action items.',
].join(' ');

async function generateStructuredMinutes(content, mode) {
  const model = text(process.env.CALL_MINUTES_MODEL) || 'gpt-4.1-mini';
  const completion = await getOpenAI().chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: positiveIntEnv(process.env.CALL_MINUTES_MAX_OUTPUT_TOKENS, 2200),
    messages: [
      {
        role: 'system',
        content: MINUTES_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content:
          mode === 'transcript'
            ? `Create accurate professional meeting minutes from this speaker-attributed call transcript. Omit irrelevant or noisy lines.\n\n${content}`
            : `Merge these partial call minutes into one non-duplicative, accurate, professional final record. Remove fluff and duplicates.\n\n${content}`,
      },
    ],
  });
  const raw = completion.choices[0]?.message?.content || '{}';
  return { minutes: normalizeMinutes(JSON.parse(raw)), model };
}

function boundedMinutesForMerge(value, maxCharacters) {
  const result = normalizeMinutes(value);
  const limit = Math.max(1000, maxCharacters);
  while (JSON.stringify(result).length > limit) {
    result.summary = result.summary.slice(0, Math.max(500, Math.floor(result.summary.length * 0.7)));
    for (const key of ['topics', 'decisions', 'follow_ups']) {
      result[key] = result[key]
        .slice(0, Math.max(3, Math.ceil(result[key].length * 0.75)))
        .map((item) => item.slice(0, 500));
    }
    result.action_items = result.action_items
      .slice(0, Math.max(3, Math.ceil(result.action_items.length * 0.75)))
      .map((item) => ({
        owner: item.owner.slice(0, 200),
        task: item.task.slice(0, 800),
        due_date: item.due_date.slice(0, 100),
      }));
  }
  return result;
}

export async function generateMinutesFromSegments(segments) {
  const chunkSize = positiveIntEnv(process.env.CALL_MINUTES_CHUNK_CHARACTERS, 12000);
  const chunks = chunkTranscriptSegments(segments, chunkSize);
  if (!chunks.length) {
    const error = new Error('No final transcript segments are available.');
    error.code = 'no_transcript_segments';
    throw error;
  }
  const partials = [];
  let model = '';
  for (const chunk of chunks) {
    const generated = await generateStructuredMinutes(chunk, 'transcript');
    partials.push(boundedMinutesForMerge(generated.minutes, Math.floor(chunkSize / 2)));
    model = generated.model;
  }
  let level = partials;
  while (level.length > 1) {
    const groups = groupByCharacters(level, chunkSize);
    const next = [];
    for (const group of groups) {
      if (group.length === 1 && groups.length > 1) {
        next.push(group[0]);
        continue;
      }
      const generated = await generateStructuredMinutes(JSON.stringify(group), 'partials');
      next.push(boundedMinutesForMerge(generated.minutes, Math.floor(chunkSize / 2)));
      model = generated.model;
    }
    level = next;
  }
  return { minutes: level[0], model, chunkCount: chunks.length };
}
