import {
  getFeaturedProfessionalsForHomepage,
  getFeaturedProfessionalsByRole,
} from '../services/featured/featuredPlacementService.js';
import { USER_ROLE } from '../constants/roles.js';

function serializeFeaturedProfessional(placement) {
  const user = placement.user || {};
  const professionalProfile = placement.professionalProfile || {};
  const publicProfile = placement.publicProfile || null;
  const name =
    String(professionalProfile.full_name || '').trim() ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    'Professional';

  return {
    id: user._id,
    name,
    role: user.role,
    profile_image:
      String(publicProfile?.profile_photo_url || user.profile_image || '').trim() || null,
    plan_key: placement.subscription.plan_key,
    placement_priority: placement.subscription.placement_priority,
    profile: {
      bio: professionalProfile.bio || '',
      specializations: professionalProfile.specializations || [],
      location: professionalProfile.location || {},
      languages_spoken: professionalProfile.languages_spoken || [],
      experience_level: professionalProfile.experience_level || '',
      working_style: professionalProfile.working_style || '',
    },
    publicProfile: publicProfile?.slug
      ? {
          slug: publicProfile.slug,
          bio: publicProfile.bio,
          stats: publicProfile.stats || {},
          testimonials: publicProfile.testimonials || [],
        }
      : null,
  };
}

export async function getFeaturedProfessionals(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const professionals = await getFeaturedProfessionalsForHomepage(limit);

    return res.json({
      success: true,
      data: professionals.map(serializeFeaturedProfessional),
    });
  } catch (error) {
    console.error('Error in getFeaturedProfessionals:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch featured professionals',
      error: error.message,
    });
  }
}

export async function getFeaturedProfessionalsByRoleEndpoint(req, res) {
  try {
    const { role } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const validRoles = Object.values(USER_ROLE);
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      });
    }

    const professionals = await getFeaturedProfessionalsByRole(role, limit);

    return res.json({
      success: true,
      data: professionals.map(serializeFeaturedProfessional),
    });
  } catch (error) {
    console.error(`Error in getFeaturedProfessionalsByRole for ${req.params.role}:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch featured professionals',
      error: error.message,
    });
  }
}
