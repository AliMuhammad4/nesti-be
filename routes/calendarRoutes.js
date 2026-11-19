import express from 'express';
import mongoose from 'mongoose';
import { protect, requireCompleteProfessionalProfile } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/subscriptionAccess.js';
import { validateBody } from '../middleware/validate.js';
import { FEATURES } from '../services/billing/entitlements.js';
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
} from '../services/calendly/oauthService.js';
import { applyCalendlyOAuthAlignment, calendlyWebhookAlignmentMeta } from '../services/calendly/calendlyAlignmentService.js';
import { listCalendlyWebhookSubscriptions, registerCalendlyInviteeWebhook } from '../services/calendly/registerInviteeWebhook.js';
import { applyCalendlyCancellationToLeadForUser, processCalendlyWebhook } from '../services/calendly/calendlyWebhookService.js';
import { notifyCalendlySyncRestored } from '../services/calendly/calendlyNotifications.js';
import { CALENDLY_WEBHOOK_ERROR_KINDS, calendlyWebhookErrorKind, userFacingCalendlyRegisterError } from '../utils/calendlyWebhookErrors.js';
import { isTransientCalendlyError } from '../services/calendly/calendlyHttp.js';
import {
  CALENDLY_ACCESS_KIND,
  CalendlyAccessError,
  ensureFreshCalendlyAccess,
} from '../services/calendly/calendlyTokenService.js';
import {
  attentionKindForCalendlyError,
  checkCalendlyConnectionHealth,
  markCalendlyReconnectRequired,
  persistCalendlyWebhookState,
} from '../services/calendly/calendlyConnectionHealth.js';
import { listBookedAppointmentsForUser } from '../services/calendar/calendarBookingsService.js';

const router = express.Router();

// ─── Feature flags ────────────────────────────────────────────────────────────

// Embed-token Calendly routes and the test-booking (simulate) tools are off unless explicitly enabled.
const embedAllowed  = () => process.env.CALENDLY_CONNECT_BY_EMBED === 'true';
const devAllowed    = () => process.env.CALENDLY_DEV_TOOLS === 'true';

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

const CALENDLY_UNAVAILABLE_MESSAGE = 'Calendly is not responding right now. Please try again in a moment.';
/** Max time a status load waits for the (throttled) Calendly health re-check before answering. */
const STATUS_HEALTH_WAIT_MS = 4000;

/** Calendly-side failure → JSON. The codes are never session-end codes, so the user stays logged in. */
async function sendCalendlyAccessError(res, userId, err) {
  if (err?.kind === CALENDLY_ACCESS_KIND.reconnect) {
    await markCalendlyReconnectRequired(userId, err.message);
    return res.status(401).json({ success: false, code: 'CALENDLY_RECONNECT_REQUIRED', message: err.message });
  }
  return res.status(503).json({ success: false, code: 'CALENDLY_UNAVAILABLE', message: err?.message || CALENDLY_UNAVAILABLE_MESSAGE });
}

async function requireCalendlyConnected(req, res, next) {
  const userId = req.embed ? req.embed.user_id : req.user._id;
  const integ = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' });
  if (!integ?.access_token) return res.status(400).json({ success: false, message: 'Connect Calendly (OAuth) first.' });

  try {
    req.calendlyInteg = await ensureFreshCalendlyAccess(integ);
  } catch (e) {
    return sendCalendlyAccessError(res, userId, e);
  }
  next();
}

