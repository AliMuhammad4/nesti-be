import express from 'express';
import mongoose from 'mongoose';
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { validateBody } from '../middleware/validate.js';
import {
  webhookSubscriptionBodySchema,
  webhookSubscriptionBearerBodySchema,
  simulateInviteeBodySchema,
  calendlyCancelBookingBodySchema,
} from '../schemas/calendarRouteSchemas.js';
import CalendarIntegration from '../models/CalendarIntegration.js';
import LeadMatch from '../models/LeadMatch.js';
import WorkspaceAppointment from '../models/WorkspaceAppointment.js';
import { cancelCalendlyScheduledEvent } from '../services/calendly/cancelCalendlyBooking.js';
import ChatbotEmbedUrl from '../models/ChatbotEmbedUrl.js';
import ChatConversation from '../models/ChatConversation.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import logger from '../utils/logger.js';
import {
  buildCalendlyAuthorizeUrl,
  createCalendlyOAuthState,
  exchangeCalendlyAuthorizationCode,
  fetchCalendlyAccountLabel,
  fetchCalendlyUserResource,
  parseCalendlyOAuthState,
  refreshCalendlyAccessToken,
} from '../services/calendly/oauthService.js';
import { applyCalendlyOAuthAlignment, calendlyWebhookAlignmentMeta } from '../services/calendly/calendlyAlignmentService.js';
import { listCalendlyWebhookSubscriptions, registerCalendlyInviteeWebhook } from '../services/calendly/registerInviteeWebhook.js';
import { applyCalendlyCancellationToLeadForUser, processCalendlyWebhook } from '../services/calendly/calendlyWebhookService.js';
import { calendlyWebhookErrorKind, userFacingCalendlyRegisterError } from '../utils/calendlyWebhookErrors.js';
import { listBookedAppointmentsForUser } from '../services/calendar/calendarBookingsService.js';

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

/** Refresh OAuth token this many ms before Calendly expiry so cancel/webhooks don’t hit 401. */
const CALENDLY_REFRESH_SKEW_MS = 5 * 60 * 1000;

