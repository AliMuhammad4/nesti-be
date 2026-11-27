import { ingestFinalTranscriptSegment } from '../../services/proChat/transcriptSegmentService.js';
import { withoutFiller } from '../../services/proChat/replyPace.js';
import logger from '../../utils/logger.js';
import { REPLY_MODEL } from './replyLlm.js';
import { text } from './text.js';

const transcriptWarned = new Set();

export async function rememberLine(callId, speaker, line) {
  const spoken = text(line);
  if (!callId || !spoken) return;
  const stamp = Date.now();
  const segment = {
    callId,
    segmentId: `${speaker}-${stamp}`,
    speakerUserId: speaker === 'agent' ? 'nesti-voice-agent' : 'caller',
    speakerName: speaker === 'agent' ? 'Nesti Voice' : 'Caller',
    text: spoken,
    provider: 'livekit',
    providerEventId: `ravi:${callId}:${speaker}:${stamp}`,
    model: REPLY_MODEL,
    anyLanguage: true,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ingestFinalTranscriptSegment(segment);
      return;
    } catch (error) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }
      const key = String(callId);
      if (transcriptWarned.has(key)) return;
      transcriptWarned.add(key);
      logger.warn('Ravi transcript line was not saved', { call_id: callId, message: error?.message });
    }
  }
}

export function dropFiller(item, filler) {
  if (!Array.isArray(item?.content)) return;
  const at = item.content.findIndex((part) => typeof part === 'string');
  if (at < 0) return;
  const rest = withoutFiller(item.content[at], filler);
  if (rest && rest !== item.content[at]) item.content[at] = rest;
}
