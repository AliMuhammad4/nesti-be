import CalendlyWebhookEvent from '../../models/CalendlyWebhookEvent.js';
import logger from '../../utils/logger.js';
import { processCalendlyWebhook } from './calendlyWebhookService.js';

const WORKERS = 2;
export const CALENDLY_WEBHOOK_MAX_ATTEMPTS = 6;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const STALE_LOCK_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

let activeWorkers = 0;
let sweepTimer = null;

export async function acceptCalendlyWebhookEvent(body, rawBody, dedupeKey) {
  try {
    const doc = await CalendlyWebhookEvent.create({
      dedupe_key: dedupeKey,
      event: body?.event ? String(body.event) : null,
      raw_body: rawBody,
    });
    return { duplicate: false, id: doc._id };
  } catch (err) {
    if (err?.code === 11000) return { duplicate: true };
    throw err;
  }
}

async function claimNextEvent() {
  const now = new Date();
  return CalendlyWebhookEvent.findOneAndUpdate(
    {
      $or: [
        { status: { $in: ['pending', 'failed'] }, next_attempt_at: { $lte: now } },
        { status: 'processing', locked_at: { $lte: new Date(now.getTime() - STALE_LOCK_MS) } },
      ],
    },
    { $set: { status: 'processing', locked_at: now }, $inc: { attempts: 1 } },
    { sort: { next_attempt_at: 1 }, returnDocument: 'after' },
  );
}

async function processClaimedEvent(doc) {
  const startedAt = Date.now();
  try {
    const result = await processCalendlyWebhook(JSON.parse(doc.raw_body || '{}'));
    await CalendlyWebhookEvent.updateOne(
      { _id: doc._id, locked_at: doc.locked_at },
      { $set: { status: 'done', processed_at: new Date(), last_error: null, locked_at: null, result_reason: result?.reason ?? null } },
    );
    logger.info('Calendly webhook: processing complete', {
      op:              'calendly.webhook.async',
      ms:              Date.now() - startedAt,
      dedupe_key:      doc.dedupe_key,
      event:           doc.event,
      attempt:         doc.attempts,
      processed:       result?.processed,
      matched:         result?.matched,
      matched_via:     result?.matched_via ?? null,
      conversation_id: result?.conversation_id ?? null,
      reason:          result?.reason ?? null,
    });
  } catch (err) {
    const dead = doc.attempts >= CALENDLY_WEBHOOK_MAX_ATTEMPTS;
    const delay = RETRY_BACKOFF_MS[Math.min(doc.attempts - 1, RETRY_BACKOFF_MS.length - 1)] || RETRY_BACKOFF_MS[0];
    await CalendlyWebhookEvent.updateOne(
      { _id: doc._id, locked_at: doc.locked_at },
      {
        $set: {
          status: dead ? 'dead' : 'failed',
          last_error: String(err?.message || err).slice(0, 1000),
          locked_at: null,
          next_attempt_at: new Date(Date.now() + delay),
        },
      },
    ).catch(() => {});
    logger.error('Calendly webhook processing error', {
      op:         'calendly.webhook.async',
      dedupe_key: doc.dedupe_key,
      event:      doc.event,
      attempt:    doc.attempts,
      will_retry: !dead,
      error:      err?.message,
      stack:      err?.stack,
    });
  }
}

async function runWorker() {
  for (;;) {
    let doc = null;
    try {
      doc = await claimNextEvent();
    } catch (err) {
      logger.warn('Calendly webhook queue: claim failed', { op: 'calendly.webhook.async', error: err?.message });
      return;
    }
    if (!doc) return;
    await processClaimedEvent(doc);
  }
}

export function kickCalendlyWebhookQueue() {
  while (activeWorkers < WORKERS) {
    activeWorkers += 1;
    void runWorker().finally(() => {
      activeWorkers -= 1;
    });
  }
}

export async function waitForCalendlyWebhookQueueIdle(timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  while (activeWorkers > 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return activeWorkers === 0;
}

export function scheduleCalendlyWebhookRetryJob() {
  if (sweepTimer) return sweepTimer;
  kickCalendlyWebhookQueue();
  sweepTimer = setInterval(kickCalendlyWebhookQueue, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  return sweepTimer;
}
