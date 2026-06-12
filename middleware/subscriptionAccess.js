import { USER_ROLE } from '../constants/roles.js';
import {
  getFreshSubscriptionForUser,
  getOrCreateSubscriptionForUser,
} from '../services/billing/subscriptionService.js';
import {
  ACCOUNT_STATUS,
  accountStatusFromSubscription,
  getEffectivePlan,
  getPlanLimits,
  hasFeature,
} from '../services/billing/entitlements.js';
async function loadSubscription(req, { refresh = false } = {}) {
  if (req.subscription && !refresh) return req.subscription;
  const subscription = refresh
    ? await getFreshSubscriptionForUser(req.user)
    : await getOrCreateSubscriptionForUser(req.user);
  req.subscription = subscription;
  req.subscriptionAccountStatus = accountStatusFromSubscription(subscription);
  req.subscriptionPlanKey = getEffectivePlan(subscription);
  req.subscriptionLimits = getPlanLimits(req.subscriptionPlanKey);
  return subscription;
}

function isAdmin(req) {
  return req.user?.role === USER_ROLE.ADMIN;
}

export function requireActiveSubscriptionAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (isAdmin(req)) return next();

  return loadSubscription(req)
    .then(() => {
      if (req.subscriptionAccountStatus === ACCOUNT_STATUS.EXPIRED) {
        return res.status(403).json({
          success: false,
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'Your subscription is not active. Please choose a plan to continue.',
        });
      }
      return next();
    })
    .catch(next);
}

function featureDeniedResponse(req, featureKey) {
  return {
    success: false,
    code: 'FEATURE_NOT_INCLUDED',
    feature: featureKey,
    plan: req.subscriptionPlanKey,
    message: 'This feature is not included in your current subscription plan.',
  };
}

export function requireFeature(featureKey) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (isAdmin(req)) return next();

    try {
      const subscription = await loadSubscription(req);
      if (!hasFeature(subscription, featureKey)) {
        return res.status(403).json(featureDeniedResponse(req, featureKey));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function requireAnyFeature(...featureKeys) {
  const keys = featureKeys.map((k) => String(k || '').trim()).filter(Boolean);
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (isAdmin(req)) return next();

    try {
      const subscription = await loadSubscription(req);
      const allowed = keys.some((key) => hasFeature(subscription, key));
      if (!allowed) {
        return res.status(403).json({
          ...featureDeniedResponse(req, keys[0]),
          features: keys,
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
