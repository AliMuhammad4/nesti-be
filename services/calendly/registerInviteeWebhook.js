import logger from '../../utils/logger.js';
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

  const meRes = await fetch(`${API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meText = await meRes.text();
  if (!meRes.ok) {
    throw new Error(`Calendly users/me failed (${meRes.status}): ${meText.slice(0, 500)}`);
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

  const subRes = await fetch(`${API}/webhook_subscriptions`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const subText = await subRes.text();
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
    throw new Error(
      `Calendly webhook_subscriptions failed (${subRes.status}): ${subText.slice(0, 800)}`
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
  const meRes = await fetch(`${API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meText = await meRes.text();
  if (!meRes.ok) {
    throw new Error(`Calendly users/me failed (${meRes.status}): ${meText.slice(0, 400)}`);
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
  const userRes = await fetch(`${API}/webhook_subscriptions?${userQ}`, { headers: auth });
  const userJson = userRes.ok
    ? await userRes.json()
    : { _error: userRes.status, _body: (await userRes.text()).slice(0, 400) };

  let orgJson = null;
  if (orgUri) {
    const orgQ = new URLSearchParams({
      scope:        'organization',
      organization: orgUri,
      count:        '100',
    });
    const orgRes = await fetch(`${API}/webhook_subscriptions?${orgQ}`, { headers: auth });
    orgJson = orgRes.ok
      ? await orgRes.json()
      : { _error: orgRes.status, _body: (await orgRes.text()).slice(0, 400) };
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
