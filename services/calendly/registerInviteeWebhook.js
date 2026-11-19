import logger from '../../utils/logger.js';
import { calendlyFetch, calendlyHttpError, readCalendlyText } from './calendlyHttp.js';
const API = 'https://api.calendly.com';
function organizationUriFromUserMe(resource) {
  if (!resource) return null;
  const co = resource.current_organization;
  if (typeof co === 'string' && co.startsWith('http')) return co;
  if (co && typeof co === 'object' && co.uri) return co.uri;
  const org = resource.organization;
  if (typeof org === 'string' && org.startsWith('http')) return org;
  if (org && typeof org === 'object' && org.uri) return org.uri;
  return null;
}

export async function registerCalendlyInviteeWebhook(accessToken, targetUrl) {
  const url = String(targetUrl || '').trim();
  if (!url) {
    return { skipped: true, reason: 'empty_target_url' };
  }

  const meRes = await calendlyFetch(`${API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meText = await readCalendlyText(meRes);
  if (!meRes.ok) {
    throw calendlyHttpError(`Calendly users/me failed (${meRes.status}): ${meText.slice(0, 500)}`, meRes.status);
  }
  const me = JSON.parse(meText);
  const r = me.resource;
  if (!r?.uri) {
    throw new Error('Calendly users/me: missing resource.uri');
  }

  const orgUri = organizationUriFromUserMe(r);
  const forceUserScope =
    String(process.env.CALENDLY_WEBHOOK_REGISTER_SCOPE || '')
      .trim()
      .toLowerCase() === 'user';

  const userScopeBody = {
    url,
    events: ['invitee.created', 'invitee.canceled'],
    user:   r.uri,
    scope:  'user',
    ...(orgUri ? { organization: orgUri } : {}),
  };
  const orgScopeBody = orgUri
    ? {
        url,
        events:       ['invitee.created', 'invitee.canceled'],
        organization: orgUri,
        scope:        'organization',
      }
    : null;

  const body =
    forceUserScope || !orgScopeBody ? userScopeBody : orgScopeBody;

  if (forceUserScope && orgUri) {
    logger.info(
      'Calendly: registering user-scoped webhook (CALENDLY_WEBHOOK_REGISTER_SCOPE=user)',
      { op: 'calendly.webhook.register', target_url: url }
    );
  }

  const subRes = await calendlyFetch(`${API}/webhook_subscriptions`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const subText = await readCalendlyText(subRes);
  let parsed;
  try {
    parsed = JSON.parse(subText);
  } catch {
    parsed = { raw: subText.slice(0, 200) };
  }

  if (subRes.status === 409) {
    const msg = parsed?.message || parsed?.title || subText;
    const dup =
      String(msg).toLowerCase().includes('already exists') ||
      String(parsed?.title || '').toLowerCase().includes('already exists');
    if (dup) {
      logger.info('Calendly: webhook URL already registered (idempotent)', {
        op:         'calendly.webhook.register',
        target_url: url,
        scope:      body.scope,
      });
      return {
        created:       false,
        alreadyExists: true,
        scope:         body.scope,
        calendly:      parsed,
      };
    }
  }

  if (!subRes.ok) {
    throw calendlyHttpError(
      `Calendly webhook_subscriptions failed (${subRes.status}): ${subText.slice(0, 800)}`,
      subRes.status
    );
  }

  logger.info('Calendly: invitee webhook subscription registered', {
    op:          'calendly.webhook.register',
    target_url:  url,
    scope:       body.scope,
  });

  return { created: true, scope: body.scope, calendly: parsed };
}

export async function listCalendlyWebhookSubscriptions(accessToken) {
  const meRes = await calendlyFetch(`${API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meText = await readCalendlyText(meRes);
  if (!meRes.ok) {
    throw calendlyHttpError(`Calendly users/me failed (${meRes.status}): ${meText.slice(0, 400)}`, meRes.status);
  }
  const me = JSON.parse(meText);
  const r = me.resource;
  if (!r?.uri) throw new Error('Calendly users/me: missing resource.uri');

  const orgUri = organizationUriFromUserMe(r);
  const auth = { Authorization: `Bearer ${accessToken}` };

  const userListParams = {
    scope: 'user',
    user:  r.uri,
    count: '100',
    ...(orgUri ? { organization: orgUri } : {}),
  };
  const userQ = new URLSearchParams(userListParams);
  const userRes = await calendlyFetch(`${API}/webhook_subscriptions?${userQ}`, { headers: auth });
  const userText = await readCalendlyText(userRes);
  const userJson = userRes.ok
    ? JSON.parse(userText || '{}')
    : { _error: userRes.status, _body: userText.slice(0, 400) };

  let orgJson = null;
  if (orgUri) {
    const orgQ = new URLSearchParams({
      scope:        'organization',
      organization: orgUri,
      count:        '100',
    });
    const orgRes = await calendlyFetch(`${API}/webhook_subscriptions?${orgQ}`, { headers: auth });
    const orgText = await readCalendlyText(orgRes);
    orgJson = orgRes.ok
      ? JSON.parse(orgText || '{}')
      : { _error: orgRes.status, _body: orgText.slice(0, 400) };
  }

  return {
    oauth_user_uri:    r.uri,
    oauth_user_email:  r.email || null,
    oauth_user_name:   r.name || null,
    organization_uri:  orgUri,
    user_scope_list:   userJson,
    organization_scope_list: orgJson,
  };
}

/** Remove one webhook subscription (used to replace a subscription Calendly has disabled). */
export async function deleteCalendlyWebhookSubscription(accessToken, subscriptionUri) {
  const uri = String(subscriptionUri || '').trim();
  if (!uri.startsWith(`${API}/webhook_subscriptions/`)) return { skipped: true };
  const res = await calendlyFetch(uri, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.ok || res.status === 404) return { deleted: true };
  const text = await readCalendlyText(res);
  throw calendlyHttpError(`Calendly webhook delete failed (${res.status}): ${text.slice(0, 400)}`, res.status);
}
