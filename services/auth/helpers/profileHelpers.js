import { getSubscriptionPresentationForUser } from '../../billing/subscriptionService.js';
import {
  getClientSubscriptionForUser,
  isClientSubscriptionActive,
} from '../../client/clientSubscriptionService.js';
import { canonicalClientTier } from '../../client/plans.js';
import {
  clientTrialEndsAt,
  isClientTrialActive,
  newClientTrialFields,
} from '../../client/clientTrial.js';
import { notifySignupAwaitingDocs } from '../../credentials/credentialService.js';
import { finalizeInviteAttribution } from '../../referral/inviteService.js';
import { CREDENTIAL_STATUS } from '../../../constants/credentialDocuments.js';
import { USER_ROLE, isProfessionalRole } from '../../../constants/roles.js';
import ProfessionalProfile from '../../../models/ProfessionalProfile.js';
import logger from '../../../utils/logger.js';
import { presentableNames, PLACEHOLDER_FIRST_NAME, PLACEHOLDER_LAST_NAME } from '../../../utils/placeholderName.js';
import { experienceLabel, experienceYearsOf } from '../../../utils/experienceYears.js';

export { newClientTrialFields, clientTrialEndsAt, isClientTrialActive };

export function signupNames({ firstName, lastName }) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (first && last) return { firstName: first, lastName: last };
  return { firstName: PLACEHOLDER_FIRST_NAME, lastName: PLACEHOLDER_LAST_NAME };
}

export function adminPermissionsPayload(user) {
  if (user?.role !== USER_ROLE.ADMIN) return {};
  return {
    admin_permissions: Array.isArray(user.admin_permissions) ? user.admin_permissions : [],
  };
}

export async function resolveUserLoginPresentation(user) {
  let subscription = await getSubscriptionPresentationForUser(user).catch(() => ({}));
  if (user.role === USER_ROLE.CLIENT) {
    const clientSubscription = await getClientSubscriptionForUser(user._id).catch(() => null);
    if (clientSubscription && isClientSubscriptionActive(clientSubscription)) {
      subscription = {
        ...subscription,
        accountStatus: 'subscribed',
        subscriptionPlan: canonicalClientTier(clientSubscription.tier) || String(clientSubscription.tier || '').trim().toLowerCase(),
      };
    } else if (isClientTrialActive(user, clientSubscription)) {
      subscription = {
        ...subscription,
        accountStatus: 'free_trial',
        trialEndsAt: clientTrialEndsAt(user).toISOString(),
      };
    } else {
      subscription = {
        ...subscription,
        accountStatus: 'expired',
        trialEndsAt: clientTrialEndsAt(user)?.toISOString() || null,
      };
    }
  }

  return {
    id: String(user._id),
    _id: String(user._id),
    email: user.email,
    first_name: presentableNames(user).first_name,
    last_name: presentableNames(user).last_name,
    role: user.role,
    accountStatus: subscription?.accountStatus || 'free_trial',
    trialEndsAt: subscription?.trialEndsAt || null,
    ...adminPermissionsPayload(user),
  };
}

export const bootstrapProfessionalProfile = async (user) => {
  if (user.role === USER_ROLE.ADMIN || user.role === USER_ROLE.CLIENT) return;
  if (!isProfessionalRole(user.role)) return;

  await ProfessionalProfile.create({
    user_id: user._id,
    professional_type: user.role,
    full_name: presentableNames(user).name,
    phone: user.phone || '',
    credential_status: CREDENTIAL_STATUS.NOT_STARTED,
  });
  if (user.role === USER_ROLE.AGENT) {
    const { ensureAgentPropertyMatchScoring } = await import('../../agent/propertyMatch/scoringConfig.js');
    await ensureAgentPropertyMatchScoring(user._id);
  }
  notifySignupAwaitingDocs(user);
};

export const finalizeInviteForUser = ({ invite_token, userId, method, path }) => {
  const normalizedInviteToken = String(invite_token || '').trim();
  if (!normalizedInviteToken) return;

  finalizeInviteAttribution({
    invite_token: normalizedInviteToken,
    authenticated_user_id: userId,
    method,
    path,
  })
    .then((finResult) => {
      if (finResult?.ok === false) {
        logger.warn(`Invite attribution finalization failed after ${method}`, {
          user_id: String(userId),
          code: finResult.code,
          message: finResult.message,
        });
      }
    })
    .catch((err) => {
      logger.warn(`Invite attribution finalization failed after ${method}`, {
        user_id: String(userId),
        error: err?.message,
      });
    });
};

