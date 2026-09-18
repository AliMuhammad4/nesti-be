import mongoose from 'mongoose';
import User from '../../models/User.js';
import { USER_ROLE } from '../../constants/roles.js';
import { fail, ok, serializeUser, countAdminsExcluding } from './adminCommon.js';

export async function suspendAdminUserService(actor, userId, { reason = '' } = {}) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return fail(400, 'Invalid user id');
  if (String(actor._id) === String(userId)) return fail(400, 'You cannot suspend your own account');

  const user = await User.findById(userId);
  if (!user) return fail(404, 'User not found');
  if (user.role === USER_ROLE.ADMIN) {
    const remaining = await countAdminsExcluding(user._id);
    if (remaining < 1) return fail(400, 'Cannot suspend the last active admin');
  }

  user.is_active = false;
  user.suspended_at = new Date();
  user.suspended_reason = String(reason || '').trim();
  await user.save();
  return ok({ user: serializeUser(user.toObject()) });
}

export async function unsuspendAdminUserService(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return fail(400, 'Invalid user id');
  const user = await User.findById(userId);
  if (!user) return fail(404, 'User not found');
  user.is_active = true;
  user.suspended_at = null;
  user.suspended_reason = '';
  await user.save();
  return ok({ user: serializeUser(user.toObject()) });
}
