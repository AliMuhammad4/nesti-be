import { Subscription } from '../../models/index.js';
import { FEATURES, hasFeature } from '../billing/entitlements.js';

export function publicProfileUnavailableResponse() {
  return { status: 404, body: { success: false, message: 'Profile not found' } };
}

export function normalizeUserId(value) {
  return String(value?._id || value || '').trim();
}

export async function userCanServePublicProfile(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return false;
  const subscription = await Subscription.findOne({ user_id: normalizedUserId }).lean();
  return hasFeature(subscription, FEATURES.PUBLIC_PROFILE);
}

export async function filterPublicProfileAccessByUserId(userIds = []) {
  const ids = [...new Set(userIds.map(normalizeUserId).filter(Boolean))];
  if (!ids.length) return new Map();

  const subscriptions = await Subscription.find({ user_id: { $in: ids } }).lean();
  return new Map(
    ids.map((id) => {
      const subscription = subscriptions.find((sub) => normalizeUserId(sub.user_id) === id);
      return [id, hasFeature(subscription, FEATURES.PUBLIC_PROFILE)];
    }),
  );
}
