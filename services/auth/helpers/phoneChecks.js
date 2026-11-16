import User from '../../../models/User.js';
import PendingSignup from '../../../models/PendingSignup.js';

export async function phoneBelongsToAnotherUser(phone, exceptUserId = null) {
  if (!phone) return false;
  const query = exceptUserId ? { phone, _id: { $ne: exceptUserId } } : { phone };
  return Boolean(await User.exists(query));
}

export async function phoneHeldByOtherPending(phone, email) {
  if (!phone) return false;
  return Boolean(
    await PendingSignup.exists({
      phone,
      email: { $ne: String(email || '').toLowerCase().trim() },
      expires_at: { $gt: new Date() },
    }),
  );
}
