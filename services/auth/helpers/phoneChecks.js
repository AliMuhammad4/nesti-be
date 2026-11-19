import User from '../../../models/User.js';
import PendingSignup from '../../../models/PendingSignup.js';
import { SIGNUP_HOLD_MS } from './authTokens.js';

/** Waiting signups that still hold their email and number: code live, inside the hold window. */
export function heldSignupFilter(now = new Date()) {
  const since = new Date(now.getTime() - SIGNUP_HOLD_MS);
  return {
    otp_expires_at: { $gt: now },
    $or: [{ started_at: { $gt: since } }, { started_at: null, createdAt: { $gt: since } }],
  };
}

export function signupIsHeld(pending, now = new Date()) {
  if (!pending || new Date(pending.otp_expires_at) <= now) return false;
  const started = new Date(pending.started_at || pending.createdAt || 0).getTime();
  return now.getTime() - started < SIGNUP_HOLD_MS;
}

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
      ...heldSignupFilter(),
    }),
  );
}