async function requireCalendlyConnected(req, res, next) {
  const userId = req.embed ? req.embed.user_id : req.user._id;
  let integ = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' });
  if (!integ?.access_token) return res.status(400).json({ success: false, message: 'Connect Calendly (OAuth) first.' });

  const expiresAt = integ.expires_at ? new Date(integ.expires_at).getTime() : 0;
  const staleOrUnknownExpiry = !expiresAt || expiresAt < Date.now() + CALENDLY_REFRESH_SKEW_MS;
  if (staleOrUnknownExpiry && integ.refresh_token) {
    try {
      const tokens = await refreshCalendlyAccessToken(integ.refresh_token);
      const accessToken = tokens.access_token;
      const newRefresh = tokens.refresh_token || integ.refresh_token;
      const newExpires = new Date(Date.now() + (Number(tokens.expires_in) || 7200) * 1000);
      integ = await CalendarIntegration.findOneAndUpdate(
        { _id: integ._id },
        { $set: { access_token: accessToken, refresh_token: newRefresh, expires_at: newExpires } },
        { returnDocument: 'after' },
      );
      logger.info('Calendar API: Calendly access token refreshed', { op: 'calendar.calendly.refresh', user_id: String(userId) });
    } catch (e) {
      logger.warn(`Calendly token refresh: ${e.message}`);
      return res.status(401).json({
        success: false,
        message:
          'Calendly connection expired. Open Settings and disconnect, then connect Calendly again (or wait a moment and retry).',
      });
    }
  } else if (staleOrUnknownExpiry && !integ.refresh_token) {
    return res.status(401).json({
      success: false,
      message: 'Calendly access expired and no refresh token is stored. Connect Calendly again in Settings.',
    });
  }

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

function resolveWebhookUrlFromRequest(req) {
  try {
    const protoRaw =
      String(req.get('x-forwarded-proto') || req.protocol || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
    const proto = protoRaw === 'https' ? 'https' : protoRaw === 'http' ? 'http' : '';
    const host = String(req.get('x-forwarded-host') || req.get('host') || '')
      .split(',')[0]
      .trim();
    if (!proto || !host) return '';
    const hostLower = host.toLowerCase();
    // Calendly cannot deliver to localhost; only use derived URL when we have a public host (e.g. ngrok).
    if (hostLower.includes('localhost') || hostLower.startsWith('127.0.0.1')) return '';
    // Prefer https for public tunnels (ngrok).
    if (proto !== 'https') return '';
    return `${proto}://${host}/api/webhooks/calendly`;
  } catch {
    return '';
  }
}

/**
 * When Calendly redirects the browser to the API callback, we should 302 to the web app
 * so users do not see raw JSON. Optional CALENDLY_OAUTH_SUCCESS_REDIRECT overrides;
 * else FRONTEND_URL + /settings (Calendly card is on the personal tab).
 */
function resolveCalendlyOAuthSuccessBrowserRedirect() {
  const explicit = process.env.CALENDLY_OAUTH_SUCCESS_REDIRECT?.trim();
  if (explicit) return explicit;
  const fe = process.env.FRONTEND_URL?.trim().replace(/\/$/, '');
  if (fe) return `${fe}/calendly-callback?calendly=connected`;
  return null;
}

function resolveCalendlyOAuthErrorBrowserRedirect() {
  const explicit = process.env.CALENDLY_OAUTH_ERROR_REDIRECT?.trim();
  if (explicit) return explicit;
  const fe = process.env.FRONTEND_URL?.trim().replace(/\/$/, '');
  if (fe) return `${fe}/calendly-callback?calendly=error`;
  return null;
}

async function persistCalendlyWebhookState(userId, { targetUrl, error }) {
  const url = String(targetUrl || '').trim() || null;
  if (error) {
    const kind = calendlyWebhookErrorKind(String(error));
    const msg = userFacingCalendlyRegisterError(kind, String(error));
    await CalendarIntegration.updateOne(
      { user_id: userId, provider: 'calendly' },
      { $set: { calendly_webhook_url: url, calendly_webhook_register_error: msg, calendly_webhook_error_kind: kind, calendly_webhook_registered_at: null } }
    );
  } else {
    await CalendarIntegration.updateOne(
      { user_id: userId, provider: 'calendly' },
      { $set: { calendly_webhook_url: url, calendly_webhook_register_error: null, calendly_webhook_error_kind: null, calendly_webhook_registered_at: new Date() } }
    );
  }
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
    CalendarIntegration.find({ user_id: userId })
      .select('provider account_email expires_at updatedAt calendly_slug calendly_slug_mismatch calendly_webhook_url calendly_webhook_registered_at calendly_webhook_register_error calendly_webhook_error_kind')
      .lean(),
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
      const errRedirect = resolveCalendlyOAuthErrorBrowserRedirect();
      if (errRedirect) {
        const reason = String(errorDescription || error || 'denied').slice(0, 400);
        const join = errRedirect.includes('?') ? '&' : '?';
        return res.redirect(302, `${errRedirect}${join}reason=${encodeURIComponent(reason)}`);
      }
      return res.status(400).json({ success: false, message: errorDescription || error || 'Calendly authorization denied' });
    }
    if (!code || !state) {
      const errRedirect = resolveCalendlyOAuthErrorBrowserRedirect();
      if (errRedirect) {
        const join = errRedirect.includes('?') ? '&' : '?';
        return res.redirect(302, `${errRedirect}${join}reason=${encodeURIComponent('Missing authorization response')}`);
      }
      return res.status(400).json({ success: false, message: 'Missing code or state' });
    }

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

    const whTarget = process.env.CALENDLY_WEBHOOK_TARGET_URL?.trim() || resolveWebhookUrlFromRequest(req);
    let webhook = { attempted: false, ok: null, url: null, alreadyExists: null, error: null, errorKind: null };
    if (whTarget) {
      webhook = { ...webhook, attempted: true, url: whTarget };
      try {
        const r = await registerCalendlyInviteeWebhook(accessToken, whTarget);
        await persistCalendlyWebhookState(userId, { targetUrl: whTarget, error: null });
        webhook.ok = true;
        webhook.alreadyExists = Boolean(r?.alreadyExists);
        logger.info('Calendar API: Calendly webhook auto-registered', {
          op: 'calendar.calendly.callback',
          user_id: String(userId),
          result: r?.created ? 'created' : r?.alreadyExists ? 'already_exists' : 'ok',
        });
      } catch (e) {
        const kind = calendlyWebhookErrorKind(e.message);
        await persistCalendlyWebhookState(userId, { targetUrl: whTarget, error: e.message });
        webhook.ok = false;
        webhook.errorKind = kind;
        webhook.error = userFacingCalendlyRegisterError(kind, e.message);
        logger.warn(`Calendar API: Calendly webhook auto-register failed — ${e.message}`);
      }
    } else {
      logger.info('Calendar API: webhook target URL not resolved — skipping auto-registration');
    }

    const browserOk = resolveCalendlyOAuthSuccessBrowserRedirect();
    if (browserOk) return res.redirect(302, browserOk);

    const integ = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' }).select('calendly_slug calendly_slug_mismatch').lean();
    return res.json({
      success: true,
      message: 'Calendly connected',
      provider: 'calendly',
      calendly_slug: integ?.calendly_slug ?? null,
      calendly_slug_mismatch: Boolean(integ?.calendly_slug_mismatch),
      webhook,
    });
  } catch (err) {
    logger.warn(`Calendly callback: ${err.message}`);
    const errRedirect = resolveCalendlyOAuthErrorBrowserRedirect();
    if (errRedirect) {
      const join = errRedirect.includes('?') ? '&' : '?';
      return res.redirect(302, `${errRedirect}${join}reason=${encodeURIComponent(err.message.slice(0, 400))}`);
    }
    return res.status(400).json({ success: false, message: err.message });
  }
};

