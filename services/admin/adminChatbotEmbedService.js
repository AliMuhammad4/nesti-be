import crypto from 'crypto';
import mongoose from 'mongoose';
import ChatbotEmbedUrl from '../../models/ChatbotEmbedUrl.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { validateWidgetRoleAgainstProfile } from '../../utils/embedWidgetRole.js';
import { getOrCreateSubscriptionForUser } from '../billing/subscriptionService.js';
import { FEATURES, hasFeature } from '../billing/entitlements.js';
import { ok, fail } from './adminCommon.js';

async function resolveProfessionalUserId(professionalId) {
  if (!mongoose.Types.ObjectId.isValid(professionalId)) {
    return { error: fail(400, 'Invalid professional id') };
  }
  const profile = await ProfessionalProfile.findById(professionalId)
    .select('user_id professional_type')
    .lean();
  if (!profile?.user_id) {
    return { error: fail(404, 'Professional not found') };
  }
  return { userId: profile.user_id, profile };
}

function serializeEmbed(embed) {
  if (!embed) return null;
  const settings =
    embed.widget_settings && typeof embed.widget_settings === 'object'
      ? embed.widget_settings
      : {};
  return {
    id: String(embed._id),
    _id: String(embed._id),
    token: embed.token,
    unique_token: embed.token,
    widget_role: embed.widget_role || null,
    allowed_domains: embed.allowed_domains || [],
    widget_settings: settings,
    is_active: settings.is_active !== false,
    createdAt: embed.createdAt,
    updatedAt: embed.updatedAt,
  };
}

/**
 * Honor the same CHATBOT_BASIC plan gate as POST /api/embed/generate
 * (requireFeature(FEATURES.CHATBOT_BASIC) on the professional route).
 */
async function assertProfessionalChatbotFeature(userId) {
  const user = await User.findById(userId).select('role').lean();
  if (!user) return fail(404, 'Professional user not found');
  const subscription = await getOrCreateSubscriptionForUser(user);
  if (!hasFeature(subscription, FEATURES.CHATBOT_BASIC)) {
    return fail(403, 'This feature is not included in your current subscription plan.', {
      code: 'FEATURE_NOT_INCLUDED',
      feature: FEATURES.CHATBOT_BASIC,
    });
  }
  return null;
}

/** GET — list embeds for this professional (same shape as /api/embed/list). */
export async function listAdminProfessionalChatbotEmbedsService(professionalId) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;

  const embeds = await ChatbotEmbedUrl.find({ user_id: resolved.userId })
    .sort({ createdAt: -1 })
    .lean();

  return ok({ embeds: embeds.map(serializeEmbed) });
}

/** POST — generate (or reuse) embed token for this professional. Honors plan gate. */
export async function generateAdminProfessionalChatbotEmbedService(professionalId, body = {}) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;
  const { userId, profile } = resolved;

  const gate = await assertProfessionalChatbotFeature(userId);
  if (gate) return gate;

  const existing = await ChatbotEmbedUrl.findOne({ user_id: userId })
    .sort({ createdAt: -1 })
    .lean();
  if (existing) {
    return ok({
      reused: true,
      token: existing.token,
      id: String(existing._id),
      widget_role: existing.widget_role,
      message: 'Existing embed token returned',
      embed: serializeEmbed(existing),
    });
  }

  const raw =
    body.widget_role != null && String(body.widget_role).trim() !== ''
      ? String(body.widget_role).trim()
      : profile?.professional_type || PROFESSIONAL_TYPE.AGENT;

  const roleCheck = validateWidgetRoleAgainstProfile(raw, profile);
  if (!roleCheck.ok) {
    return fail(400, roleCheck.message);
  }

  const widgetSettings =
    body.widget_settings && typeof body.widget_settings === 'object'
      ? { ...body.widget_settings }
      : {};

  const token = crypto.randomBytes(24).toString('hex');
  const embed = await ChatbotEmbedUrl.create({
    user_id: userId,
    token,
    widget_role: raw,
    allowed_domains: body.allowed_domains || [],
    widget_settings: widgetSettings,
  });

  return ok({
    reused: false,
    token: embed.token,
    id: String(embed._id),
    widget_role: embed.widget_role,
    message: 'Embed token generated',
    embed: serializeEmbed(embed.toObject ? embed.toObject() : embed),
  });
}

/** PATCH — update embed owned by this professional. */
export async function patchAdminProfessionalChatbotEmbedService(
  professionalId,
  embedId,
  body = {},
) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;
  if (!mongoose.Types.ObjectId.isValid(embedId)) {
    return fail(400, 'Invalid embed id');
  }

  const existing = await ChatbotEmbedUrl.findOne({
    _id: embedId,
    user_id: resolved.userId,
  });
  if (!existing) return fail(404, 'Embed not found');

  const patch = { ...body };
  delete patch.user_id;
  delete patch.token;

  if (Object.prototype.hasOwnProperty.call(patch, 'widget_role')) {
    const wr = patch.widget_role;
    if (wr != null && String(wr).trim() !== '') {
      const v = String(wr).trim();
      const roleCheck = validateWidgetRoleAgainstProfile(v, resolved.profile);
      if (!roleCheck.ok) return fail(400, roleCheck.message);
      patch.widget_role = v;
    } else {
      delete patch.widget_role;
    }
  }

  // Pause/activate is stored on widget_settings (model has no top-level is_active).
  if (Object.prototype.hasOwnProperty.call(patch, 'is_active')) {
    const nextSettings = {
      ...(existing.widget_settings || {}),
      ...(patch.widget_settings && typeof patch.widget_settings === 'object'
        ? patch.widget_settings
        : {}),
      is_active: Boolean(patch.is_active),
    };
    patch.widget_settings = nextSettings;
    delete patch.is_active;
  }

  Object.assign(existing, patch);
  await existing.save();

  return ok({ embed: serializeEmbed(existing.toObject()) });
}

/** DELETE — remove embed owned by this professional. */
export async function deleteAdminProfessionalChatbotEmbedService(professionalId, embedId) {
  const resolved = await resolveProfessionalUserId(professionalId);
  if (resolved.error) return resolved.error;
  if (!mongoose.Types.ObjectId.isValid(embedId)) {
    return fail(400, 'Invalid embed id');
  }

  const deleted = await ChatbotEmbedUrl.findOneAndDelete({
    _id: embedId,
    user_id: resolved.userId,
  });
  if (!deleted) return fail(404, 'Embed not found');

  return ok({ message: 'Embed deleted' });
}
