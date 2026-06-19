const EXACT_DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonaddy.com',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailinator.org',
  'mailnesia.com',
  'moakt.com',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'tempmail.net',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

const BLOCKED_DOMAIN_KEYWORDS = [
  'mailinator',
  'tempmail',
  'temp-mail',
  '10minutemail',
  'guerrillamail',
  'throwaway',
  'trashmail',
  'disposable',
  'fakeinbox',
];

function normalizeEmailDomain(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at < 0) return '';
  return raw.slice(at + 1).replace(/\.+$/, '');
}

export function isDisposableEmail(email) {
  const domain = normalizeEmailDomain(email);
  if (!domain) return false;
  if (EXACT_DISPOSABLE_DOMAINS.has(domain)) return true;
  if ([...EXACT_DISPOSABLE_DOMAINS].some((blocked) => domain.endsWith(`.${blocked}`))) return true;
  return BLOCKED_DOMAIN_KEYWORDS.some((keyword) => domain.includes(keyword));
}

export function disposableEmailErrorResponse() {
  return {
    status: 400,
    body: {
      success: false,
      code: 'DISPOSABLE_EMAIL_BLOCKED',
      message: 'Temporary or disposable email addresses are not allowed. Please use a permanent business or personal email address.',
    },
  };
}
