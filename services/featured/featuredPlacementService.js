import Subscription from '../../models/Subscription.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import PublicProfile from '../../models/PublicProfile.js';
import User from '../../models/User.js';
import { getPlacementPriority } from '../billing/plans.js';

export async function getFeaturedProfessionalsForHomepage(limit = 6) {
  try {
    const activeSubscriptions = await Subscription.find({
      status: { $in: ['active', 'trialing'] },
      plan_key: { $in: ['basic', 'standard', 'enterprise'] },
    })
      .populate('user_id')
      .lean();

    const enrichedProfessionals = [];

    for (const subscription of activeSubscriptions) {
      if (!subscription.user_id) continue;

      const userId = subscription.user_id._id || subscription.user_id;

      const [professionalProfile, publicProfile] = await Promise.all([
        ProfessionalProfile.findOne({ user_id: userId }).lean(),
        PublicProfile.findOne({ user_id: userId }).lean(),
      ]);

      if (!professionalProfile) continue;

      enrichedProfessionals.push({
        user: subscription.user_id,
        subscription: {
          plan_key: subscription.plan_key,
          status: subscription.status,
          placement_priority: getPlacementPriority(subscription.plan_key),
        },
        professionalProfile,
        publicProfile,
      });
    }

    const sortedProfessionals = enrichedProfessionals.sort((a, b) => {
      if (b.subscription.placement_priority !== a.subscription.placement_priority) {
        return b.subscription.placement_priority - a.subscription.placement_priority;
      }
      const dateA = new Date(a.professionalProfile.createdAt || 0);
      const dateB = new Date(b.professionalProfile.createdAt || 0);
      return dateA - dateB;
    });

    return sortedProfessionals.slice(0, limit);
  } catch (error) {
    console.error('Error fetching featured professionals:', error);
    throw error;
  }
}

export async function getFeaturedProfessionalsByRole(role, limit = 10) {
  try {
    const users = await User.find({ role }).select('_id').lean();
    const userIds = users.map((u) => u._id);

    const activeSubscriptions = await Subscription.find({
      user_id: { $in: userIds },
      status: { $in: ['active', 'trialing'] },
      plan_key: { $in: ['basic', 'standard', 'enterprise'] },
    })
      .populate('user_id')
      .lean();

    const enrichedProfessionals = [];

    for (const subscription of activeSubscriptions) {
      if (!subscription.user_id) continue;

      const userId = subscription.user_id._id || subscription.user_id;

      const [professionalProfile, publicProfile] = await Promise.all([
        ProfessionalProfile.findOne({ user_id: userId }).lean(),
        PublicProfile.findOne({ user_id: userId }).lean(),
      ]);

      if (!professionalProfile) continue;

      enrichedProfessionals.push({
        user: subscription.user_id,
        subscription: {
          plan_key: subscription.plan_key,
          status: subscription.status,
          placement_priority: getPlacementPriority(subscription.plan_key),
        },
        professionalProfile,
        publicProfile,
      });
    }

    const sortedProfessionals = enrichedProfessionals.sort((a, b) => {
      if (b.subscription.placement_priority !== a.subscription.placement_priority) {
        return b.subscription.placement_priority - a.subscription.placement_priority;
      }
      const dateA = new Date(a.professionalProfile.createdAt || 0);
      const dateB = new Date(b.professionalProfile.createdAt || 0);
      return dateA - dateB;
    });

    return sortedProfessionals.slice(0, limit);
  } catch (error) {
    console.error(`Error fetching featured professionals for role ${role}:`, error);
    throw error;
  }
}

export function getPlacementTierLabel(planKey) {
  const priorities = {
    enterprise: 'Premium Featured',
    standard: 'Featured',
    basic: 'Standard',
  };
  return priorities[planKey] || 'Standard';
}
