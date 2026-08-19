import { PublicProfile } from '../../models/index.js';
import {
  publicProfileUnavailableResponse,
  userCanServePublicProfile,
} from './publicProfileAccess.js';
import { serializeClientFeedbackItem } from './publicProfileMappers.js';

export async function submitPublicFeedbackService({ slug, payload }) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) {
    return { status: 400, body: { success: false, message: 'Invalid profile' } };
  }

  const profile = await PublicProfile.findOneAndUpdate(
    { slug: normalizedSlug, enabled: true },
    {
      $push: {
        feedback_submissions: {
          $each: [{
            client_name: payload.client_name,
            email: payload.email,
            rating: payload.rating,
            text: payload.text,
            submitted_at: new Date(),
          }],
          $slice: -100,
        },
      },
    },
    { new: false },
  ).select('_id');

  if (!profile) return publicProfileUnavailableResponse();
  return {
    status: 201,
    body: {
      success: true,
      message: 'Thank you. Your feedback is now published.',
    },
  };
}

export async function getApprovedPublicFeedbackService(slug) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) {
    return { status: 400, body: { success: false, message: 'Invalid profile' } };
  }

  const profile = await PublicProfile.findOne({ slug: normalizedSlug, enabled: true })
    .select('user_id feedback_submissions')
    .lean();
  if (!profile || !(await userCanServePublicProfile(profile.user_id))) {
    return publicProfileUnavailableResponse();
  }

  const feedback = (profile.feedback_submissions || [])
    .sort((left, right) => new Date(right.submitted_at) - new Date(left.submitted_at))
    .map(serializeClientFeedbackItem);
  return {
    status: 200,
    body: {
      success: true,
      feedback,
      count: feedback.length,
    },
  };
}
