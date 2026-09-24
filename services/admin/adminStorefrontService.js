import mongoose from 'mongoose';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { fail } from './adminCommon.js';
import { recordAdminAudit } from './adminAuditService.js';
import { uploadProfileImageForUser } from '../../controllers/profileMediaController.js';
import {
  getOwnPublicProfileService,
  getOwnStorefrontDraftService,
  getOwnStorefrontPropertiesService,
  saveStorefrontDraftService,
  publishStorefrontService,
  generateStorefrontDraftService,
} from '../publicProfile/professionalDashboardService.js';
import { getStorefrontTemplateEntitlementsForUser } from '../billing/storefrontTemplates/entitlements.js';

async function resolveProfessionalUserId(professionalId) {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) {
    return { error: fail(400, 'Invalid professional id') };
  }
  const profile = await ProfessionalProfile.findById(professionalId)
    .select('user_id')
    .lean();
  if (!profile?.user_id) {
    return { error: fail(404, 'Professional not found') };
  }
  return { userId: profile.user_id };
}

export async function getAdminProfessionalStorefrontService(professionalId) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;

  const [profileResult, entitlementsResult] = await Promise.all([
    getOwnPublicProfileService(resolved.userId),
    getStorefrontTemplateEntitlementsForUser(resolved.userId).catch(() => null),
  ]);

  if (profileResult.status !== 200) return profileResult;

  const entitlements = entitlementsResult?.ok
    ? entitlementsResult.entitlements
    : { templates: [] };

  return {
    status: 200,
    body: {
      ...profileResult.body,
      entitlements,
      professional_id: String(professionalId),
      user_id: String(resolved.userId),
    },
  };
}

export async function getAdminProfessionalStorefrontDraftService(professionalId) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;
  return getOwnStorefrontDraftService(resolved.userId);
}

export async function getAdminProfessionalStorefrontPropertiesService(professionalId) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;
  return getOwnStorefrontPropertiesService(resolved.userId);
}

export async function saveAdminProfessionalStorefrontDraftService(
  professionalId,
  draft,
  expected = {},
) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;
  return saveStorefrontDraftService(resolved.userId, draft, expected);
}

export async function publishAdminProfessionalStorefrontService(
  professionalId,
  draft = null,
  expected = {},
) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;
  return publishStorefrontService(resolved.userId, draft, expected);
}

export async function generateAdminProfessionalStorefrontDraftService(
  professionalId,
  input = {},
) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;
  return generateStorefrontDraftService(resolved.userId, input);
}

/**
 * Upload a storefront-scoped image owned by the professional (not the admin).
 * Multipart fields: file, kind; scope is always storefront.
 */
export async function uploadAdminProfessionalStorefrontImageService(
  professionalId,
  { file, kind } = {},
  actorUser = null,
) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;

  let result;
  try {
    result = await uploadProfileImageForUser({
      userId: resolved.userId,
      file,
      kind,
      scope: 'storefront',
    });
  } catch (err) {
    await recordAdminAudit({
      actorUserId: actorUser?._id,
      onBehalfOfUserId: resolved.userId,
      action: 'storefront.upload_image',
      targetType: 'ProfessionalProfile',
      targetId: professionalId,
      meta: { kind: kind || null, scope: 'storefront' },
      outcome: 'error',
      errorMessage: err?.message,
    });
    throw err;
  }

  await recordAdminAudit({
    actorUserId: actorUser?._id,
    onBehalfOfUserId: resolved.userId,
    action: 'storefront.upload_image',
    targetType: 'ProfessionalProfile',
    targetId: professionalId,
    meta: {
      kind: result.body?.kind || kind || null,
      scope: 'storefront',
      url: result.body?.url || null,
    },
    outcome: result.status >= 200 && result.status < 300 ? 'ok' : 'error',
    errorMessage: result.status >= 200 && result.status < 300 ? '' : result.body?.message || '',
  });

  return result;
}
