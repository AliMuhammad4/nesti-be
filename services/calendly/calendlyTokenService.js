import CalendarIntegration from '../../models/CalendarIntegration.js';
import logger from '../../utils/logger.js';
import { refreshCalendlyAccessToken } from './oauthService.js';

export const CALENDLY_REFRESH_SKEW_MS = 5 * 60 * 1000;

export const CALENDLY_ACCESS_KIND = {
  reconnect:   'reconnect',
  unavailable: 'unavailable',
};

export class CalendlyAccessError extends Error {
  constructor(message, kind, cause = null) {
    super(message);
    this.name = 'CalendlyAccessError';
    this.kind = kind;
    if (cause) this.cause = cause;
  }
}

const RECONNECT_MESSAGE = 'Calendly connection expired. Reconnect Calendly in Settings.';
const NO_REFRESH_MESSAGE = 'Calendly access expired and no refresh token is stored. Connect Calendly again in Settings.';
const UNAVAILABLE_MESSAGE = 'Calendly is not responding right now. Please try again in a moment.';

function tokenIsFresh(integ, now = Date.now()) {
  const expiresAt = integ?.expires_at ? new Date(integ.expires_at).getTime() : 0;
  return Boolean(integ?.access_token) && expiresAt > now + CALENDLY_REFRESH_SKEW_MS;
}

const inflightRefreshes = new Map();

async function refreshOnce(integ) {
  const usedRefreshToken = integ.refresh_token;
  try {
    const tokens = await refreshCalendlyAccessToken(usedRefreshToken);
    const updated = await CalendarIntegration.findOneAndUpdate(
      { _id: integ._id },
      {
        $set: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || usedRefreshToken,
          expires_at: new Date(Date.now() + (Number(tokens.expires_in) || 7200) * 1000),
        },
      },
      { returnDocument: 'after' },
    );
    logger.info('Calendar API: Calendly access token refreshed', { op: 'calendar.calendly.refresh', user_id: String(integ.user_id) });
    if (!updated) throw new CalendlyAccessError('Connect Calendly (OAuth) first.', CALENDLY_ACCESS_KIND.reconnect);
    return updated;
  } catch (err) {
    if (err instanceof CalendlyAccessError) throw err;
    const latest = await CalendarIntegration.findById(integ._id);
    if (!latest?.access_token) {
      throw new CalendlyAccessError('Connect Calendly (OAuth) first.', CALENDLY_ACCESS_KIND.reconnect, err);
    }
    if (latest.refresh_token !== usedRefreshToken && tokenIsFresh(latest)) return latest;
    const status = Number(err?.status) || 0;
    logger.warn(`Calendly token refresh: ${err?.message}`);
    if (status === 400 || status === 401) {
      throw new CalendlyAccessError(RECONNECT_MESSAGE, CALENDLY_ACCESS_KIND.reconnect, err);
    }
    throw new CalendlyAccessError(UNAVAILABLE_MESSAGE, CALENDLY_ACCESS_KIND.unavailable, err);
  }
}

export async function ensureFreshCalendlyAccess(integ) {
  if (!integ?.access_token) {
    throw new CalendlyAccessError('Connect Calendly (OAuth) first.', CALENDLY_ACCESS_KIND.reconnect);
  }
  if (tokenIsFresh(integ)) return integ;
  if (!integ.refresh_token) {
    throw new CalendlyAccessError(NO_REFRESH_MESSAGE, CALENDLY_ACCESS_KIND.reconnect);
  }
  const key = String(integ._id);
  const pending = inflightRefreshes.get(key);
  if (pending) return pending;
  const p = refreshOnce(integ).finally(() => inflightRefreshes.delete(key));
  inflightRefreshes.set(key, p);
  return p;
}
