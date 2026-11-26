import { Subscription, User } from '../../models/index.js';
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
  const [owner, subscription] = await Promise.all([
    User.findById(normalizedUserId).select('_id is_active').lean(),
    Subscription.findOne({ user_id: normalizedUserId }).lean(),
  ]);
  if (!owner || owner.is_active === false) return false;
  return hasFeature(subscription, FEATURES.PUBLIC_PROFILE);
}

export async function filterPublicProfileAccessByUserId(userIds = []) {
  const ids = [...new Set(userIds.map(normalizeUserId).filter(Boolean))];
  if (!ids.length) return new Map();

  const [subscriptions, owners] = await Promise.all([
    Subscription.find({ user_id: { $in: ids } }).lean(),
    User.find({ _id: { $in: ids } }).select('_id is_active').lean(),
  ]);
  const activeOwnerIds = new Set(
    owners.filter((owner) => owner.is_active !== false).map((owner) => normalizeUserId(owner._id)),
  );
  return new Map(
    ids.map((id) => {
      if (!activeOwnerIds.has(id)) return [id, false];
      const subscription = subscriptions.find((sub) => normalizeUserId(sub.user_id) === id);
      return [id, hasFeature(subscription, FEATURES.PUBLIC_PROFILE)];
    }),
  );
}
