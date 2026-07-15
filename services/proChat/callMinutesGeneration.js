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
        content:
          'Return only valid JSON with keys summary (string), topics (string[]), decisions (string[]), action_items ({owner,task,due_date}[]), and follow_ups (string[]). Never invent facts, owners, decisions, or due dates. Empty arrays are valid.',
      },
      {
        role: 'user',
        content:
          mode === 'transcript'
            ? `Create accurate meeting minutes from this speaker-attributed call transcript:\n\n${content}`
            : `Merge these partial call minutes into one non-duplicative, accurate final record:\n\n${content}`,
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
