import PublicProfile from '../../../models/PublicProfile.js';
import {
  ensureFreeStorefrontTemplateUnlock,
  serializeStorefrontTemplateEntitlements,
} from './access.js';
import { refreshStorefrontTemplateSubscriptionsForUser } from './refresh.js';

export async function getStorefrontTemplateEntitlementsForUser(userId) {
  await refreshStorefrontTemplateSubscriptionsForUser(userId).catch(() => null);
  const profile = await PublicProfile.findOne({ user_id: userId });
  if (!profile) return { ok: false, code: 404, message: 'Public profile not found.' };
  await ensureFreeStorefrontTemplateUnlock(profile);
  if (profile.isModified('storefront')) await profile.save();
  return { ok: true, entitlements: serializeStorefrontTemplateEntitlements(profile) };
}
