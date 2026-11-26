import User from '../../models/User.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { USER_ROLE, isProfessionalRole } from '../../constants/roles.js';
import { evaluateProfessionalProfileSetup } from '../../utils/professionalProfileSetup.js';
import { getSubscriptionPresentationForUser } from '../billing/subscriptionService.js';
import {
  getClientSubscriptionForUser,
  isClientSubscriptionActive,
} from '../client/clientSubscriptionService.js';
import { canonicalClientTier } from '../client/plans.js';
import {
  CLIENT_TRIAL_TIER,
  clientTrialEndsAt,
  isClientTrialActive,
} from '../client/clientTrial.js';
import { buildCredentialGate } from '../credentials/credentialService.js';
import { presentableNames } from '../../utils/placeholderName.js';

import {
  adminPermissionsPayload,
  normalizeProfessionalProfile,
  sharedProfessionalProfile,
  SHARED_PROFILE_FIELDS,
} from './helpers/profileHelpers.js';

export const profileService = async (user, { refreshFromStripe = false } = {}) => {
  const professionalProfile = await ProfessionalProfile.findOne({ user_id: user._id })
    .select('-property_match_scoring')
    .lean();
  const hasIcpConfigured = Boolean(
    professionalProfile?.active_icp_profile_id
  );

  let subscription = await getSubscriptionPresentationForUser(user, {
    refreshFromStripe,
  });
  if (user.role === USER_ROLE.CLIENT) {
    const clientSubscription = await getClientSubscriptionForUser(user._id);
    const clientStatus = String(clientSubscription?.status || '').trim().toLowerCase();
    if (clientSubscription && isClientSubscriptionActive(clientSubscription)) {
      subscription = {
        ...subscription,
        accountStatus: 'subscribed',
        subscriptionPlan: canonicalClientTier(clientSubscription.tier) || String(clientSubscription.tier || '').trim().toLowerCase(),
        subscriptionStatus: clientStatus || 'active',
        subscriptionEndsAt: clientSubscription.current_period_end || null,
        cancelAtPeriodEnd: Boolean(clientSubscription.cancel_at_period_end),
      };
    } else if (isClientTrialActive(user, clientSubscription)) {
      subscription = {
        ...subscription,
        accountStatus: 'free_trial',
        trialEndsAt: clientTrialEndsAt(user).toISOString(),
        subscriptionPlan: CLIENT_TRIAL_TIER,
        subscriptionStatus: 'trialing',
        subscriptionEndsAt: null,
        cancelAtPeriodEnd: false,
        planLimits: null,
        usage: null,
      };
    } else {
      subscription = {
        ...subscription,
        trialEndsAt: clientTrialEndsAt(user)?.toISOString() || null,
        accountStatus: 'expired',
        subscriptionPlan: canonicalClientTier(clientSubscription?.tier || subscription.subscriptionPlan) || String(clientSubscription?.tier || subscription.subscriptionPlan || '').trim().toLowerCase(),
        subscriptionStatus: clientStatus || 'expired',
        subscriptionEndsAt: clientSubscription?.current_period_end || subscription.subscriptionEndsAt || null,
        cancelAtPeriodEnd: Boolean(clientSubscription?.cancel_at_period_end),
      };
    }
  }
  const isExpired = String(subscription?.accountStatus || '').toLowerCase() === 'expired';

  let profileSetup;
  if (user.role === USER_ROLE.ADMIN) {
    profileSetup = {
      personal_complete: true,
      business_complete: true,
      is_complete: true,
      missing_fields: [],
    };
  } else if (user.role === USER_ROLE.CLIENT) {
    profileSetup = {
      personal_complete: true,
      business_complete: true,
      is_complete: true,
      missing_fields: [],
    };
  } else {
    profileSetup = evaluateProfessionalProfileSetup(user, professionalProfile);
  }

  const credentialGate = buildCredentialGate(professionalProfile, user.role);

  return {
    status: 200,
    body: {
      success: true,
      profile_setup: { ...profileSetup, icp_is_separate_from_workspace_basics: true },
      credential_gate: credentialGate,
      user: {
        id: String(user._id),
        _id: String(user._id),
        ...presentableNames(user),
        email: user.email,
        phone: user.phone || '',
        role: user.role,
        ...adminPermissionsPayload(user),
        auth_provider: user.auth_provider || 'local',
        authProvider: user.auth_provider || 'local',
        profile_image: user.profile_image || null,
        cover_image: user.cover_image || null,
        cover_image_position: user.cover_image_position || { x: 50, y: 50 },
        cover_image_zoom: user.cover_image_zoom || 1,
        accountStatus: subscription.accountStatus,
        trialEndsAt: subscription.trialEndsAt,
        subscriptionPlan: subscription.subscriptionPlan,
        subscriptionStatus: subscription.subscriptionStatus,
        subscriptionEndsAt: subscription.subscriptionEndsAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        pendingPlanKey: subscription.pendingPlanKey,
        pendingPlanEffectiveAt: subscription.pendingPlanEffectiveAt,
        planLimits: subscription.planLimits || null,
        usage: subscription.usage || null,
        credential_status: credentialGate.status,
        isExpired,
        ...(isExpired && { message: 'Account expired. Please upgrade.' }),
      },
      professionalProfile: professionalProfile
        ? {
            ...normalizeProfessionalProfile(professionalProfile),
            has_icp_configured: hasIcpConfigured,
          }
        : null,
    },
  };
};

export const publicProfileService = async (email) => {
  if (!email || !String(email).trim()) {
    return { status: 400, body: { success: false, message: 'Please provide a valid email' } };
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail })
    .select('_id first_name last_name email role is_active')
    .lean();
  // Only active professionals have a shareable profile; clients, admins and unknown emails look the same.
  if (!user || user.is_active === false || !isProfessionalRole(user.role)) {
    return { status: 404, body: { success: false, message: 'User not found' } };
  }

  const professionalProfile = await ProfessionalProfile.findOne({ user_id: user._id })
    .select(SHARED_PROFILE_FIELDS.join(' '))
    .lean();

  return {
    status: 200,
    body: {
      success: true,
      user: {
        ...presentableNames(user),
        email: user.email,
        role: user.role,
      },
      professionalProfile: sharedProfessionalProfile(professionalProfile),
    },
  };
};
