import mongoose from 'mongoose';
import logger from '../../utils/logger.js';
import { CALENDLY_SIGNATURE_TOLERANCE_SEC, verifyCalendlySignature } from './webhook/signature.js';
import { extractInviteeEmail, extractTrackingFromWebhook } from './webhook/tracking.js';
import { resolveOwnerUserId } from './webhook/leadLookup.js';
import {
  applyCalendlyCancellationToLeadForUser,
  handleInviteeCanceled,
  handleInviteeCreated,
} from './webhook/inviteeEvents.js';

export { CALENDLY_SIGNATURE_TOLERANCE_SEC, verifyCalendlySignature, applyCalendlyCancellationToLeadForUser };

export async function processCalendlyWebhook(body) {
  const eventName = body?.event;
  const payload   = body?.payload ?? body?.resource;

  if (!eventName || !payload) {
    logger.warn('Calendly webhook: missing event or payload', { op: 'calendly.webhook' });
    return { processed: false, reason: 'missing_fields' };
  }

  const email = extractInviteeEmail(payload);
  const trackingUtm = extractTrackingFromWebhook(body, payload, 'utm_content');
  const trackingCampaign = extractTrackingFromWebhook(body, payload, 'utm_campaign');
  const trackingSource = extractTrackingFromWebhook(body, payload, 'utm_source');
  const ownerUserIdFromCalendly = await resolveOwnerUserId(payload);
  const ownerUserIdFromTracking =
    trackingCampaign && mongoose.Types.ObjectId.isValid(String(trackingCampaign))
      ? new mongoose.Types.ObjectId(String(trackingCampaign))
      : null;
  const emailDomain = email?.includes('@') ? email.split('@').pop() : null;

  logger.info('Calendly webhook: received', {
    op:                 'calendly.webhook',
    event:              eventName,
    utm_content:        trackingUtm || null,
    utm_campaign:       trackingCampaign || null,
    utm_source:         trackingSource || null,
    has_invitee_email:  Boolean(email),
    owner_user_id_hint: ownerUserIdFromCalendly ? String(ownerUserIdFromCalendly) : null,
    owner_user_id_utm:  ownerUserIdFromTracking ? String(ownerUserIdFromTracking) : null,
    email_domain:       emailDomain,
  });

  const utmConversationId = trackingUtm && mongoose.Types.ObjectId.isValid(trackingUtm) ? new mongoose.Types.ObjectId(trackingUtm) : null;
  if (!email && eventName.startsWith('invitee.') && !utmConversationId) {
    logger.warn('Calendly webhook: no invitee email and no utm conversation id', { op: 'calendly.webhook', event: eventName });
    return { processed: true, matched: false, reason: 'no_email_or_utm' };
  }

  const ctx = {
    email,
    trackingUtm,
    trackingSource,
    ownerUserIdFromCalendly,
    ownerUserIdFromTracking,
    payload,
    emailDomain,
  };

  if (eventName === 'invitee.created')  return handleInviteeCreated(ctx);
  if (eventName === 'invitee.canceled') return handleInviteeCanceled(ctx);

  logger.debug('Calendly webhook: ignored event', { op: 'calendly.webhook', event: eventName });
  return { processed: true, matched: false, reason: 'event_not_handled' };
}
