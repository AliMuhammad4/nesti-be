import express from 'express';
import mongoose from 'mongoose';

import { protect } from '../middleware/authMiddleware.js';
import CalendarIntegration from '../models/CalendarIntegration.js';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import ChatConversation from '../models/ChatConversation.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import logger from '../utils/logger.js';
import {
  buildCalendlyAuthorizeUrl,
  createCalendlyOAuthState,
  exchangeCalendlyAuthorizationCode,
  fetchCalendlyAccountLabel,
  parseCalendlyOAuthState,
} from '../services/calendly/oauthService.js';
import {
  applyCalendlyOAuthAlignment,
  calendlyWebhookAlignmentMeta,
} from '../services/calendly/calendlyAlignmentService.js';
import {
  listCalendlyWebhookSubscriptions,
  registerCalendlyInviteeWebhook,
} from '../services/calendly/registerInviteeWebhook.js';
import { processCalendlyWebhook } from '../services/calendly/calendlyWebhookService.js';

const router = express.Router();

function maskEmbedToken(token) {
  if (token == null || typeof token !== 'string') return null;
  const t = token.trim();
  if (!t) return null;
  if (t.length <= 8) return '***';
  return `…${t.slice(-6)}`;
}

/** Anyone with the embed token can start OAuth for that embed’s owner — dev default; prod needs CALENDLY_CONNECT_BY_EMBED=true */
function calendlyConnectByEmbedAllowed() {
  return (
    process.env.CALENDLY_CONNECT_BY_EMBED === 'true' ||
    process.env.NODE_ENV !== 'production'
  );
}

/** List/simulate Calendly helpers (off in production unless CALENDLY_DEV_TOOLS=true). */
function calendlyDevToolsAllowed() {
  return (
    process.env.CALENDLY_DEV_TOOLS === 'true' || process.env.NODE_ENV !== 'production'
  );
}

