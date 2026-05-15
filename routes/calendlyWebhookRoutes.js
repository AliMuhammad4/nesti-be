import express from 'express';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import {
  verifyCalendlySignature,
  processCalendlyWebhook,
} from '../services/calendly/calendlyWebhookService.js';

const router = express.Router();
const CALENDLY_WEBHOOK_WORKERS = 2;
const CALENDLY_WEBHOOK_IDEMPOTENCY_TTL_MS = 15 * 60 * 1000;
const calendlyWebhookQueue = [];
const calendlyWebhookSeenKeys = new Map();
let calendlyWebhookWorkersActive = 0;

function pruneCalendlySeenKeys(now = Date.now()) {
  for (const [key, expiresAt] of calendlyWebhookSeenKeys.entries()) {
    if (expiresAt <= now) calendlyWebhookSeenKeys.delete(key);
  }
}

function webhookPayloadFromBody(body) {
  return body?.payload ?? body?.resource ?? null;
}

function buildCalendlyDedupKey(body) {
  const payload = webhookPayloadFromBody(body) || {};
  const eventName = String(body?.event || '').trim().toLowerCase() || 'unknown';
  const inviteeUri = String(
    payload?.uri || payload?.calendly_invitee_uri || ''
  ).trim();
  const eventUri = String(
    typeof payload?.event === 'string'
      ? payload.event
      : payload?.event?.uri || payload?.scheduled_event?.uri || ''
  ).trim();
  const eventTs = String(
    body?.created_at || payload?.created_at || payload?.updated_at || ''
  ).trim();
  const inviteeEmail = String(
    payload?.email || payload?.invitee?.email || ''
  ).trim().toLowerCase();

  const rawKey = [eventName, inviteeUri, eventUri, eventTs, inviteeEmail].join('|');
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function shouldEnqueueCalendlyWebhook(body) {
  const now = Date.now();
  pruneCalendlySeenKeys(now);
  const key = buildCalendlyDedupKey(body);
  const existingExpiry = calendlyWebhookSeenKeys.get(key);
  if (existingExpiry && existingExpiry > now) {
    return { enqueue: false, key };
  }
  calendlyWebhookSeenKeys.set(key, now + CALENDLY_WEBHOOK_IDEMPOTENCY_TTL_MS);
  return { enqueue: true, key };
}

function runCalendlyQueueWorker() {
  if (calendlyWebhookWorkersActive >= CALENDLY_WEBHOOK_WORKERS) return;
  const task = calendlyWebhookQueue.shift();
  if (!task) return;
  calendlyWebhookWorkersActive += 1;

  (async () => {
    try {
      const result = await processCalendlyWebhook(task.body);
      logger.info('Calendly webhook: async processing complete', {
        op:              'calendly.webhook.async',
        ms:              Date.now() - task.startedAt,
        dedupe_key:      task.dedupeKey,
        event:           task.body?.event || null,
        processed:       result?.processed,
        matched:         result?.matched,
        matched_via:     result?.matched_via ?? null,
        conversation_id: result?.conversation_id ?? null,
        reason:          result?.reason ?? null,
      });
    } catch (err) {
      logger.error('Calendly webhook async processing error', {
        op:    'calendly.webhook.async',
        dedupe_key: task.dedupeKey,
        event: task.body?.event || null,
        error: err.message,
        stack: err.stack,
      });
    } finally {
      calendlyWebhookWorkersActive -= 1;
      runCalendlyQueueWorker();
    }
  })();
}

function enqueueCalendlyWebhook(body, dedupeKey) {
  calendlyWebhookQueue.push({ body, dedupeKey, startedAt: Date.now() });
  runCalendlyQueueWorker();
}

router.get('/', (req, res) => {
  res.status(200).json({
    ok:      true,
    path:    '/api/webhooks/calendly',
    message:
      'Calendly sends invitee webhooks with HTTP POST and a JSON body. Open this URL in a browser only to verify the tunnel; real deliveries are POST.',
  });
});

router.post('/', async (req, res) => {
  const requestStartedAt = Date.now();
  try {
    const rawBuf = req.body;
    const rawString = Buffer.isBuffer(rawBuf)
      ? rawBuf.toString('utf8')
      : typeof rawBuf === 'string'
        ? rawBuf
        : '';

    logger.debug('Calendly webhook: HTTP POST received', {
      op:         'calendly.webhook.http',
      body_bytes: rawString.length,
    });

    const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY?.trim();
    const skipSignature =
      process.env.NODE_ENV !== 'production' &&
      ['1', 'true', 'yes'].includes(
        String(process.env.CALENDLY_SKIP_WEBHOOK_SIGNATURE || '').toLowerCase()
      );

    if (signingKey && !skipSignature) {
      const sig =
        req.get('Calendly-Webhook-Signature') || req.get('calendly-webhook-signature');
      if (!verifyCalendlySignature(rawString, sig, signingKey)) {
        logger.warn(
          'Calendly webhook: invalid or missing signature — check CALENDLY_WEBHOOK_SIGNING_KEY matches Calendly OAuth app; in non-production set CALENDLY_SKIP_WEBHOOK_SIGNATURE=true to test without verification'
        );
        return res.status(401).json({ success: false, message: 'Invalid signature' });
      }
    } else if (signingKey && skipSignature) {
      logger.warn(
        'Calendly webhook: CALENDLY_SKIP_WEBHOOK_SIGNATURE is set — not verifying signature (dev only)'
      );
    } else if (process.env.NODE_ENV === 'production') {
      logger.error('CALENDLY_WEBHOOK_SIGNING_KEY missing in production — rejecting webhook');
      return res.status(503).json({ success: false, message: 'Webhook not configured' });
    } else {
      logger.warn('CALENDLY_WEBHOOK_SIGNING_KEY not set — accepting webhook without verification (dev only)');
    }

    let body;
    try {
      body = JSON.parse(rawString || '{}');
    } catch (parseErr) {
      logger.warn('Calendly webhook: invalid JSON body', {
        op:            'calendly.webhook.http',
        error:         parseErr.message,
        body_preview:  rawString.slice(0, 200),
      });
      return res.status(400).json({ success: false, message: 'Invalid JSON' });
    }

    const dedupe = shouldEnqueueCalendlyWebhook(body);
    if (!dedupe.enqueue) {
      logger.info('Calendly webhook: duplicate skipped', {
        op:             'calendly.webhook.http',
        ms:             Date.now() - requestStartedAt,
        event:          body?.event || null,
        dedupe_key:     dedupe.key,
        queue_depth:    calendlyWebhookQueue.length,
        workers_active: calendlyWebhookWorkersActive,
      });
      return res.status(200).json({ success: true, accepted: true, duplicate: true });
    }

    enqueueCalendlyWebhook(body, dedupe.key);
    logger.info('Calendly webhook: accepted for async processing', {
      op:              'calendly.webhook.http',
      ms:              Date.now() - requestStartedAt,
      event:           body?.event || null,
      dedupe_key:      dedupe.key,
      queue_depth:     calendlyWebhookQueue.length,
      workers_active:  calendlyWebhookWorkersActive,
    });
    return res.status(200).json({ success: true, accepted: true });
  } catch (err) {
    logger.error('Calendly webhook handler error', {
      op:    'calendly.webhook.http',
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ success: false, message: 'Webhook handler error' });
  }
});

export default router;
