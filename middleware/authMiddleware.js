import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (req.headers.authorization) {
    if (req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else {
      token = req.headers.authorization;
    }
  } 
  // Also check for custom 'token' header just in case
  else if (req.headers.token) {
    token = req.headers.token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');

      req.user = await User.findById(decoded.id).select('-password');

      next();
    } catch (error) {
      console.error(error);
      return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }
  } else {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
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
  if (req.user.role !== 'agent' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Lead management is available only for agents.' });
  }
  next();
};

const ensureAgentOrMortgageBroker = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!['agent', 'mortgage_broker', 'lawyer', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Lead management is available only for agents, mortgage brokers, and lawyers.' });
  }
  next();
};

export { protect, ensureAccountStatus, ensureAgent, ensureAgentOrMortgageBroker };
