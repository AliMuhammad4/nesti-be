import {
  isMinutesMetaFluff,
  refineTranscriptSegmentText,
  stripMinutesMarkup,
} from './transcriptTextCleaning.js';

function text(value) {
  return String(value || '').trim();
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timestamp(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function transcriptLine(segment) {
  const body = refineTranscriptSegmentText(segment?.text);
  if (!body) return '';
  return `[${timestamp(segment.start_time_ms)}] ${text(segment.speaker_name) || 'Participant'}: ${body}`;
}

function splitLongLine(line, limit) {
  if (line.length <= limit) return [line];
  const parts = [];
  let remaining = line;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf(' ', limit);
    if (cut < Math.floor(limit * 0.55)) cut = limit;
    parts.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts.filter(Boolean);
}

export function chunkTranscriptSegments(segments, maxCharacters = 12000) {
  const limit = Math.max(1000, positiveInt(maxCharacters, 12000));
  const chunks = [];
  let current = '';
  for (const segment of segments || []) {
    const line = transcriptLine(segment);
    if (!line) continue;
    for (const part of splitLongLine(line, limit)) {
      const candidate = current ? `${current}\n${part}` : part;
      if (candidate.length > limit && current) {
        chunks.push(current);
        current = part;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function cleanListItem(value) {
  const cleaned = stripMinutesMarkup(value);
  if (!cleaned || isMinutesMetaFluff(cleaned)) return '';
  return cleaned;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.map(cleanListItem).filter(Boolean).slice(0, 100)
    : [];
}

export function normalizeMinutes(value) {
  const source = value && typeof value === 'object' ? value : {};
  const summary = cleanListItem(source.summary).slice(0, 12000);
  return {
    summary,
    topics: stringArray(source.topics),
    decisions: stringArray(source.decisions),
    action_items: (Array.isArray(source.action_items) ? source.action_items : [])
      .map((item) => ({
        owner: stripMinutesMarkup(item?.owner).slice(0, 200),
        task: cleanListItem(item?.task).slice(0, 800),
        due_date: stripMinutesMarkup(item?.due_date).slice(0, 100),
      }))
      .filter((item) => item.task)
      .slice(0, 100),
    follow_ups: stringArray(source.follow_ups),
  };
}

/** Last-resort minutes when the model returns empty but speech exists. */
export function fallbackMinutesFromSegments(segments = []) {
  const lines = (segments || [])
    .map((segment) => {
      const body = refineTranscriptSegmentText(segment?.text);
      if (!body) return '';
      const speaker = text(segment?.speaker_name) || 'Participant';
      return `${speaker}: ${body}`;
    })
    .filter(Boolean);
  if (!lines.length) return null;
  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (joined.replace(/\s+/g, '').length < 8) return null;
  return normalizeMinutes({
    summary: `Brief call notes from the transcript: ${joined.slice(0, 1200)}`,
    topics: [],
    decisions: [],
    action_items: [],
    follow_ups: [],
  });
}

export function groupByCharacters(values, maxCharacters) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const value of values) {
    const serialized = JSON.stringify(value);
    if (current.length && size + serialized.length > maxCharacters) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(value);
    size += serialized.length;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function positiveIntEnv(value, fallback) {
  return positiveInt(value, fallback);
}
