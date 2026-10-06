import { ADMIN_PERMISSION, adminHasPermission } from '../../constants/adminPermissions.js';
import { fail, ok } from './adminCommon.js';
import {
  ensureLandingEmbed,
  findLandingEmbed,
  landingChatPlanCards,
  landingSettingsView,
  loadLandingChatSettings,
  saveLandingChatSettings,
} from '../chat/nestiLanding/landingChatConfig.js';

function canRead(user) {
  return adminHasPermission(user, ADMIN_PERMISSION.LEADS_READ) || adminHasPermission(user, ADMIN_PERMISSION.CLIENTS_READ);
}

function canWrite(user) {
  return adminHasPermission(user, ADMIN_PERMISSION.LEADS_WRITE) || adminHasPermission(user, ADMIN_PERMISSION.CLIENTS_WRITE);
}

export async function adminGetLandingChatSettingsService(actorUser) {
  if (!canRead(actorUser)) return fail(403, 'Missing read permission');
  const [doc, embed] = await Promise.all([loadLandingChatSettings(), findLandingEmbed()]);
  return ok(landingSettingsView(doc, embed));
}

export async function adminSaveLandingChatSettingsService(body, actorUser) {
  if (!canWrite(actorUser)) return fail(403, 'Missing write permission');
  const doc = await saveLandingChatSettings(body || {});
  const embed = await findLandingEmbed();
  return ok(landingSettingsView(doc, embed));
}

export async function adminEnsureLandingEmbedService(actorUser) {
  if (!canWrite(actorUser)) return fail(403, 'Missing write permission');
  const created = await ensureLandingEmbed();
  if (!created.ok) return fail(400, created.message);
  const doc = await loadLandingChatSettings();
  return ok({
    ...landingSettingsView(doc, created.embed),
    embed_token: created.token,
    reused: Boolean(created.reused),
  });
}

export async function publicLandingChatConfigService() {
  const doc = await loadLandingChatSettings().catch(() => null);
  let embed = await findLandingEmbed().catch(() => null);
  const view = landingSettingsView(doc, embed);
  if (view.enabled && !embed) {
    const created = await ensureLandingEmbed().catch(() => null);
    embed = created?.ok ? created.embed : embed;
  }
  const enabled = view.enabled && Boolean(embed?.token);
  return {
    status: 200,
    body: {
      success: true,
      enabled,
      welcome_message: view.welcome_message,
      display_name: view.display_name,
      consent_line: view.consent_line,
      embed_token: enabled ? embed.token : '',
      plans: landingChatPlanCards(),
    },
  };
}
