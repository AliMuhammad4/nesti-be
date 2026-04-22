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

export { protect, ensureAgent, ensureAgentOrMortgageBroker };
