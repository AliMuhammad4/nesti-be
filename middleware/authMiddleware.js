import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { USER_ROLE, USER_ROLE_VALUES } from '../constants/roles.js';
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

const ensureAccountStatus = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  // Lazy evaluation of free trial
  if (req.user.account_status === 'free_trial' && req.user.trial_ends_at) {
    if (new Date() > new Date(req.user.trial_ends_at)) {
      req.user.account_status = 'expired';
      await req.user.save();
    }
  }

  if (req.user.account_status === 'expired') {
    return res.status(403).json({ success: false, message: 'Account expired. Please upgrade.' });
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

export { protect, ensureAccountStatus, ensureAgent, ensureAgentOrMortgageBroker };