async function runBoundedCalendlyHealthCheck(userId) {
  const check = checkCalendlyConnectionHealth(userId).catch((err) => {
    logger.warn('Calendly health check failed', { op: 'calendly.health', user_id: String(userId), error: err?.message });
    return null;
  });
  let timer;
  const wait = new Promise((resolve) => {
    timer = setTimeout(resolve, STATUS_HEALTH_WAIT_MS);
    timer.unref?.();
  });
  await Promise.race([check, wait]);
  clearTimeout(timer);
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

    const priorInteg = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' })
      .select('calendly_webhook_error_kind')
      .lean();

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
        calendly_health_checked_at: null,
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
      // Fresh OAuth tokens: a stored "reconnect" state no longer applies.
      if (priorInteg?.calendly_webhook_error_kind === CALENDLY_WEBHOOK_ERROR_KINDS.reconnect) {
        await CalendarIntegration.updateOne(
          { user_id: userId, provider: 'calendly' },
          { $set: { calendly_webhook_register_error: null, calendly_webhook_error_kind: null } }
        );
        await notifyCalendlySyncRestored(userId, { previousKind: CALENDLY_WEBHOOK_ERROR_KINDS.reconnect });
      }
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
  // Throttled re-check (at most hourly per account) so an expired plan / revoked access shows up here.
  await runBoundedCalendlyHealthCheck(req.user._id);
  const rows = await CalendarIntegration.find({ user_id: req.user._id })
    .select('provider account_email expires_at updatedAt calendly_webhook_url calendly_webhook_registered_at calendly_webhook_register_error calendly_webhook_error_kind')
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

    // 'canceled' | 'not_connected' | 'not_allowed' | 'not_found'
    let calendlyOutcome = 'canceled';
    const integ = await CalendarIntegration.findOne({ user_id: userId, provider: 'calendly' });
    if (!integ?.access_token) {
      calendlyOutcome = 'not_connected';
    } else {
      try {
        const fresh = await ensureFreshCalendlyAccess(integ);
        await cancelCalendlyScheduledEvent(fresh.access_token, cancelMeta, reason || undefined);
      } catch (err) {
        if (err instanceof CalendlyAccessError) {
          if (err.kind !== CALENDLY_ACCESS_KIND.reconnect) return sendCalendlyAccessError(res, userId, err);
          await markCalendlyReconnectRequired(userId, err.message);
          calendlyOutcome = 'not_connected';
        } else if (isTransientCalendlyError(err)) {
          logger.warn(`Calendly cancel booking (temporary): ${err.message}`);
          return res.status(503).json({ success: false, code: 'CALENDLY_UNAVAILABLE', message: CALENDLY_UNAVAILABLE_MESSAGE });
        } else if (Number(err?.status) === 404) {
          calendlyOutcome = 'not_found';
        } else {
          const kind = attentionKindForCalendlyError(err);
          if (kind === CALENDLY_WEBHOOK_ERROR_KINDS.reconnect) {
            await markCalendlyReconnectRequired(userId, err.message);
            calendlyOutcome = 'not_connected';
          } else if (kind === CALENDLY_WEBHOOK_ERROR_KINDS.permission || kind === CALENDLY_WEBHOOK_ERROR_KINDS.plan) {
            calendlyOutcome = 'not_allowed';
          } else {
            logger.warn(`Calendly cancel booking: ${err.message}`);
            return res.status(400).json({
              success: false,
              code: 'CALENDLY_CANCEL_FAILED',
              message: `Calendly could not cancel this appointment: ${String(err.message || '').replace(/^Calendly cancel failed \(\d+\):\s*/, '').slice(0, 300)}`,
            });
          }
        }
      }
    }

    const apply = await applyCalendlyCancellationToLeadForUser(leadMatchId, userId, { payload: storedCal });
    if (!apply.ok) {
      return res.status(500).json({ success: false, message: apply.message || 'Could not update lead after cancel.' });
    }

    logger.info('Calendar API: booking canceled', {
      op: 'calendar.calendly.cancel_booking',
      user_id: String(userId),
      lead_match_id: String(leadMatchId),
      calendly_outcome: calendlyOutcome,
    });
    if (calendlyOutcome === 'canceled') {
      return res.json({ success: true, calendly_canceled: true, message: 'Appointment canceled in Calendly.' });
    }
    const localMessage = {
      not_connected: 'Appointment canceled in Nesti. Calendly is not connected, so please also cancel it in Calendly.',
      not_allowed: 'Appointment canceled in Nesti. Calendly did not allow the cancellation, so please also cancel it in Calendly.',
      not_found: 'Appointment canceled in Nesti. Calendly could not find this booking, so please check it in Calendly.',
    }[calendlyOutcome];
    return res.json({ success: true, calendly_canceled: false, calendly_outcome: calendlyOutcome, message: localMessage });
  } catch (err) {
    logger.warn(`Calendly cancel booking: ${err.message}`);
    return next(err);
  }
};

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/connect/calendly/embed',                requireEmbedFeature, loadEmbed, connectCalendlyByEmbed);
router.get('/status/embed',                          requireEmbedFeature, loadEmbed, getCalendarStatusByEmbed);
router.post('/calendly/webhook-subscription',        protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CALENDAR_INTEGRATION), requireCalendlyConnected, validateBody(webhookSubscriptionBearerBodySchema), registerWebhookSubscription);
router.post('/calendly/webhook-subscription/embed',  requireEmbedFeature, loadEmbed, requireCalendlyConnected, validateBody(webhookSubscriptionBodySchema), registerWebhookSubscriptionEmbed);
router.get('/calendly/webhook-subscriptions/embed',  requireDevFeature, loadEmbed, requireCalendlyConnected, listWebhooksEmbed);
router.post('/calendly/simulate-invitee-created/embed', requireDevFeature, loadEmbed, validateBody(simulateInviteeBodySchema), simulateInviteeCreatedEmbed);
router.post(
  '/calendly/cancel-booking',
  protect,
  requireCompleteProfessionalProfile,
  requireFeature(FEATURES.CALENDAR_VIRTUAL_CONSULT),
  validateBody(calendlyCancelBookingBodySchema),
  cancelCalendlyBookingHandler
);
router.get('/connect/:provider',                     protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CALENDAR_INTEGRATION), requireCalendlyProvider, connectCalendar);
router.get('/callback/:provider',                    requireCalendlyProvider, callbackCalendar);
router.get('/status',                                protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CALENDAR_INTEGRATION), getCalendarStatus);
router.get('/bookings',                              protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CALENDAR_INTEGRATION), getBookings);
router.delete('/disconnect/:provider',               protect, requireCompleteProfessionalProfile, requireFeature(FEATURES.CALENDAR_INTEGRATION), requireCalendlyProvider, disconnectCalendar);

export { cancelCalendlyBookingHandler, requireCalendlyConnected, getCalendarStatus };
export default router;
