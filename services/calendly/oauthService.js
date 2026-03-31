
import jwt from 'jsonwebtoken';
const AUTH_BASE = 'https://auth.calendly.com';
const API_BASE = 'https://api.calendly.com';
const jwtSecret = () => process.env.JWT_SECRET || 'secret';
export function getCalendlyRedirectUri() {
  const u = process.env.CALENDLY_REDIRECT_URI?.trim();
  if (!u) {
    throw new Error('Set CALENDLY_REDIRECT_URI to the redirect URL registered in your Calendly OAuth app');
  }
  return u;
}

export function createCalendlyOAuthState(userId) {
  return jwt.sign(
    { purpose: 'calendly_oauth', sub: String(userId) },
    jwtSecret(),
    { expiresIn: '10m' }
  );
}

export function parseCalendlyOAuthState(state) {
  const decoded = jwt.verify(String(state), jwtSecret());
  if (decoded.purpose !== 'calendly_oauth' || !decoded.sub) {
    throw new Error('Invalid OAuth state');
  }
  return decoded.sub;
}

export function buildCalendlyAuthorizeUrl(state) {
  const clientId = process.env.CALENDLY_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error('Set CALENDLY_CLIENT_ID from your Calendly OAuth application');
  }
  const redirectUri = getCalendlyRedirectUri();
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    state:         String(state),
  });
  return `${AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

export async function exchangeCalendlyAuthorizationCode(code) {
  const clientId = process.env.CALENDLY_CLIENT_ID?.trim();
  const clientSecret = process.env.CALENDLY_CLIENT_SECRET?.trim();
  const redirectUri = getCalendlyRedirectUri();
  if (!clientId || !clientSecret) {
    throw new Error('Set CALENDLY_CLIENT_ID and CALENDLY_CLIENT_SECRET');
  }

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code:          String(code).trim(),
    redirect_uri:  redirectUri,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Calendly token exchange failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

export async function fetchCalendlyAccountLabel(accessToken) {
  const res = await fetch(`${API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const r = data.resource;
  if (!r) return null;
  return r.email || r.name || r.uri || null;
}

export async function fetchCalendlyUserResource(accessToken) {
  const res = await fetch(`${API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const r = data.resource;
  if (!r) return null;
  const slug =
    r.slug != null && String(r.slug).trim()
      ? String(r.slug).toLowerCase().trim()
      : null;
  return {
    email:           r.email || null,
    name:            r.name || null,
    slug,
    scheduling_url:  r.scheduling_url || null,
    uri:             r.uri || null,
  };
}
