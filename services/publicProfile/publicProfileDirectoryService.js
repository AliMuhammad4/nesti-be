import { ProfessionalProfile, PublicProfile } from '../../models/index.js';
import { filterPublicProfileAccessByUserId } from './publicProfileAccess.js';

function professionalName(profile, user, fallback = 'Professional') {
  return profile.full_name
    || [user?.first_name, user?.last_name].filter(Boolean).join(' ')
    || fallback;
}

async function loadPublicProfilesByUserId(userIds, fields) {
  const profiles = await PublicProfile.find({ user_id: { $in: userIds } })
    .select(fields)
    .lean();
  return new Map(profiles.map((profile) => [profile.user_id.toString(), profile]));
}

export async function checkSlugAvailabilityService(slug, userId = null) {
  if (!slug || typeof slug !== 'string') {
    return {
      status: 400,
      body: { success: false, message: 'Invalid slug provided' },
    };
  }

  const normalizedSlug = slug.toLowerCase().trim();
  if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
    return {
      status: 400,
      body: {
        success: false,
        available: false,
        message: 'Slug can only contain lowercase letters, numbers, and hyphens',
      },
    };
  }
  if (normalizedSlug.length < 3 || normalizedSlug.length > 50) {
    return {
      status: 400,
      body: {
        success: false,
        available: false,
        message: 'Slug must be between 3 and 50 characters',
      },
    };
  }

  const existingProfile = await PublicProfile.findOne({ slug: normalizedSlug }).lean();
  if (!existingProfile) {
    return {
      status: 200,
      body: { success: true, available: true, slug: normalizedSlug },
    };
  }
  if (userId && existingProfile.user_id.toString() === userId.toString()) {
    return {
      status: 200,
      body: { success: true, available: true, slug: normalizedSlug, own: true },
    };
  }
  return {
    status: 200,
    body: {
      success: true,
      available: false,
      message: 'This slug is already taken',
      suggested: `${normalizedSlug}-${Math.floor(Math.random() * 1000)}`,
    },
  };
}

export async function getPublicProfessionalsListService({ role, limit = 12, exclude } = {}) {
  const profFilter = {};
  if (role) profFilter.professional_type = role;

  const profProfiles = await ProfessionalProfile.find(profFilter)
    .populate('user_id', 'first_name last_name profile_image')
    .select('user_id professional_type full_name company_name location experience')
    .sort({ createdAt: -1 })
    .limit(limit * 3)
    .lean();
  const userIds = profProfiles.map((profile) => profile.user_id?._id).filter(Boolean);
  const [publicProfilesByUserId, accessByUserId] = await Promise.all([
    loadPublicProfilesByUserId(userIds, 'user_id slug headline profile_photo_url cover_photo_url enabled'),
    filterPublicProfileAccessByUserId(userIds),
  ]);

  const list = profProfiles
    .map((profile) => {
      const user = profile.user_id || {};
      const userId = user._id?.toString();
      const publicProfile = userId ? publicProfilesByUserId.get(userId) : null;
      const hasPublicProfile = Boolean(
        publicProfile?.enabled && userId && accessByUserId.get(userId),
      );
      if (exclude && publicProfile?.slug === exclude) return null;

      return {
        slug: hasPublicProfile ? publicProfile.slug : null,
        professional_type: profile.professional_type,
        professional_name: professionalName(profile, user),
        headline: publicProfile?.headline || '',
        profile_photo_url: publicProfile?.profile_photo_url || user.profile_image || null,
        location: profile.location || '',
        experience: profile.experience || '',
        company_name: profile.company_name || '',
        has_public_profile: hasPublicProfile,
      };
    })
    .filter(Boolean)
    .slice(0, limit);

  return { status: 200, body: { success: true, professionals: list } };
}

export async function getPublicProfessionalNetworkService({ role, limit = 60, exclude } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 100);
  const profFilter = {};
  if (role) profFilter.professional_type = role;

  const professionalProfiles = await ProfessionalProfile.find(profFilter)
    .populate('user_id', 'first_name last_name profile_image cover_image')
    .select('user_id professional_type full_name company_name location experience')
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
  const completeProfiles = professionalProfiles.filter((profile) => {
    const user = profile.user_id;
    return Boolean(
      user?._id
      && profile.professional_type
      && (profile.full_name || user.first_name || user.last_name),
    );
  });
  const userIds = completeProfiles.map((profile) => profile.user_id._id);
  const [publicProfilesByUserId, accessByUserId] = await Promise.all([
    loadPublicProfilesByUserId(userIds, 'user_id slug profile_photo_url cover_photo_url enabled'),
    filterPublicProfileAccessByUserId(userIds),
  ]);

  const professionals = completeProfiles
    .map((profile) => {
      const user = profile.user_id;
      const userId = user._id.toString();
      const publicProfile = publicProfilesByUserId.get(userId);
      const hasPublicProfile = Boolean(publicProfile?.enabled && accessByUserId.get(userId));
      if (exclude && publicProfile?.slug === exclude) return null;

      return {
        ...(hasPublicProfile && publicProfile.slug ? { slug: publicProfile.slug } : {}),
        professional_type: profile.professional_type,
        professional_name: professionalName(profile, user),
        profile_photo_url: publicProfile?.profile_photo_url || user.profile_image || null,
        cover_photo_url: publicProfile?.cover_photo_url || user.cover_image || null,
        company_name: profile.company_name || '',
        location: profile.location || '',
        experience: profile.experience || '',
        has_public_profile: hasPublicProfile,
      };
    })
    .filter(Boolean);

  return { status: 200, body: { success: true, professionals } };
}
