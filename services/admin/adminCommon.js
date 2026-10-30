import User from '../../models/User.js';
import { USER_ROLE } from '../../constants/roles.js';

/** Lean user fields for admin tables (no cover blobs). */
export const USER_LIST =
  'first_name last_name email role phone is_verified is_active suspended_at auth_provider createdAt profile_image';

export const USER_PUBLIC =
  'first_name last_name email role phone is_verified is_active suspended_at suspended_reason auth_provider createdAt updatedAt profile_image cover_image cover_image_position cover_image_zoom';

export function parsePaging(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Apply ISO from/to onto a date field filter. */
export function applyDateRange(filter, query = {}, field = 'createdAt') {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if (from && !Number.isNaN(from.getTime())) {
    filter[field] = { ...(filter[field] || {}), $gte: from };
  }
  if (to && !Number.isNaN(to.getTime())) {
    filter[field] = { ...(filter[field] || {}), $lte: to };
  }
  return filter;
}

/**
 * @param {{ sort?: string, order?: string }} query
 * @param {string[]} allowFields
 * @param {Record<string, 1|-1>} fallback
 */
export function parseSort(query = {}, allowFields = ['createdAt', 'updatedAt'], fallback = { updatedAt: -1 }) {
  const field = String(query.sort || '').trim();
  const orderRaw = String(query.order || 'desc').toLowerCase();
  const dir = orderRaw === 'asc' || orderRaw === '1' ? 1 : -1;
  if (field && allowFields.includes(field)) {
    return { [field]: dir };
  }
  return fallback;
}

export async function findUserIdsBySearch(q) {
  const text = String(q || '').trim();
  if (!text) return null;
  const rx = new RegExp(escapeRegex(text), 'i');
  const users = await User.find({
    $or: [{ email: rx }, { first_name: rx }, { last_name: rx }, { phone: rx }],
  })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
}

export function ok(data, extra = {}) {
  return { status: 200, body: { success: true, ...data, ...extra } };
}

export function fail(status, message, extra = {}) {
  return { status, body: { success: false, message, ...extra } };
}

export function serializeUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    phone: user.phone || '',
    role: user.role,
    is_verified: Boolean(user.is_verified),
    is_active: user.is_active !== false,
    suspended_at: user.suspended_at || null,
    suspended_reason: user.suspended_reason || '',
    auth_provider: user.auth_provider || 'local',
    profile_image: user.profile_image || null,
    cover_image: user.cover_image || null,
    cover_image_position: user.cover_image_position || { x: 50, y: 50 },
    cover_image_zoom: user.cover_image_zoom || 1,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function countAdminsExcluding(userId) {
  return User.countDocuments({
    role: USER_ROLE.ADMIN,
    _id: { $ne: userId },
    is_active: { $ne: false },
  });
}
