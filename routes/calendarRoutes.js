import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import { webhookSubscriptionBodySchema, simulateInviteeBodySchema } from '../schemas/calendarRouteSchemas.js';
import CalendarIntegration from '../models/CalendarIntegration.js';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import ChatConversation from '../models/ChatConversation.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import logger from '../utils/logger.js';
import { buildCalendlyAuthorizeUrl, createCalendlyOAuthState, exchangeCalendlyAuthorizationCode, fetchCalendlyAccountLabel, fetchCalendlyUserResource, parseCalendlyOAuthState } from '../services/calendly/oauthService.js';
import { applyCalendlyOAuthAlignment, calendlyWebhookAlignmentMeta } from '../services/calendly/calendlyAlignmentService.js';
import { listCalendlyWebhookSubscriptions, registerCalendlyInviteeWebhook } from '../services/calendly/registerInviteeWebhook.js';
import { processCalendlyWebhook } from '../services/calendly/calendlyWebhookService.js';

const router = express.Router();

// ─── Feature flags ────────────────────────────────────────────────────────────

const embedAllowed  = () => process.env.CALENDLY_CONNECT_BY_EMBED === 'true' || process.env.NODE_ENV !== 'production';
const devAllowed    = () => process.env.CALENDLY_DEV_TOOLS === 'true' || process.env.NODE_ENV !== 'production';

function maskToken(t) {
  if (!t || typeof t !== 'string' || !t.trim()) return null;
  return t.length <= 8 ? '***' : `…${t.slice(-6)}`;
}

// ─── Shared middleware ────────────────────────────────────────────────────────

function requireEmbedFeature(req, res, next) {
  if (!embedAllowed()) return res.status(403).json({ success: false, message: 'Embed-based Calendly feature is off in production. Set CALENDLY_CONNECT_BY_EMBED=true or use Bearer auth.' });
  next();
}

function requireDevFeature(req, res, next) {
  if (!embedAllowed() || !devAllowed()) return res.status(403).json({ success: false, message: 'Not available' });
  next();
}

async function loadEmbed(req, res, next) {
  const token = String(req.query.embedToken || req.body?.embedToken || '').trim();
  if (!token) return res.status(400).json({ success: false, message: 'embedToken is required' });
  const embed = await ChatbotEmbedUrl.findOne({ token });
  if (!embed) return res.status(403).json({ success: false, message: 'Invalid or inactive embed token' });
  req.embed = embed;
  req.embedToken = token;
  next();
}

async function requireCalendlyConnected(req, res, next) {
  const userId = req.embed ? req.embed.user_id : req.user._id;
  const integ = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' });
  if (!integ?.access_token) return res.status(400).json({ success: false, message: 'Connect Calendly (OAuth) first.' });
  req.calendlyInteg = integ;
  next();
}

function requireCalendlyProvider(req, res, next) {
  if (req.params.provider !== 'calendly') return res.status(400).json({ success: false, message: 'Only Calendly is supported.' });
  next();
}