const getCalendarStatus = async (req, res) => {
  const rows = await CalendarIntegration.find({ user_id: req.user._id })
    .select('provider account_email expires_at updatedAt calendly_webhook_url calendly_webhook_registered_at calendly_webhook_register_error')
    .lean();
  return res.json({ success: true, status: rows });
};

const getBookings = async (req, res, next) => {
  try {
    const bookings = await listBookedAppointmentsForUser(req.user._id);
    return res.json({ success: true, bookings });
  } catch (e) {
    return next(e);
  }
};

const registerWebhookSubscription = async (req, res) => {
  const webhookUrl = resolveWebhookUrl(req.body) || resolveWebhookUrlFromRequest(req);
  try {
    if (!webhookUrl) return res.status(400).json({ success: false, message: 'Provide webhookUrl in body or set CALENDLY_WEBHOOK_TARGET_URL in .env' });
    const result = await registerCalendlyInviteeWebhook(req.calendlyInteg.access_token, webhookUrl);
    await persistCalendlyWebhookState(req.user._id, { targetUrl: webhookUrl, error: null });
    return res.json({ success: true, ...result });
  } catch (err) {
    if (webhookUrl) {
      try { await persistCalendlyWebhookState(req.user._id, { targetUrl: webhookUrl, error: err.message }); }
      catch (_e) { /* ignore */ }
    }
    logger.warn(`Calendly webhook register: ${err.message}`);
    return res.status(502).json({ success: false, message: err.message });
  }
};

