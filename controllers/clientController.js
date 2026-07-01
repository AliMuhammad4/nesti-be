import ClientProfile from '../models/ClientProfile.js';
import User from '../models/User.js';
import {
  calculateHomeownershipMetrics,
  sanitizeClientProfileData,
  updateClientProfileMetrics,
  validateClientProfileData,
} from '../services/client/financialService.js';
import {
  createClientCheckoutSession,
  getClientSubscriptionForUser,
  cancelClientSubscription,
} from '../services/client/clientSubscriptionService.js';
import { getClientRecommendationsForUser } from '../services/matching/matchRankingService.js';
import { getClientInquiriesForUser } from '../services/client/clientInquiryService.js';
import { USER_ROLE } from '../constants/roles.js';

export async function getClientProfile(req, res) {
  try {
    const userId = req.user._id;
    let profile = await ClientProfile.findOne({ user_id: userId });

    if (!profile) {
      return res.json({
        success: true,
        data: null,
      });
    }

    const metrics = calculateHomeownershipMetrics(profile);

    return res.json({
      success: true,
      data: {
        ...profile.toObject(),
        ...metrics,
      },
    });
  } catch (error) {
    console.error('Error fetching client profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch client profile',
      error: error.message,
    });
  }
}

export async function upsertClientProfile(req, res) {
  try {
    const userId = req.user._id;
    const profileData = sanitizeClientProfileData(req.body || {});

    const validation = validateClientProfileData(profileData);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.errors,
      });
    }

    let profile = await ClientProfile.findOne({ user_id: userId });

    if (profile) {
      Object.assign(profile, profileData);
      profile = updateClientProfileMetrics(profile);
      await profile.save();
    } else {
      profile = new ClientProfile({
        user_id: userId,
        ...profileData,
      });
      profile = updateClientProfileMetrics(profile);
      await profile.save();
    }

    const metrics = calculateHomeownershipMetrics(profile);

    return res.json({
      success: true,
      message: 'Client profile saved successfully',
      data: {
        ...profile.toObject(),
        ...metrics,
      },
    });
  } catch (error) {
    console.error('Error saving client profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save client profile',
      error: error.message,
    });
  }
}

export async function updateClientSettings(req, res) {
  try {
    const userId = req.user._id;
    const {
      first_name,
      last_name,
      phone,
      annual_income,
      employment_status,
      current_savings,
      monthly_savings,
      dream_home_price,
      home_goal,
      home_goals,
      preferred_location,
      preferred_locations,
      purchase_timeline,
      mortgage_status,
      realtor_status,
      viewing_readiness,
      offer_readiness,
      motivation_reason,
      living_situation,
      purchase_purpose,
      preferred_contact_method,
      best_time_to_contact,
      working_styles,
      priority_tags,
      languages,
      preferred_experience,
      comfort_preferences,
    } = req.body || {};

    const userUpdates = {};
    if (first_name !== undefined) userUpdates.first_name = String(first_name || '').trim();
    if (last_name !== undefined) userUpdates.last_name = String(last_name || '').trim();
    if (phone !== undefined) userUpdates.phone = String(phone || '').trim();

    if (!userUpdates.first_name && first_name !== undefined) {
      return res.status(400).json({ success: false, message: 'First name is required' });
    }
    if (!userUpdates.last_name && last_name !== undefined) {
      return res.status(400).json({ success: false, message: 'Last name is required' });
    }

    const profileData = {
      annual_income,
      employment_status,
      current_savings,
      monthly_savings,
      dream_home_price,
      home_goal,
      home_goals,
      preferred_location,
      preferred_locations,
      purchase_timeline,
      mortgage_status,
      realtor_status,
      viewing_readiness,
      offer_readiness,
      motivation_reason,
      living_situation,
      purchase_purpose,
      preferred_contact_method,
      best_time_to_contact,
      working_styles,
      priority_tags,
      languages,
      preferred_experience,
      comfort_preferences,
    };

    const sanitizedProfileData = sanitizeClientProfileData(profileData);

    Object.keys(sanitizedProfileData).forEach((key) => {
      if (sanitizedProfileData[key] === undefined) delete sanitizedProfileData[key];
    });

    const validation = validateClientProfileData(sanitizedProfileData);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.errors,
      });
    }

    const user = Object.keys(userUpdates).length
      ? await User.findByIdAndUpdate(userId, userUpdates, { new: true }).select('-password -otp -reset_password_token')
      : await User.findById(userId).select('-password -otp -reset_password_token');

    let profile = await ClientProfile.findOne({ user_id: userId });
    if (profile) {
      Object.assign(profile, sanitizedProfileData);
      profile = updateClientProfileMetrics(profile);
      await profile.save();
    } else {
      profile = new ClientProfile({ user_id: userId, ...sanitizedProfileData });
      profile = updateClientProfileMetrics(profile);
      await profile.save();
    }

    const metrics = calculateHomeownershipMetrics(profile);

    return res.json({
      success: true,
      message: 'Client settings saved successfully',
      user,
      data: {
        ...profile.toObject(),
        ...metrics,
      },
    });
  } catch (error) {
    console.error('Error saving client settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save client settings',
      error: error.message,
    });
  }
}

export async function getClientInquiries(req, res) {
  try {
    if (String(req.user?.role || '').toLowerCase() !== USER_ROLE.CLIENT) {
      return res.status(403).json({
        success: false,
        message: 'Only clients can view inquiries',
      });
    }

    const inquiries = await getClientInquiriesForUser(req.user._id, {
      type: String(req.query.type || '').trim(),
      limit: req.query.limit,
      page: req.query.page,
    });

    return res.json({
      success: true,
      ...inquiries,
    });
  } catch (error) {
    console.error('Error fetching client inquiries:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch client inquiries',
      error: error.message,
    });
  }
}

export async function getClientRecommendations(req, res) {
  try {
    const userId = req.user._id;
    const recommendations = await getClientRecommendationsForUser(userId, {
      role: String(req.query.role || '').trim(),
      limit: req.query.limit,
    });

    return res.json({
      success: true,
      ...recommendations,
    });
  } catch (error) {
    console.error('Error fetching client recommendations:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch client recommendations',
      error: error.message,
    });
  }
}

export async function createClientSubscriptionCheckout(req, res) {
  try {
    const userId = req.user._id;
    const { tier } = req.body;

    if (!tier || !['basic', 'standard', 'pro'].includes(tier)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tier. Must be basic, standard, or pro',
      });
    }

    const result = await createClientCheckoutSession(userId, tier);

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error creating client checkout session:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create checkout session',
    });
  }
}

export async function getClientSubscription(req, res) {
  try {
    const userId = req.user._id;
    const subscription = await getClientSubscriptionForUser(userId);

    return res.json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    console.error('Error fetching client subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription',
      error: error.message,
    });
  }
}

export async function cancelClientSubscriptionEndpoint(req, res) {
  try {
    const userId = req.user._id;
    const subscription = await cancelClientSubscription(userId);

    return res.json({
      success: true,
      message: 'Subscription will be canceled at the end of the current period',
      data: subscription,
    });
  } catch (error) {
    console.error('Error canceling client subscription:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel subscription',
    });
  }
}