function resolveWebhookUrl(body) {
  return String(body?.webhookUrl || process.env.CALENDLY_WEBHOOK_TARGET_URL || '').trim();
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

const connectCalendlyByEmbed = async (req, res) => {
  try {
    const state   = createCalendlyOAuthState(req.embed.user_id);
    const authUrl = buildCalendlyAuthorizeUrl(state);
    logger.info('Calendar API: Calendly OAuth URL issued (embed)', { op: 'calendar.calendly.connect_embed', user_id: String(req.embed.user_id), embed_token: maskToken(req.embedToken) });
    return res.json({ success: true, authUrl });
  } catch (err) {
    logger.warn(`Calendly connect (embed): ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getCalendarStatusByEmbed = async (req, res) => {
  const userId = req.embed.user_id;
  const [rows, profile, calInt] = await Promise.all([
    CalendarIntegration.find({ user_id: userId }).select('provider account_email expires_at updatedAt calendly_slug calendly_slug_mismatch').lean(),
    ProfessionalProfile.findOne({ user_id: userId }).select('calendly_link').lean(),
    CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' }).select('access_token calendly_slug calendly_slug_mismatch').lean(),
  ]);
  return res.json({ success: true, status: rows, calendly_alignment: calendlyWebhookAlignmentMeta(calInt, profile) });
};

const connectCalendar = async (req, res) => {
  try {
    const state   = createCalendlyOAuthState(req.user._id);
    const authUrl = buildCalendlyAuthorizeUrl(state);
    logger.info('Calendar API: Calendly OAuth URL issued (Bearer)', { op: 'calendar.calendly.connect', user_id: String(req.user._id) });
    return res.json({ success: true, authUrl });
  } catch (err) {
    logger.warn(`Calendly connect: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const callbackCalendar = async (req, res) => {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) {
      logger.warn('Calendar API: Calendly OAuth callback error', { op: 'calendar.calendly.callback', error: errorDescription || error });
      return res.status(400).json({ success: false, message: errorDescription || error || 'Calendly authorization denied' });
    }
    if (!code || !state) return res.status(400).json({ success: false, message: 'Missing code or state' });

    const userId = parseCalendlyOAuthState(state);
    const tokens = await exchangeCalendlyAuthorizationCode(code);
    const { access_token: accessToken, refresh_token: refreshToken } = tokens;
    const expiresAt = new Date(Date.now() + (Number(tokens.expires_in) || 7200) * 1000);

    const [accountLabel, userResource] = await Promise.all([
      fetchCalendlyAccountLabel(accessToken),
      fetchCalendlyUserResource(accessToken),
    ]);

    await CalendarIntegration.findOneAndUpdate(
      { user_id: userId, provider: 'calendly' },
      {
        user_id: userId,
        provider: 'calendly',
        access_token: accessToken,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        expires_at: expiresAt,
        ...(accountLabel ? { account_email: String(accountLabel) } : {}),
        ...(userResource?.uri ? { calendly_user_uri: String(userResource.uri).trim().toLowerCase() } : {}),
      },
      { upsert: true, returnDocument: 'after' },
    );

    try { await applyCalendlyOAuthAlignment(userId, accessToken); }
    catch (e) { logger.warn(`Calendly OAuth alignment skipped: ${e.message}`); }

    logger.info('Calendar API: Calendly OAuth connected', { op: 'calendar.calendly.callback', user_id: String(userId), account_email: accountLabel || null });

    const whTarget = process.env.CALENDLY_WEBHOOK_TARGET_URL?.trim();
    if (whTarget) {
      registerCalendlyInviteeWebhook(accessToken, whTarget).then(
        (r) => logger.info('Calendar API: Calendly webhook auto-registered', { op: 'calendar.calendly.callback', user_id: String(userId), result: r?.created ? 'created' : r?.alreadyExists ? 'already_exists' : 'ok' }),
        (e) => logger.warn(`Calendar API: Calendly webhook auto-register failed — ${e.message}`),
      );
    } else {
      logger.info('Calendar API: CALENDLY_WEBHOOK_TARGET_URL not set — skipping auto-registration');
    }

    const redirect = process.env.CALENDLY_OAUTH_SUCCESS_REDIRECT?.trim();
    if (redirect) return res.redirect(302, redirect);

    const integ = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' }).select('calendly_slug calendly_slug_mismatch').lean();
    return res.json({ success: true, message: 'Calendly connected', provider: 'calendly', calendly_slug: integ?.calendly_slug ?? null, calendly_slug_mismatch: Boolean(integ?.calendly_slug_mismatch) });
  } catch (err) {
    logger.warn(`Calendly callback: ${err.message}`);
    return res.status(400).json({ success: false, message: err.message });
  }
};

const getCalendarStatus = async (req, res) => {
  const rows = await CalendarIntegration.find({ user_id: req.user._id }).select('provider account_email expires_at updatedAt').lean();
  return res.json({ success: true, status: rows });
};

const getBookings = (_req, res) => res.json({
  success: true, bookings: [], message: 'Not implemented — use GET /api/calendar/status and OAuth tokens in CalendarIntegration',
});

const registerWebhookSubscription = async (req, res) => {
  try {
    const webhookUrl = resolveWebhookUrl(req.body);
    if (!webhookUrl) return res.status(400).json({ success: false, message: 'Provide webhookUrl in body or set CALENDLY_WEBHOOK_TARGET_URL in .env' });
    const result = await registerCalendlyInviteeWebhook(req.calendlyInteg.access_token, webhookUrl);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.warn(`Calendly webhook register: ${err.message}`);
    return res.status(502).json({ success: false, message: err.message });
  }
};

const registerWebhookSubscriptionEmbed = async (req, res) => {
  try {
    const webhookUrl = resolveWebhookUrl(req.body);
    if (!webhookUrl) return res.status(400).json({ success: false, message: 'webhookUrl required in body or set CALENDLY_WEBHOOK_TARGET_URL' });
    const result = await registerCalendlyInviteeWebhook(req.calendlyInteg.access_token, webhookUrl);
    logger.info('Calendar API: webhook subscription via embed', { op: 'calendar.calendly.webhook_register_embed', user_id: String(req.embed.user_id) });
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.warn(`Calendly webhook register (embed): ${err.message}`);
    return res.status(502).json({ success: false, message: err.message });
  }
};

const listWebhooksEmbed = async (req, res) => {
  try {
    const data = await listCalendlyWebhookSubscriptions(req.calendlyInteg.access_token);
    return res.json({ success: true, ...data });
  } catch (err) {
    logger.warn(`Calendly list webhooks (embed): ${err.message}`);
    return res.status(502).json({ success: false, message: err.message });
  }
};

const simulateInviteeCreatedEmbed = async (req, res) => {
  try {
    const conversationId = String(req.body?.conversationId || '').trim();
    const email          = String(req.body?.email || 'simulate@example.com').trim();
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ success: false, message: 'JSON body needs a valid conversationId (Mongo ObjectId)' });
    }
    const conv = await ChatConversation.findOne({ _id: conversationId, user_id: req.embed.user_id }).select('_id').lean();
    if (!conv) return res.status(404).json({ success: false, message: 'conversationId not found for this embed owner' });

    const processResult = await processCalendlyWebhook({
      event: 'invitee.created',
      payload: { email, uri: 'https://api.calendly.com/scheduled_events/simulate/invitees/simulate', event: 'https://api.calendly.com/scheduled_events/simulate', tracking: { utm_content: conversationId, utm_source: 'nesti_simulate' } },
    });
    const updated = await ChatConversation.findById(conversationId).select('calendly_booking_status calendly_booking_at intent').lean();
    logger.info('Calendar API: simulated invitee.created (embed)', { op: 'calendar.calendly.simulate_embed', user_id: String(req.embed.user_id), conversation_id: conversationId });
    return res.json({ success: true, simulated: true, processResult, conversation: updated });
  } catch (err) {
    logger.warn(`Calendly simulate (embed): ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const disconnectCalendar = async (req, res) => {
  await CalendarIntegration.deleteOne({ user_id: req.user._id, provider: 'calendly' });
  logger.info('Calendar API: Calendly disconnected', { op: 'calendar.calendly.disconnect', user_id: String(req.user._id) });
  return res.json({ success: true, message: 'Calendly disconnected' });
};

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/connect/calendly/embed',                requireEmbedFeature, loadEmbed, connectCalendlyByEmbed);
router.get('/status/embed',                          requireEmbedFeature, loadEmbed, getCalendarStatusByEmbed);
router.post('/calendly/webhook-subscription',        protect, requireCalendlyConnected, validateBody(webhookSubscriptionBodySchema), registerWebhookSubscription);
router.post('/calendly/webhook-subscription/embed',  requireEmbedFeature, loadEmbed, requireCalendlyConnected, validateBody(webhookSubscriptionBodySchema), registerWebhookSubscriptionEmbed);
router.get('/calendly/webhook-subscriptions/embed',  requireDevFeature, loadEmbed, requireCalendlyConnected, listWebhooksEmbed);
router.post('/calendly/simulate-invitee-created/embed', requireDevFeature, loadEmbed, validateBody(simulateInviteeBodySchema), simulateInviteeCreatedEmbed);
router.get('/connect/:provider',                     protect, requireCalendlyProvider, connectCalendar);
router.get('/callback/:provider',                    requireCalendlyProvider, callbackCalendar);
router.get('/status',                                protect, getCalendarStatus);
router.get('/bookings',                              protect, getBookings);
router.delete('/disconnect/:provider',               protect, requireCalendlyProvider, disconnectCalendar);

export default router;
