import { createHash, randomUUID } from 'node:crypto';
import ProfessionalCall from '../../models/ProfessionalCall.js';
import ProfessionalCallRecording from '../../models/ProfessionalCallRecording.js';
import logger from '../../utils/logger.js';
import {
  buildRecordingObjectKey,
  deletePrivateRecording,
  isPrivateRecordingsConfigured,
  uploadPrivateRecordingBuffer,
} from '../media/r2Client.js';
import { voiceRecordingEnabled } from './callProviders.js';

const workerId = `${process.pid}:${randomUUID()}`;

function text(value) {
  return String(value || '').trim();
}

export function recordingIdempotencyKey(recordingSid) {
  return `twilio-recording:${text(recordingSid)}`;
}

export async function enqueueRecordingFromWebhook({ callId, body = {} }) {
  const recordingSid = text(body.RecordingSid);
  if (!recordingSid) return { ok: false, reason: 'missing_recording_sid' };
  const sourceUrl = text(body.RecordingUrl);
  const duration = Number(body.RecordingDuration) || 0;
  const doc = await ProfessionalCallRecording.findOneAndUpdate(
    { recording_sid: recordingSid },
    {
      $setOnInsert: {
    call_id: callId,
    recording_sid: recordingSid,
    call_sid: text(body.CallSid),
    source_url: sourceUrl,
    duration_seconds: duration,
    channels: Number(body.RecordingChannels) || 1,
    codec: text(body.RecordingSource) || 'twilio',
    idempotency_key: recordingIdempotencyKey(recordingSid),
    ingest_status: 'pending',
    next_attempt_at: new Date(),
        delete_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    },
    { upsert: true, returnDocument: 'after', new: true },
  );
  if (doc.ingest_status === 'pending' && !doc.r2_key) {
    await ProfessionalCall.updateOne(
      { _id: callId, recording_status: { $ne: 'ready' } },
      { $set: { recording_status: 'pending', recording_last_error: '' } },
    );
  }
  return { ok: true, id: String(doc._id) };
}

export async function processRecordingJob(job, { fetchImpl = fetch } = {}) {
  if (!voiceRecordingEnabled() || !isPrivateRecordingsConfigured()) {
    throw new Error('Recording storage is not enabled');
  }
  const accountSid = text(process.env.TWILIO_ACCOUNT_SID);
  const authToken = text(process.env.TWILIO_AUTH_TOKEN);
  const mediaUrl = text(job.source_url).replace(/\.json$/i, '') + '.mp3';
  const response = await fetchImpl(mediaUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
  });
  if (!response.ok) throw new Error(`Twilio recording download failed (${response.status})`);
  const mime = text(response.headers.get('content-type')) || 'audio/mpeg';
  if (!mime.startsWith('audio/')) throw new Error(`Unexpected recording mime ${mime}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('Empty recording');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const key = buildRecordingObjectKey({
    callId: String(job.call_id),
    recordingSid: job.recording_sid,
    extension: 'mp3',
  });
  await uploadPrivateRecordingBuffer(bytes, {
    key,
    mimeType: 'audio/mpeg',
    metadata: { checksum, recording_sid: job.recording_sid },
  });
  await ProfessionalCallRecording.updateOne(
    { _id: job._id, ingest_status: 'processing', lease_owner: workerId },
    {
      $set: {
        ingest_status: 'ready',
        r2_key: key,
        checksum_sha256: checksum,
        bytes: bytes.length,
        mime_type: 'audio/mpeg',
        lease_owner: '',
        lease_until: null,
        last_error: '',
      },
    },
  );
  const readyCount = await ProfessionalCallRecording.countDocuments({
    call_id: job.call_id,
    ingest_status: 'ready',
    deleted_at: null,
  });
  const duration = await ProfessionalCallRecording.aggregate([
    { $match: { call_id: job.call_id, ingest_status: 'ready' } },
    { $group: { _id: null, total: { $sum: '$duration_seconds' } } },
  ]);
  await ProfessionalCall.updateOne(
    { _id: job.call_id },
    {
      $set: {
        recording_status: 'ready',
        recording_count: readyCount,
        recording_duration_seconds_total: duration?.[0]?.total || 0,
        recording_last_error: '',
      },
    },
  );
  logger.info('Call recording stored', { call_id: String(job.call_id), recording_sid: job.recording_sid });
}

export async function claimAndProcessDueRecordings({ fetchImpl = fetch, limit = 5 } = {}) {
  const now = new Date();
  const processed = [];
  for (let i = 0; i < limit; i += 1) {
    const job = await ProfessionalCallRecording.findOneAndUpdate(
      {
        ingest_status: { $in: ['pending', 'failed'] },
        attempts: { $lt: 5 },
        deleted_at: null,
        $and: [
          { $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }] },
          { $or: [{ lease_until: null }, { lease_until: { $lte: now } }] },
        ],
      },
      {
        $set: {
          ingest_status: 'processing',
          lease_owner: workerId,
          lease_until: new Date(Date.now() + 120000),
        },
        $inc: { attempts: 1, retry_count: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!job) break;
    try {
      await processRecordingJob(job, { fetchImpl });
      processed.push({ id: String(job._id), ok: true });
    } catch (error) {
      const exhausted = Number(job.attempts || 1) >= 5;
      const delayMs = Math.min(15 * 60 * 1000, 15000 * 2 ** Math.min(job.attempts, 5));
      await ProfessionalCallRecording.updateOne(
        { _id: job._id, lease_owner: workerId },
        {
          $set: {
            ingest_status: exhausted ? 'dead' : 'failed',
            lease_owner: '',
            lease_until: null,
            next_attempt_at: exhausted ? null : new Date(Date.now() + delayMs),
            last_error: text(error?.message).slice(0, 500),
          },
        },
      );
      await ProfessionalCall.updateOne(
        { _id: job.call_id, recording_status: { $ne: 'ready' } },
        { $set: { recording_status: 'failed', recording_last_error: text(error?.message).slice(0, 500) } },
      );
      processed.push({ id: String(job._id), ok: false });
    }
  }
  const due = await ProfessionalCallRecording.find({
    legal_hold: { $ne: true },
    purged_at: null,
    delete_at: { $lte: new Date() },
  }).limit(10);
  for (const recording of due) {
    if (recording.r2_key) await deletePrivateRecording(recording.r2_key);
    recording.purged_at = new Date();
    recording.deleted_at = recording.deleted_at || new Date();
    recording.r2_key = '';
    await recording.save();
  }
  return processed;
}

let timer = null;
export function startRecordingIngestion() {
  if (timer || !voiceRecordingEnabled()) return;
  timer = setInterval(() => {
    void claimAndProcessDueRecordings().catch((error) => {
      logger.warn('Recording ingestion tick failed', { message: error?.message });
    });
  }, 15000);
  timer.unref?.();
}
