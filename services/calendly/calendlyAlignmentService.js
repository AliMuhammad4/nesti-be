import CalendarIntegration from '../../models/CalendarIntegration.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { primaryCalendlyLinkForAlignment } from '../chat/mortgageBroker/mortgageCalendlyUtils.js';
import { extractCalendlySlugFromLink } from './calendlyUrlUtils.js';
import { fetchCalendlyUserResource } from './oauthService.js';

export async function applyCalendlyOAuthAlignment(userId, accessToken) {
  const resource = await fetchCalendlyUserResource(accessToken);
  if (!resource) return;
  let slug =
    resource?.slug ||
    (resource?.scheduling_url ? extractCalendlySlugFromLink(resource.scheduling_url) : null);
  if (slug) slug = String(slug).toLowerCase().trim() || null;
  const profile = await ProfessionalProfile.findOne({ user_id: userId }).select('calendly_link').lean();
  const linkSlug = extractCalendlySlugFromLink(primaryCalendlyLinkForAlignment(profile));
  const mismatch = Boolean(slug && linkSlug && slug !== linkSlug);
  const $set = { calendly_slug_mismatch: mismatch };
  if (slug) $set.calendly_slug = slug;
  await CalendarIntegration.updateOne(
    { user_id: userId, provider: 'calendly' },
    { $set }
  );
}

export async function refreshCalendlySlugMismatchForUser(userId) {
  const integ = await CalendarIntegration.findOne({
    user_id:  userId,
    provider: 'calendly',
  })
    .select('calendly_slug')
    .lean();
  if (!integ?.calendly_slug) return;
  const profile = await ProfessionalProfile.findOne({ user_id: userId }).select('calendly_link').lean();
  const linkSlug = extractCalendlySlugFromLink(primaryCalendlyLinkForAlignment(profile));
  const oauthSlug = String(integ.calendly_slug).toLowerCase();
  const mismatch = Boolean(linkSlug && oauthSlug && linkSlug !== oauthSlug);
  await CalendarIntegration.updateOne(
    { _id: integ._id },
    { $set: { calendly_slug_mismatch: mismatch } }
  );
}

export function calendlyWebhookAlignmentMeta(integ, professionalProfile) {
  const link = primaryCalendlyLinkForAlignment(professionalProfile || {});
  if (!link) {
    return {
      calendly_webhook_alignment: 'no_calendly_link',
      calendly_oauth_connected:   false,
    };
  }
  const hasOAuth = Boolean(integ?.access_token);
  if (!hasOAuth) {
    return {
      calendly_webhook_alignment: 'no_oauth',
      calendly_oauth_connected:   false,
      calendly_profile_slug:      extractCalendlySlugFromLink(link),
    };
  }
  if (!integ.calendly_slug) {
    return {
      calendly_webhook_alignment: 'reconnect_recommended',
      calendly_oauth_connected:   true,
      calendly_profile_slug:      extractCalendlySlugFromLink(link),
    };
  }
  if (integ.calendly_slug_mismatch) {
    return {
      calendly_webhook_alignment: 'slug_mismatch',
      calendly_oauth_connected:   true,
      calendly_connected_slug:    integ.calendly_slug,
      calendly_profile_slug:      extractCalendlySlugFromLink(link),
    };
  }
  return {
    calendly_webhook_alignment: 'ok',
    calendly_oauth_connected:   true,
    calendly_connected_slug:    integ.calendly_slug,
    calendly_profile_slug:      extractCalendlySlugFromLink(link),
  };
}
