import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import ProfessionalProfile from '../models/ProfessionalProfile.js';
import { USER_ROLE, USER_ROLE_VALUES, PROFESSIONAL_TYPE_VALUES } from '../constants/roles.js';
import { evaluateProfessionalProfileSetup } from '../utils/professionalProfileSetup.js';
import logger from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

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
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
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
    const decoded = jwt.verify(token, JWT_SECRET);
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
        'Complete your personal information and business details in Settings before using this feature. Ideal client (ICP) setup is separate and does not block workspace access.',
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

export {
  protect,
  optionalAuth,
  ensureAgent,
  ensureAgentOrMortgageBroker,
  ensureAgentPropertyMatches,
  requireCompleteProfessionalProfile,
};
