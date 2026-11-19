import { USER_ROLE } from '../constants/roles.js';
import {
  canonicalClientTier,
  clientHasActiveFeature,
  getClientPlan,
} from '../services/client/plans.js';
import {
  getClientSubscriptionForUser,
  getClientSubscriptionPresentationForUser,
  isClientSubscriptionActive,
  shouldRefreshClientSubscriptionFromStripe,
} from '../services/client/clientSubscriptionService.js';
import { CLIENT_TRIAL_TIER, isClientTrialActive } from '../services/client/clientTrial.js';

function isAdmin(req) {
  return req.user?.role === USER_ROLE.ADMIN;
}

function isClient(req) {
  return req.user?.role === USER_ROLE.CLIENT;
}

function notAuthenticated(res) {
  return res.status(401).json({ success: false, message: 'Not authenticated' });
}

export function requireClientRole(req, res, next) {
  if (!req.user) return notAuthenticated(res);
  if (!isClient(req)) {
    return res.status(403).json({
      success: false,
      code: 'CLIENT_ROLE_REQUIRED',
      message: 'This feature is only available for client accounts.',
    });
  }
  return next();
}

function clientSubscriptionRequiredResponse(subscription) {
  const status = String(subscription?.status || '').trim().toLowerCase();
  if (status === 'past_due') {
    return {
      success: false,
      code: 'CLIENT_SUBSCRIPTION_PAST_DUE',
      message: 'Your payment is past due. Update your payment method to restore access.',
    };
  }
  return {
    success: false,
    code: 'CLIENT_SUBSCRIPTION_REQUIRED',
    message: 'An active client subscription is required to use this feature.',
  };
}

function featureDeniedResponse(tier, featureKey) {
  const plan = getClientPlan(tier);
  return {
    success: false,
    code: 'CLIENT_FEATURE_NOT_INCLUDED',
    feature: featureKey,
    plan: plan?.tier || tier || '',
    message: plan?.name
      ? `This feature is not included in ${plan.name}. Upgrade to unlock it.`
      : 'This feature is not included in your current subscription plan.',
  };
}

export async function loadClientSubscription(req, { refresh = false } = {}) {
  if (req.clientSubscription && !refresh) return req.clientSubscription;
  if (!req.user?._id) return null;
  let subscription = await getClientSubscriptionForUser(req.user._id);
  if (refresh || shouldRefreshClientSubscriptionFromStripe(subscription)) {
    await getClientSubscriptionPresentationForUser(req.user._id, { refreshFromStripe: true });
    subscription = await getClientSubscriptionForUser(req.user._id);
  }
  req.clientSubscription = subscription;
  const planActive = isClientSubscriptionActive(subscription);
  // A running signup trial gives entry-plan access until the client buys a plan.
  req.clientTrialActive = !planActive && isClientTrialActive(req.user, subscription);
  req.clientSubscriptionTier = req.clientTrialActive
    ? CLIENT_TRIAL_TIER
    : canonicalClientTier(subscription?.tier);
  req.clientSubscriptionActive = planActive || req.clientTrialActive;
  return subscription;
}

export function requireActiveClientSubscription(req, res, next) {
  if (!req.user) return notAuthenticated(res);
  if (isAdmin(req)) return next();
  if (!isClient(req)) {
    return res.status(403).json({
      success: false,
      code: 'CLIENT_ROLE_REQUIRED',
      message: 'This feature is only available for client accounts.',
    });
  }

  return loadClientSubscription(req)
    .then(() => {
      if (!req.clientSubscriptionActive) {
        return res.status(403).json(clientSubscriptionRequiredResponse(req.clientSubscription));
      }
      return next();
    })
    .catch(next);
}

export function requireClientFeature(featureKey) {
  const feature = String(featureKey || '').trim();
  return async (req, res, next) => {
    if (!req.user) return notAuthenticated(res);
    if (isAdmin(req)) return next();
    if (!isClient(req)) {
      return res.status(403).json({
        success: false,
        code: 'CLIENT_ROLE_REQUIRED',
        message: 'This feature is only available for client accounts.',
      });
    }

    try {
      await loadClientSubscription(req);
      if (!req.clientSubscriptionActive) {
        return res.status(403).json(clientSubscriptionRequiredResponse(req.clientSubscription));
      }
      if (!clientHasActiveFeature(req.clientSubscriptionTier, feature, true)) {
        return res.status(403).json(featureDeniedResponse(req.clientSubscriptionTier, feature));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
