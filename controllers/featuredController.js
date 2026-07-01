import {
  getFeaturedProfessionalsForHomepage,
  getFeaturedProfessionalsByRole,
} from '../services/featured/featuredPlacementService.js';
import { USER_ROLE } from '../constants/roles.js';

export async function getFeaturedProfessionals(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const professionals = await getFeaturedProfessionalsForHomepage(limit);

    return res.json({
      success: true,
      data: professionals.map((p) => ({
        id: p.user._id,
        name: p.user.name,
        email: p.user.email,
        role: p.user.role,
        plan_key: p.subscription.plan_key,
        placement_priority: p.subscription.placement_priority,
        profile: {
          bio: p.professionalProfile.bio || '',
          specializations: p.professionalProfile.specializations || [],
          location: p.professionalProfile.location || {},
          languages_spoken: p.professionalProfile.languages_spoken || [],
          experience_level: p.professionalProfile.experience_level || '',
          working_style: p.professionalProfile.working_style || '',
        },
        publicProfile: p.publicProfile
          ? {
              slug: p.publicProfile.slug,
              bio: p.publicProfile.bio,
              stats: p.publicProfile.stats || {},
              testimonials: p.publicProfile.testimonials || [],
            }
          : null,
      })),
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
      data: professionals.map((p) => ({
        id: p.user._id,
        name: p.user.name,
        email: p.user.email,
        role: p.user.role,
        plan_key: p.subscription.plan_key,
        placement_priority: p.subscription.placement_priority,
        profile: {
          bio: p.professionalProfile.bio || '',
          specializations: p.professionalProfile.specializations || [],
          location: p.professionalProfile.location || {},
          languages_spoken: p.professionalProfile.languages_spoken || [],
          experience_level: p.professionalProfile.experience_level || '',
          working_style: p.professionalProfile.working_style || '',
        },
        publicProfile: p.publicProfile
          ? {
              slug: p.publicProfile.slug,
              bio: p.publicProfile.bio,
              stats: p.publicProfile.stats || {},
              testimonials: p.publicProfile.testimonials || [],
            }
          : null,
      })),
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
