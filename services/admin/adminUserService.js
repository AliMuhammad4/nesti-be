import mongoose from 'mongoose';
import User from '../../models/User.js';
import { USER_ROLE } from '../../constants/roles.js';
import logger from '../../utils/logger.js';
import { fail, ok, serializeUser, countAdminsExcluding } from './adminCommon.js';
import {
  notifyUserAccountReinstated,
  notifyUserAccountSuspended,
} from './accountStatusNotifications.js';

export async function suspendAdminUserService(actor, userId, { reason = '' } = {}) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return fail(400, 'Invalid user id');
  if (String(actor._id) === String(userId)) return fail(400, 'You cannot suspend your own account');

  const user = await User.findById(userId);
  if (!user) return fail(404, 'User not found');
  if (user.role === USER_ROLE.ADMIN) {
    const remaining = await countAdminsExcluding(user._id);
    if (remaining < 1) return fail(400, 'Cannot suspend the last active admin');
  }

  const reasonText = String(reason || '').trim();
  user.is_active = false;
  user.suspended_at = new Date();
  user.suspended_reason = reasonText;
  await user.save();

  const recipient = {
    email: String(user.email || '').trim().toLowerCase(),
    first_name: user.first_name,
    suspended_reason: reasonText,
  };
  logger.info('Account suspended; sending notice', {
    user_id: String(user._id),
    email: recipient.email,
    has_reason: Boolean(reasonText),
  });

  const notified = await notifyUserAccountSuspended(recipient, { reason: reasonText }).catch((error) => {
    logger.error('Account suspended email threw', {
      email: recipient.email,
      message: error?.message,
    });
    return { success: false };
  });

  return ok({
    user: serializeUser(user.toObject()),
    email_notified: Boolean(notified?.success),
  });
}

export async function unsuspendAdminUserService(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) return fail(400, 'Invalid user id');
  const user = await User.findById(userId);
  if (!user) return fail(404, 'User not found');
  user.is_active = true;
  user.suspended_at = null;
  user.suspended_reason = '';
  await user.save();

  const recipient = {
    email: String(user.email || '').trim().toLowerCase(),
    first_name: user.first_name,
  };
  logger.info('Account reinstated; sending notice', {
    user_id: String(user._id),
    email: recipient.email,
  });

  const notified = await notifyUserAccountReinstated(recipient).catch((error) => {
    logger.error('Account reinstated email threw', {
      email: recipient.email,
      message: error?.message,
    });
    return { success: false };
  });

  return ok({
    user: serializeUser(user.toObject()),
    email_notified: Boolean(notified?.success),
  });
}