function normalizeProfessionalProfile(profileDoc) {
  const p = profileDoc || {};
  const toCleanArray = (value, limit = 0) => {
    const items = (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (!limit || items.length <= limit) return items;
    return items.slice(0, limit);
  };
  const splitToArray = (value, limit = 0) => {
    const text = String(value || '').trim();
    if (!text) return [];
    const items = text
      .split(/[,/|]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!limit || items.length <= limit) return items;
    return items.slice(0, limit);
  };
  const coreSpecializationTags = toCleanArray(
    p.core_specialization_tags?.length ? p.core_specialization_tags : p.specializations,
    5,
  );
  return {
    ...p,
    full_name: p.full_name || '',
    website: p.website || '',
    company_name: p.company_name || '',
    certificates: Array.isArray(p.certificates) ? p.certificates : [],
    phone: p.phone || '',
    location: p.location || '',
    target_neighborhoods: p.target_neighborhoods || '',
    experience: experienceLabel(p),
    experience_years: experienceYearsOf(p),
    license_number: p.license_number || '',
    country: p.country || null,
    jurisdiction: p.jurisdiction || '',
    nmls_id: p.nmls_id || '',
    credential_status: p.credential_status || CREDENTIAL_STATUS.NOT_STARTED,
    credential_submitted_at: p.credential_submitted_at || null,
    credential_reviewed_at: p.credential_reviewed_at || null,
    credential_reject_reason: p.credential_reject_reason || '',
    social_media: p.social_media || '',
    transaction_volume: p.transaction_volume || '',
    avg_sale_price: p.avg_sale_price || '',
    response_time: p.response_time || '',
    availability: p.availability || '',
    support_level: p.support_level || '',
    negotiation_style: p.negotiation_style || '',
    sales_approach: p.sales_approach || '',
    energy_style: p.energy_style || '',
    personality_tag: p.personality_tag || '',
    awards: p.awards || '',
    specializations: Array.isArray(p.specializations) ? p.specializations : coreSpecializationTags,
    communication_channels: Array.isArray(p.communication_channels) ? p.communication_channels : [],
    preferred_clients: Array.isArray(p.preferred_clients) ? p.preferred_clients : [],
    calendly_link: p.calendly_link || '',
    bio: p.bio || '',
    languages_spoken: toCleanArray(p.languages_spoken, 8),
    other_language_text: p.other_language_text || '',
    working_style_structured: p.working_style_structured || '',
    experience_level: p.experience_level || '',
    core_specialization_tags: coreSpecializationTags,
    working_style_tags: toCleanArray(
      p.working_style_tags?.length ? p.working_style_tags : p.working_style_structured ? [p.working_style_structured] : [],
      5,
    ),
    specialty_strength_tags: toCleanArray(p.specialty_strength_tags, 5),
    personality_style_tags: toCleanArray(
      p.personality_style_tags?.length ? p.personality_style_tags : p.personality_tag ? [p.personality_tag] : [],
      5,
    ),
    service_area_primary_zones: toCleanArray(
      p.service_area_primary_zones?.length ? p.service_area_primary_zones : splitToArray(p.target_neighborhoods, 8),
      8,
    ),
    service_area_secondary_zones: toCleanArray(p.service_area_secondary_zones, 12),
    service_area_cities: toCleanArray(p.service_area_cities, 15),
    service_area_regions: toCleanArray(p.service_area_regions, 15),
  };
}

export { normalizeProfessionalProfile };

const SHARED_PROFILE_FIELDS = [
  'full_name', 'professional_type', 'company_name', 'website', 'location',
  'target_neighborhoods', 'experience', 'experience_level', 'experience_years', 'social_media',
  'transaction_volume', 'avg_sale_price', 'response_time', 'availability',
  'support_level', 'negotiation_style', 'sales_approach', 'energy_style',
  'personality_tag', 'awards', 'bio', 'specializations', 'communication_channels',
  'preferred_clients', 'calendly_link', 'languages_spoken', 'other_language_text',
  'working_style_structured', 'core_specialization_tags', 'working_style_tags',
  'specialty_strength_tags', 'personality_style_tags', 'service_area_primary_zones',
  'service_area_secondary_zones', 'service_area_cities', 'service_area_regions',
];

export { SHARED_PROFILE_FIELDS };

export function sharedProfessionalProfile(profileDoc) {
  if (!profileDoc) return null;
  const normalized = normalizeProfessionalProfile(profileDoc);
  return Object.fromEntries(SHARED_PROFILE_FIELDS.map((key) => [key, normalized[key] ?? '']));
}
