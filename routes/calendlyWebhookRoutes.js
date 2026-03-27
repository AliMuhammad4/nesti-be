import express from 'express';

import logger from '../utils/logger.js';
import {
  verifyCalendlySignature,
  processCalendlyWebhook,
} from '../services/calendly/calendlyWebhookService.js';

const router = express.Router();

/** Browsers use GET — Calendly uses POST. This confirms the route is mounted. */
router.get('/', (req, res) => {
  res.status(200).json({
    ok:      true,
    path:    '/api/webhooks/calendly',
    message:
      'Calendly sends invitee webhooks with HTTP POST and a JSON body. Open this URL in a browser only to verify the tunnel; real deliveries are POST.',
  });
});

/**
 * POST /api/webhooks/calendly
 * Calendly POSTs invitee.created / invitee.canceled here. Verify with CALENDLY_WEBHOOK_SIGNING_KEY in production.
 */
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

    const result = await processCalendlyWebhook(body);
    logger.info('Calendly webhook: HTTP complete', {
      op:              'calendly.webhook.http',
      ms:              Date.now() - requestStartedAt,
      event:           body?.event || null,
      processed:       result.processed,
      matched:         result.matched,
      matched_via:     result.matched_via ?? null,
      conversation_id: result.conversation_id ?? null,
      reason:          result.reason ?? null,
    });
    return res.status(200).json({ success: true, ...result });
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