const connectCalendlyByEmbed = async (req, res) => {
  if (!calendlyConnectByEmbedAllowed()) {
    return res.status(403).json({
      success: false,
      message:
        'Embed-based Calendly connect is off in production. Use GET /api/calendar/connect/calendly with Bearer auth, or set CALENDLY_CONNECT_BY_EMBED=true (know the security trade-off).',
    });
  }
  const embedToken = String(req.query.embedToken || '').trim();
  if (!embedToken) {
    return res.status(400).json({ success: false, message: 'Missing embedToken query parameter' });
  }
  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
  if (!embed) {
    return res.status(403).json({ success: false, message: 'Invalid or inactive embed token' });
  }
  try {
    const state = createCalendlyOAuthState(embed.user_id);
    const authUrl = buildCalendlyAuthorizeUrl(state);
    logger.info('Calendar API: Calendly OAuth URL issued (embed)', {
      op:           'calendar.calendly.connect_embed',
      user_id:      String(embed.user_id),
      embed_token:  maskEmbedToken(embedToken),
    });
    return res.json({ success: true, authUrl });
  } catch (err) {
    logger.warn(`Calendly connect (embed): ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getCalendarStatusByEmbed = async (req, res) => {
  if (!calendlyConnectByEmbedAllowed()) {
    return res.status(403).json({
      success: false,
      message:
        'Embed-based calendar status is off in production. Use GET /api/calendar/status with Bearer auth, or set CALENDLY_CONNECT_BY_EMBED=true.',
    });
  }
  const embedToken = String(req.query.embedToken || '').trim();
  if (!embedToken) {
    return res.status(400).json({ success: false, message: 'Missing embedToken query parameter' });
  }
  const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
  if (!embed) {
    return res.status(403).json({ success: false, message: 'Invalid or inactive embed token' });
  }
  const [rows, profile, calInt] = await Promise.all([
    CalendarIntegration.find({ user_id: embed.user_id })
      .select('provider account_email expires_at updatedAt calendly_slug calendly_slug_mismatch')
      .lean(),
    ProfessionalProfile.findOne({ user_id: embed.user_id }).select('calendly_link').lean(),
    CalendarIntegration.findOne({ user_id: embed.user_id, provider: 'calendly' })
      .select('access_token calendly_slug calendly_slug_mismatch')
      .lean(),
  ]);
  const calendly_alignment = calendlyWebhookAlignmentMeta(calInt, profile);
  return res.json({ success: true, status: rows, calendly_alignment });
};

const connectCalendar = async (req, res) => {
  try {
    const { provider } = req.params;
    if (provider !== 'calendly') {
      return res.status(400).json({
        success: false,
        message: 'Connect is implemented for calendly only. Use GET /api/calendar/connect/calendly',
      });
    }
    const state = createCalendlyOAuthState(req.user._id);
    const authUrl = buildCalendlyAuthorizeUrl(state);
    logger.info('Calendar API: Calendly OAuth URL issued (Bearer)', {
      op:      'calendar.calendly.connect',
      user_id: String(req.user._id),
    });
    return res.json({ success: true, authUrl });
  } catch (err) {
    logger.warn(`Calendly connect: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Calendly redirects here with ?code=...&state=... (no Bearer token).
 * Register the same URL in the OAuth app as CALENDLY_REDIRECT_URI.
 */
const callbackCalendar = async (req, res) => {
  try {
    const { provider } = req.params;
    if (provider !== 'calendly') {
      return res.status(400).json({ success: false, message: 'Unsupported provider' });
    }

    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) {
      logger.warn('Calendar API: Calendly OAuth callback error query', {
        op:    'calendar.calendly.callback',
        error: errorDescription || error,
      });
      return res.status(400).json({
        success: false,
        message: errorDescription || error || 'Calendly authorization denied',
      });
    }
    if (!code || !state) {
      return res.status(400).json({ success: false, message: 'Missing code or state' });
    }

    const userId = parseCalendlyOAuthState(state);
    const tokens = await exchangeCalendlyAuthorizationCode(code);
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresInSec = Number(tokens.expires_in) || 7200;
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    const accountLabel = await fetchCalendlyAccountLabel(accessToken);

    await CalendarIntegration.findOneAndUpdate(
      { user_id: userId, provider: 'calendly' },
      {
        user_id:       userId,
        provider:      'calendly',
        access_token:  accessToken,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        expires_at:    expiresAt,
        ...(accountLabel ? { account_email: String(accountLabel) } : {}),
      },
      { upsert: true, new: true }
    );

    try {
      await applyCalendlyOAuthAlignment(userId, accessToken);
    } catch (alignErr) {
      logger.warn(`Calendly OAuth alignment skipped: ${alignErr.message}`);
    }

    logger.info('Calendar API: Calendly OAuth connected', {
      op:            'calendar.calendly.callback',
      user_id:       String(userId),
      account_email: accountLabel || null,
    });

    const whTarget = process.env.CALENDLY_WEBHOOK_TARGET_URL?.trim();
    if (whTarget && accessToken) {
      registerCalendlyInviteeWebhook(accessToken, whTarget).then(
        (r) =>
          logger.info('Calendar API: Calendly webhook auto-registered', {
            op:      'calendar.calendly.callback',
            user_id: String(userId),
            result:  r?.created ? 'created' : r?.alreadyExists ? 'already_exists' : r?.skipped ? 'skipped' : 'ok',
          }),
        (e) =>
          logger.warn(
            `Calendar API: Calendly webhook auto-register failed (set CALENDLY_WEBHOOK_TARGET_URL or use POST …/webhook-subscription/embed) — ${e.message}`
          )
      );
    } else if (!whTarget) {
      logger.info(
        'Calendar API: CALENDLY_WEBHOOK_TARGET_URL not set — skipping Calendly webhook auto-registration (local: use ngrok URL + /api/webhooks/calendly)'
      );
    }

    const redirect = process.env.CALENDLY_OAUTH_SUCCESS_REDIRECT?.trim();
    if (redirect) {
      return res.redirect(302, redirect);
    }
    const integ = await CalendarIntegration.findOne({
      user_id:  userId,
      provider: 'calendly',
    })
      .select('calendly_slug calendly_slug_mismatch')
      .lean();
    return res.json({
      success:                  true,
      message:                  'Calendly connected',
      provider:                 'calendly',
      calendly_slug:            integ?.calendly_slug ?? null,
      calendly_slug_mismatch:   Boolean(integ?.calendly_slug_mismatch),
    });
  } catch (err) {
    logger.warn(`Calendly callback: ${err.message}`);
    return res.status(400).json({ success: false, message: err.message });
  }
};

const getCalendarStatus = async (req, res) => {
  const rows = await CalendarIntegration.find({ user_id: req.user._id })
    .select('provider account_email expires_at updatedAt')
    .lean();
  return res.json({ success: true, status: rows });
};

const getBookings = async (req, res) => {
  res.json({
    success:    true,
    bookings:   [],
    message:    'Not implemented — use GET /api/calendar/status and OAuth tokens in CalendarIntegration when you add scheduled-events API calls',
  });
};

/**
 * Bearer: register invitee webhooks after ngrok URL changes.
 * Body: { "webhookUrl": "https://....ngrok-free.dev/api/webhooks/calendly" } optional if CALENDLY_WEBHOOK_TARGET_URL is set.
 */
const registerCalendlyWebhookSubscription = async (req, res) => {
  try {
    const webhookUrl = String(
      req.body?.webhookUrl || process.env.CALENDLY_WEBHOOK_TARGET_URL || ''
    ).trim();
    if (!webhookUrl) {
      return res.status(400).json({
        success: false,
        message:
          'Provide JSON { "webhookUrl": "https://YOUR-NGROK.ngrok-free.dev/api/webhooks/calendly" } or set CALENDLY_WEBHOOK_TARGET_URL in .env',
      });
    }
    const integ = await CalendarIntegration.findOne({
      user_id:  req.user._id,
      provider: 'calendly',
    });
    if (!integ?.access_token) {
      return res.status(400).json({
        success: false,
        message: 'Connect Calendly (OAuth) first, then register the webhook.',
      });
    }
    const result = await registerCalendlyInviteeWebhook(integ.access_token, webhookUrl);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.warn(`Calendly webhook register (Bearer): ${err.message}`);
    return res.status(502).json({ success: false, message: err.message });
  }
};

/** Same as Bearer but uses embedToken (widget / local test). */
const registerCalendlyWebhookSubscriptionEmbed = async (req, res) => {
  if (!calendlyConnectByEmbedAllowed()) {
    return res.status(403).json({
      success: false,
      message:
        'Embed webhook registration is off in production unless CALENDLY_CONNECT_BY_EMBED=true.',
    });
  }
  try {
    const embedToken = String(req.body?.embedToken || '').trim();
    const webhookUrl = String(
      req.body?.webhookUrl || process.env.CALENDLY_WEBHOOK_TARGET_URL || ''
    ).trim();
    if (!embedToken) {
      return res.status(400).json({ success: false, message: 'embedToken is required in JSON body' });
    }
    if (!webhookUrl) {
      return res.status(400).json({
        success: false,
        message:
          'webhookUrl is required, e.g. https://YOUR-SUBDOMAIN.ngrok-free.dev/api/webhooks/calendly (or set CALENDLY_WEBHOOK_TARGET_URL)',
      });
    }
    const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
    if (!embed) {
      return res.status(403).json({ success: false, message: 'Invalid or inactive embed token' });
    }
    const integ = await CalendarIntegration.findOne({
      user_id:  embed.user_id,
      provider: 'calendly',
    });
    if (!integ?.access_token) {
      return res.status(400).json({
        success: false,
        message: 'Connect Calendly first, then register webhook.',
      });
    }
    const result = await registerCalendlyInviteeWebhook(integ.access_token, webhookUrl);
    logger.info('Calendar API: webhook subscription via embed', {
      op:      'calendar.calendly.webhook_register_embed',
      user_id: String(embed.user_id),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.warn(`Calendly webhook register (embed): ${err.message}`);
    return res.status(502).json({ success: false, message: err.message });
  }
};

/** GET ?embedToken= — list Calendly webhook_subscriptions for the OAuth user (debug ngrok URL / scope). */
const listCalendlyWebhooksEmbed = async (req, res) => {
  if (!calendlyConnectByEmbedAllowed() || !calendlyDevToolsAllowed()) {
    return res.status(403).json({ success: false, message: 'Not available' });
  }
  try {
    const embedToken = String(req.query.embedToken || '').trim();
    if (!embedToken) {
      return res.status(400).json({ success: false, message: 'embedToken query required' });
    }
    const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
    if (!embed) {
      return res.status(403).json({ success: false, message: 'Invalid or inactive embed token' });
    }
    const integ = await CalendarIntegration.findOne({
      user_id:  embed.user_id,
      provider: 'calendly',
    });
    if (!integ?.access_token) {
      return res.status(400).json({ success: false, message: 'Connect Calendly first' });
    }
    const data = await listCalendlyWebhookSubscriptions(integ.access_token);
    return res.json({ success: true, ...data });
  } catch (err) {
    logger.warn(`Calendly list webhooks (embed): ${err.message}`);
    return res.status(502).json({ success: false, message: err.message });
  }
};

/**
 * Dev: pretend Calendly POSTed invitee.created — updates ChatConversation / LeadMatch like a real webhook.
 * Body: { embedToken, conversationId, email? } — conversation must belong to embed owner.
 */
const simulateCalendlyInviteeCreatedEmbed = async (req, res) => {
  if (!calendlyConnectByEmbedAllowed() || !calendlyDevToolsAllowed()) {
    return res.status(403).json({ success: false, message: 'Not available' });
  }
  try {
    const embedToken = String(req.body?.embedToken || '').trim();
    const conversationId = String(req.body?.conversationId || '').trim();
    const email = String(req.body?.email || 'simulate@example.com').trim();
    if (!embedToken || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({
        success: false,
        message: 'JSON body needs embedToken and conversationId (Mongo ObjectId)',
      });
    }
    const embed = await ChatbotEmbedUrl.findOne({ token: embedToken });
    if (!embed) {
      return res.status(403).json({ success: false, message: 'Invalid or inactive embed token' });
    }
    const conv = await ChatConversation.findOne({
      _id:     conversationId,
      user_id: embed.user_id,
    })
      .select('_id')
      .lean();
    if (!conv) {
      return res.status(404).json({
        success: false,
        message: 'conversationId not found for this embed owner',
      });
    }

    const fakeBody = {
      event: 'invitee.created',
      payload: {
        email,
        uri: 'https://api.calendly.com/scheduled_events/simulate/invitees/simulate',
        event: 'https://api.calendly.com/scheduled_events/simulate',
        tracking: { utm_content: conversationId, utm_source: 'nesti_simulate' },
      },
    };
    const processResult = await processCalendlyWebhook(fakeBody);
    const updated = await ChatConversation.findById(conversationId)
      .select('calendly_booking_status calendly_booking_at intent')
      .lean();

    logger.info('Calendar API: simulated invitee.created (embed)', {
      op:              'calendar.calendly.simulate_embed',
      user_id:         String(embed.user_id),
      conversation_id: conversationId,
    });

    return res.json({
      success:     true,
      simulated:   true,
      processResult,
      conversation: updated,
    });
  } catch (err) {
    logger.warn(`Calendly simulate (embed): ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const disconnectCalendar = async (req, res) => {
  const { provider } = req.params;
  if (provider !== 'calendly') {
    return res.status(400).json({ success: false, message: 'Only calendly disconnect is supported' });
  }
  await CalendarIntegration.deleteOne({ user_id: req.user._id, provider: 'calendly' });
  logger.info('Calendar API: Calendly disconnected', {
    op:      'calendar.calendly.disconnect',
    user_id: String(req.user._id),
  });
  return res.json({ success: true, message: 'Calendly disconnected' });
};

router.get('/connect/calendly/embed', connectCalendlyByEmbed);
router.get('/status/embed', getCalendarStatusByEmbed);
router.post('/calendly/webhook-subscription', protect, registerCalendlyWebhookSubscription);
router.post('/calendly/webhook-subscription/embed', registerCalendlyWebhookSubscriptionEmbed);
router.get('/calendly/webhook-subscriptions/embed', listCalendlyWebhooksEmbed);
router.post('/calendly/simulate-invitee-created/embed', simulateCalendlyInviteeCreatedEmbed);
router.get('/connect/:provider', protect, connectCalendar);
router.get('/callback/:provider', callbackCalendar);
router.get('/status', protect, getCalendarStatus);
router.get('/bookings', protect, getBookings);
router.delete('/disconnect/:provider', protect, disconnectCalendar);

export default router;
