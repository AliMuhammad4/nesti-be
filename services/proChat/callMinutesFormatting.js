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
  return `[${timestamp(segment.start_time_ms)}] ${text(segment.speaker_name) || 'Participant'}: ${text(segment.text)}`;
}

export function chunkTranscriptSegments(segments, maxCharacters = 12000) {
  const limit = Math.max(1000, positiveInt(maxCharacters, 12000));
  const chunks = [];
  let current = '';
  for (const segment of segments || []) {
    const line = transcriptLine(segment);
    const parts = [];
    for (let offset = 0; offset < line.length; offset += limit) {
      parts.push(line.slice(offset, offset + limit));
    }
    for (const part of parts) {
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

function stringArray(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 100) : [];
}

export function normalizeMinutes(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    summary: text(source.summary).slice(0, 12000),
    topics: stringArray(source.topics),
    decisions: stringArray(source.decisions),
    action_items: (Array.isArray(source.action_items) ? source.action_items : [])
      .map((item) => ({
        owner: text(item?.owner),
        task: text(item?.task),
        due_date: text(item?.due_date),
      }))
      .filter((item) => item.task)
      .slice(0, 100),
    follow_ups: stringArray(source.follow_ups),
  };
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
