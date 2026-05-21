import { PublicProfile } from '../models/index.js';

export const generateSlugFromName = async (name, userId = null) => {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);

  if (slug.length < 3) {
    slug = `professional-${Math.floor(Math.random() * 10000)}`;
  }

  let finalSlug = slug;
  let counter = 1;

  while (true) {
    const existing = await PublicProfile.findOne({ slug: finalSlug }).lean();
    
    if (!existing) {
      return finalSlug;
    }

    if (userId && existing.user_id.toString() === userId.toString()) {
      return finalSlug;
    }

    finalSlug = `${slug}-${counter}`;
    counter++;

    if (counter > 100) {
      finalSlug = `${slug}-${Math.floor(Math.random() * 10000)}`;
      break;
    }
  }

  return finalSlug;
};

export const validateSlug = (slug) => {
  if (!slug || typeof slug !== 'string') {
    return { valid: false, message: 'Slug is required' };
  }

  if (slug.length < 3 || slug.length > 50) {
    return { valid: false, message: 'Slug must be between 3 and 50 characters' };
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      valid: false,
      message: 'Slug can only contain lowercase letters, numbers, and hyphens',
    };
  }

  if (slug.startsWith('-') || slug.endsWith('-')) {
    return { valid: false, message: 'Slug cannot start or end with a hyphen' };
  }

  if (slug.includes('--')) {
    return { valid: false, message: 'Slug cannot contain consecutive hyphens' };
  }

  const reservedSlugs = [
    'admin',
    'api',
    'dashboard',
    'login',
    'signup',
    'profile',
    'settings',
    'about',
    'contact',
    'help',
    'support',
    'terms',
    'privacy',
  ];

  if (reservedSlugs.includes(slug)) {
    return { valid: false, message: 'This slug is reserved' };
  }

  return { valid: true };
};
