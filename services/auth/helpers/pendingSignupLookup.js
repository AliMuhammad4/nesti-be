import PendingSignup from '../../../models/PendingSignup.js';
import { SIGNUP_TOKEN_PURPOSE, tryVerifyJwt, stripBearer } from './authTokens.js';

export async function loadPendingSignupFromToken(verificationToken) {
  const verified = tryVerifyJwt(stripBearer(verificationToken));
  if (!verified.ok || verified.payload?.purpose !== SIGNUP_TOKEN_PURPOSE) return null;
  const email = String(verified.payload.email || '').toLowerCase().trim();
  const nonce = String(verified.payload.nonce || '');
  if (!email || !nonce) return null;
  const pending = await PendingSignup.findOne({ email, session_nonce: nonce });
  if (!pending || new Date(pending.expires_at) <= new Date()) return null;
  return pending;
}
