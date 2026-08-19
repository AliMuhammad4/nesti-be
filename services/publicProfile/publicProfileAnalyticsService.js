import { ProfileViewEvent, PublicProfile } from '../../models/index.js';
import { determineTrafficSource } from '../../utils/analyticsHelpers.js';
import {
  publicProfileUnavailableResponse,
  userCanServePublicProfile,
} from './publicProfileAccess.js';

export async function trackProfileViewService(slug, visitorData) {
  if (!slug || !visitorData.session_id) {
    return {
      status: 400,
      body: { success: false, message: 'Invalid tracking data' },
    };
  }

  const profile = await PublicProfile.findOne({ slug: slug.toLowerCase().trim() }).lean();
  if (!profile || !profile.enabled || !(await userCanServePublicProfile(profile.user_id))) {
    return publicProfileUnavailableResponse();
  }

  const event = new ProfileViewEvent({
    user_id: profile.user_id,
    visitor_id: visitorData.visitor_id,
    visitor_user_id: visitorData.visitor_user_id,
    event_type: visitorData.event_type,
    event_data: visitorData.event_data,
    session_id: visitorData.session_id,
    referrer: visitorData.referrer,
    user_agent: visitorData.user_agent,
    ip_address: visitorData.ip_address,
    duration_seconds: visitorData.duration_seconds,
    listing_id: visitorData.listing_id,
    service_id: visitorData.service_id,
    cta_type: visitorData.cta_type,
    traffic_source: determineTrafficSource(visitorData.referrer),
    timestamp: new Date(),
  });
  await event.save();

  return {
    status: 201,
    body: { success: true, message: 'Event tracked successfully' },
  };
}
