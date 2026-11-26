/**
 * Where account owners get help. The From inbox is not monitored, so user emails point here
 * and set Reply-To to SUPPORT_EMAIL. Default matches the support address on the public site.
 */
export function supportEmail() {
  return String(process.env.SUPPORT_EMAIL || 'support@nesti.ca').trim();
}

export function supportContactUrl() {
  const base = String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/contact?intent=support#contact-form`;
}