const registerWebhookSubscriptionEmbed = async (req, res) => {
  const webhookUrl = resolveWebhookUrl(req.body) || resolveWebhookUrlFromRequest(req);
  try {
    if (!webhookUrl) return res.status(400).json({ success: false, message: 'webhookUrl required in body or set CALENDLY_WEBHOOK_TARGET_URL' });
    const result = await registerCalendlyInviteeWebhook(req.calendlyInteg.access_token, webhookUrl);
    await persistCalendlyWebhookState(req.embed.user_id, { targetUrl: webhookUrl, error: null });
    logger.info('Calendar API: webhook subscription via embed', { op: 'calendar.calendly.webhook_register_embed', user_id: String(req.embed.user_id) });
    return res.json({ success: true, ...result });
  } catch (err) {
    if (webhookUrl) {
      try { await persistCalendlyWebhookState(req.embed.user_id, { targetUrl: webhookUrl, error: err.message }); }
      catch (_e) { /* ignore */ }
    }
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

const cancelCalendlyBookingHandler = async (req, res, next) => {
  try {
    const leadMatchId = req.body.lead_match_id;
    const userId = req.user._id;
    const lead = await LeadMatch.findOne({ _id: leadMatchId, user_id: userId }).lean();
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const wsAppt = await WorkspaceAppointment.findOne({
      user_id: userId,
      lead_match_id: leadMatchId,
      status: 'booked',
    })
      .sort({ recorded_at: -1 })
      .select('calendly_event_uri calendly_invitee_uri')
      .lean();

    const storedCal = lead.compatibility_factors?.calendly || {};
    const eventUri = wsAppt?.calendly_event_uri || storedCal.calendly_event_uri;
    const inviteeUri = wsAppt?.calendly_invitee_uri || storedCal.calendly_invitee_uri;

    if (!wsAppt && !storedCal.calendly_event_uri) {
      return res.status(400).json({
        success: false,
        message: 'This lead does not have an active booked appointment.',
      });
    }

    if (!eventUri && !inviteeUri) {
      return res.status(400).json({
        success: false,
        message: 'No Calendly booking metadata found. Cancel in Calendly directly.',
      });
    }

    const cancelMeta = { calendly_event_uri: eventUri, calendly_invitee_uri: inviteeUri };
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    await cancelCalendlyScheduledEvent(req.calendlyInteg.access_token, cancelMeta, reason || undefined);

    const apply = await applyCalendlyCancellationToLeadForUser(leadMatchId, userId, { payload: storedCal });
    if (!apply.ok) {
      return res.status(500).json({ success: false, message: apply.message || 'Could not update lead after cancel.' });
    }

    logger.info('Calendar API: Calendly booking canceled via API', {
      op: 'calendar.calendly.cancel_booking',
      user_id: String(userId),
      lead_match_id: String(leadMatchId),
    });
    return res.json({ success: true, message: 'Appointment canceled in Calendly.' });
  } catch (err) {
    logger.warn(`Calendly cancel booking: ${err.message}`);
    return res.status(502).json({ success: false, message: err.message || 'Calendly cancel failed' });
  }
};

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/connect/calendly/embed',                requireEmbedFeature, loadEmbed, connectCalendlyByEmbed);
router.get('/status/embed',                          requireEmbedFeature, loadEmbed, getCalendarStatusByEmbed);
router.post('/calendly/webhook-subscription',        protect, requireCompleteProfessionalProfile, requireCalendlyConnected, validateBody(webhookSubscriptionBearerBodySchema), registerWebhookSubscription);
router.post('/calendly/webhook-subscription/embed',  requireEmbedFeature, loadEmbed, requireCalendlyConnected, validateBody(webhookSubscriptionBodySchema), registerWebhookSubscriptionEmbed);
router.get('/calendly/webhook-subscriptions/embed',  requireDevFeature, loadEmbed, requireCalendlyConnected, listWebhooksEmbed);
router.post('/calendly/simulate-invitee-created/embed', requireDevFeature, loadEmbed, validateBody(simulateInviteeBodySchema), simulateInviteeCreatedEmbed);
router.post(
  '/calendly/cancel-booking',
  protect,
  requireCompleteProfessionalProfile,
  requireCalendlyConnected,
  validateBody(calendlyCancelBookingBodySchema),
  cancelCalendlyBookingHandler
);
router.get('/connect/:provider',                     protect, requireCompleteProfessionalProfile, requireCalendlyProvider, connectCalendar);
router.get('/callback/:provider',                    requireCalendlyProvider, callbackCalendar);
router.get('/status',                                protect, requireCompleteProfessionalProfile, getCalendarStatus);
router.get('/bookings',                              protect, requireCompleteProfessionalProfile, getBookings);
router.delete('/disconnect/:provider',               protect, requireCompleteProfessionalProfile, requireCalendlyProvider, disconnectCalendar);

export default router;
