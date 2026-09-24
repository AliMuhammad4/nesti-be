import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import { USER_ROLE, USER_ROLE_VALUES, PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { evaluateProfessionalProfileSetup } from '../utils/professionalProfileSetup.js';
import logger from '../utils/logger.js';
import { getJwtSecret } from '../utils/jwtSecret.js';
import { ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE } from '../constants/accountStatus.js';
import { buildCredentialGate } from '../services/credentials/credentialGate.js';
import { CREDENTIAL_STATUS } from '../constants/credentialDocuments.js';
import { adminHasPermission } from '../constants/adminPermissions.js';

function readAuthToken(req) {
  const auth = req.headers.authorization;
  if (auth) {
    return auth.startsWith('Bearer ') ? auth.split(' ')[1] : auth;
  }
  return req.headers.token || null;
}

const protect = async (req, res, next) => {
  const token = readAuthToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const doc = await User.findById(decoded.id).select('-password').lean();
    if (!doc) {
      return res.status(401).json({ success: false, message: 'Not authorized, user not found' });
    }
    if (doc.is_active === false) {
      return res.status(401).json({
        success: false,
        code: ACCOUNT_SUSPENDED_CODE,
        message: ACCOUNT_SUSPENDED_MESSAGE,
      });
    }
    req.user = User.hydrate(doc);
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authorized, user not found' });
    }
    next();
  } catch (error) {
    logger.warn('Auth middleware: token verification failed', { err: error.message });
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};

const optionalAuth = async (req, res, next) => {
  const token = readAuthToken(req);
  
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = await User.findById(decoded.id).select('-password');
  } catch (error) {
    logger.warn('Optional auth: token verification failed', { err: error.message });
    req.user = null;
  }
  
  next();
};

const ensureAgent = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (req.user.role !== USER_ROLE.AGENT && req.user.role !== USER_ROLE.ADMIN) {
    return res.status(403).json({ success: false, message: 'Lead management is available only for agents.' });
  }
  next();
};

const ensureAgentOrMortgageBroker = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!USER_ROLE_VALUES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Lead management is available only for agents, mortgage brokers, and lawyers.' });
  }
  next();
};

/** Listing-based property matches (MLS-style) are agent-only; lawyers and brokers use other tabs. */
const ensureAgentPropertyMatches = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (req.user.role !== USER_ROLE.AGENT && req.user.role !== USER_ROLE.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Property matches are only available for real estate agents.',
    });
  }
  next();
};

const ensureAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (req.user.role !== USER_ROLE.ADMIN) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

/** Fine-grained admin capability check. Fail-closed: only '*' grants all; empty grants nothing. */
const requirePermission = (permission) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (req.user.role !== USER_ROLE.ADMIN) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  if (!adminHasPermission(req.user, permission)) {
    return res.status(403).json({
      success: false,
      message: 'Missing admin permission',
      permission,
    });
  }
  return next();
};

/** Blocks non-admin professionals until personal + business basics are saved (see professionalProfileSetup). */
const requireCompleteProfessionalProfile = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (req.user.role === USER_ROLE.ADMIN) {
    return next();
  }
  if (!PROFESSIONAL_TYPE_VALUES.includes(req.user.role)) {
    return next();
  }
  try {
    const professionalProfile = await ProfessionalProfile.findOne({ user_id: req.user._id }).lean();
    const profileSetup = evaluateProfessionalProfileSetup(req.user, professionalProfile);
    req.professionalProfile = professionalProfile || null;
    req.profileSetup = profileSetup;
    if (profileSetup.is_complete) {
      return next();
    }
    return res.status(403).json({
      success: false,
      code: 'PROFILE_SETUP_INCOMPLETE',
      message:
        'Complete your personal and business information in Settings before using this feature. Add your company in Personal Information and at least one service area under Where do you work. Ideal client (ICP) setup is separate and does not block workspace access.',
      profile_setup: {
        ...profileSetup,
        icp_is_separate_from_workspace_basics: true,
      },
    });
  } catch (err) {
    logger.error('requireCompleteProfessionalProfile failed', { err: err?.message });
    return res.status(500).json({ success: false, message: 'Unable to verify profile setup' });
  }
};

/**
 * Shared credential gate for professionals (admins / non-pros skip).
 * Returns null when allowed, otherwise an HTTP error payload.
 */
async function evaluateCredentialAccess(req) {
  if (!req.user) {
    return {
      status: 401,
      body: { success: false, message: 'Not authenticated' },
    };
  }
  if (req.user.role === USER_ROLE.ADMIN || !PROFESSIONAL_TYPE_VALUES.includes(req.user.role)) {
    return null;
  }
  try {
    const professionalProfile =
      req.professionalProfile
      || (await ProfessionalProfile.findOne({ user_id: req.user._id }).lean());
    req.professionalProfile = professionalProfile || null;
    const gate = buildCredentialGate(professionalProfile, req.user.role);
    req.credentialGate = gate;
    if (!gate.locked) return null;
    return {
      status: 403,
      body: {
        success: false,
        code: 'CREDENTIAL_VERIFICATION_REQUIRED',
        message: gate.reason || 'Complete professional credential verification to continue.',
        credential_gate: gate,
        credential_status: gate.status || CREDENTIAL_STATUS.NOT_STARTED,
      },
    };
  } catch (err) {
    logger.error('evaluateCredentialAccess failed', { err: err?.message });
    return {
      status: 500,
      body: { success: false, message: 'Unable to verify credentials' },
    };
  }
}

/** Blocks non-admin professionals until credentials are admin-approved. */
const ensureCredentialApproved = async (req, res, next) => {
  const denied = await evaluateCredentialAccess(req);
  if (!denied) return next();
  return res.status(denied.status).json(denied.body);
};

export {
  protect,
  optionalAuth,
  ensureAdmin,
  requirePermission,
  ensureAgent,
  ensureAgentOrMortgageBroker,
  ensureAgentPropertyMatches,
  requireCompleteProfessionalProfile,
  ensureCredentialApproved,
  evaluateCredentialAccess,
};
