import logger from '../../../utils/logger.js';

export const isGoogleAuthUser = (user) => String(user?.auth_provider || '').trim() === 'google';

export const parseGoogleName = (profile = {}) => {
  const given = String(profile.given_name || '').trim();
  const family = String(profile.family_name || '').trim();
  const full = String(profile.name || '').trim();

  if (given || family) {
    return {
      first_name: given || 'User',
      last_name: family || 'Google',
    };
  }
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    const first_name = parts.shift() || 'User';
    const last_name = parts.join(' ') || 'Google';
    return { first_name, last_name };
  }
  return { first_name: 'User', last_name: 'Google' };
};

const GOOGLE_TIMEOUT_MS = 5000;

function googleUnavailableError() {
  const error = new Error('Google sign-in is not responding right now. Please try again.');
  error.status = 503;
  return error;
}

async function googleJson(url, headers) {
  const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error_description || body?.error || 'Google token verification failed');
    error.googleRejected = true;
    throw error;
  }
  return body;
}

export const verifyGoogleToken = async ({ token, token_type }) => {
  const normalizedToken = String(token || '').trim();
  const normalizedType = String(token_type || '').trim().toLowerCase();
  if (!normalizedToken || !normalizedType) {
    throw new Error('Google token and token_type are required');
  }
  if (normalizedType !== 'access_token' && normalizedType !== 'id_token') {
    throw new Error('Unsupported Google token_type');
  }

  const configuredClientIds = String(process.env.GOOGLE_CLIENT_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  // Without a client id the token's app can't be checked, so a token issued to any other app
  // would be accepted. Production refuses Google sign-in until GOOGLE_CLIENT_ID is set.
  if (!configuredClientIds.length && String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    logger.error('GOOGLE_CLIENT_ID is not set; Google sign-in is refused in production.');
    const error = new Error('Google sign-in is not available right now. Please sign in with email and password.');
    error.status = 503;
    throw error;
  }
  const needsAccessTokenInfo = configuredClientIds.length > 0 && normalizedType === 'access_token';

  let payload;
  let info = null;
  try {
    if (normalizedType === 'id_token') {
      payload = await googleJson(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(normalizedToken)}`,
      );
    } else {
      [payload, info] = await Promise.all([
        googleJson('https://www.googleapis.com/oauth2/v3/userinfo', {
          Authorization: `Bearer ${normalizedToken}`,
        }),
        needsAccessTokenInfo
          ? googleJson(
            `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(normalizedToken)}`,
          )
          : Promise.resolve(null),
      ]);
    }
  } catch (error) {
    if (error?.googleRejected) throw error;
    logger.error(`Google token verification error: ${error.message}`);
    throw googleUnavailableError();
  }

  const email = String(payload?.email || '').trim().toLowerCase();
  if (!email) throw new Error('Google token did not contain an email');
  if (
    payload?.email_verified !== true &&
    payload?.email_verified !== 'true' &&
    info?.email_verified !== 'true'
  ) {
    throw new Error('This Google account email is not verified');
  }

  if (configuredClientIds.length) {
    const audiences = normalizedType === 'id_token' ? [payload?.aud, payload?.azp] : [info?.aud, info?.azp];
    const matches = audiences
      .map((value) => String(value || '').trim())
      .some((value) => value && configuredClientIds.includes(value));
    if (!matches) {
      throw new Error('Google token audience mismatch');
    }
  }

  return {
    email,
    google_id: String(payload?.sub || '').trim() || null,
    ...parseGoogleName(payload),
  };
};

export const GOOGLE_SIGNUP_RETRY_MS = 2 * 60 * 1000;

export function isSameFreshGoogleSignup(user, googleProfile) {
  if (!isGoogleAuthUser(user) || user.is_active === false) return false;
  if (!googleProfile?.google_id || String(user.google_id || '') !== String(googleProfile.google_id)) return false;
  const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;
  return createdAt > 0 && Date.now() - createdAt < GOOGLE_SIGNUP_RETRY_MS;
}
