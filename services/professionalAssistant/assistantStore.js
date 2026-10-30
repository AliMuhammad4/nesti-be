import { randomUUID } from 'node:crypto';
import ProfessionalAssistantSetting from '../../models/ProfessionalAssistantSetting.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import User from '../../models/User.js';
import { SERVICES, idsOf, labelOf } from './catalog.js';
import { clip, freeList } from './assistantText.js';
import {
  assistantCatalog,
  applyProfileIdentity,
  introductionLine,
  prefillAssistant,
  roleForUser,
  sanitizeAssistant,
} from './assistantSettings.js';

export function assistantAllowsLeadSaving(setting) {
  if (!setting?.applied) return true;
  const actions = setting.next_actions;
  if (!Array.isArray(actions) || !actions.length) return true;
  return actions.includes('save_lead');
}

export function appliedSettingForRole(setting, role) {
  if (!setting?.applied) return null;
  if (setting.role && role && setting.role !== role) return null;
  return setting;
}

export async function loadAppliedAssistantSetting(userId) {
  if (!userId) return null;
  const doc = await ProfessionalAssistantSetting.findOne({ user_id: userId, applied: true }).lean();
  if (!doc) return null;
  const [profile, user] = await Promise.all([
    ProfessionalProfile.findOne({ user_id: userId }).select('full_name company_name website professional_type').lean(),
    User.findById(userId).select('role').lean(),
  ]);
  const role = roleForUser(user, profile);
  if (!role || !appliedSettingForRole(doc, role)) return null;
  const sanitized = applyProfileIdentity(sanitizeAssistant({ ...doc, applied: true }, role), profile);
  return { ...sanitized, introduction_line: introductionLine(sanitized, profile) };
}

export async function assistantAllowsLeadEmail(ownerUserId) {
  const setting = await loadAppliedAssistantSetting(ownerUserId);
  if (!setting?.applied) return true;
  const actions = setting.next_actions;
  if (!Array.isArray(actions) || !actions.length) return true;
  return actions.includes('notify');
}

export function draftFaqs(setting, profile) {
  const role = setting?.role;
  const name = clip(profile?.full_name, 120) || 'This professional';
  const customFaqCount = (setting?.faqs || []).filter((faq) => faq?.is_default !== true).length;
  const availableSlots = Math.max(0, 8 - customFaqCount);
  if (!availableSlots) return [];
  const services = (setting?.services || [])
    .map((id) => labelOf(SERVICES[role] || [], id) || id);
  const expertise = freeList(setting?.custom_expertise, 12, 100);
  const fallbackServices = services.length || expertise.length
    ? []
    : idsOf(SERVICES[role] || []).slice(0, 3).map((id) => labelOf(SERVICES[role] || [], id) || id);
  const area = (role === 'lawyer' ? setting?.jurisdictions?.[0] : '')
    || setting?.cities?.[0] || setting?.region || profile?.location || '';
  const helper = role === 'lawyer' || role === 'mortgage_broker' ? 'I help clients' : `${name} helps clients`;
  return [...services, ...expertise, ...fallbackServices].slice(0, Math.min(5, availableSlots)).map((label) => {
    return {
      question: `Can you help with ${label.toLowerCase()}?`,
      answer: `${helper} with ${label.toLowerCase()}${area ? ` in ${area}` : ''}.${setting?.unique_note ? ` ${setting.unique_note}` : ''}`,
      id: `${role}-suggested-${randomUUID()}`,
      approved: false,
      source: 'generated',
    };
  });
}

export async function readAssistantForUser(user) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id }).lean();
  const role = roleForUser(user, profile);
  if (!role) return null;
  const saved = await ProfessionalAssistantSetting.findOne({ user_id: user._id }).lean();
  const draft = saved ? sanitizeAssistant(saved, role) : prefillAssistant(role, profile);
  applyProfileIdentity(draft, profile);
  draft.display_name = draft.display_name || clip(profile?.full_name, 80);
  draft.applied = Boolean(saved?.applied);
  return {
    saved: Boolean(saved),
    applied: Boolean(saved?.applied),
    role,
    draft,
    catalog: assistantCatalog(role),
    voice_note: 'Selected languages apply to every written reply. This chat does not speak aloud.',
  };
}

export async function clearAssistantForUser(user) {
  if (!user?._id) return false;
  await ProfessionalAssistantSetting.deleteOne({ user_id: user._id });
  return true;
}

export async function saveAssistantForUser(user, body) {
  const profile = await ProfessionalProfile.findOne({ user_id: user._id }).lean();
  const role = roleForUser(user, profile);
  if (!role) return null;
  const next = sanitizeAssistant({ ...body, role }, role);
  const doc = await ProfessionalAssistantSetting.findOneAndUpdate(
    { user_id: user._id },
    {
      $set: { ...next, user_id: user._id, role },
      $unset: {
        introduction_mode: '',
        introduction_custom: '',
        professional_title: '',
          website_import_url: '',
          faq_upload_note: '',
          voice_accent: '',
          transfer_calls: '',
        },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, strict: false },
  ).lean();
  return sanitizeAssistant(doc, role);
}
