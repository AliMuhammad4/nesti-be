/**
 * Nurture email HTML: plain-text body → safe paragraphs + Calendly-style buttons;
 * optional property-match cards (table layout for email clients).
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hrefAttr(url) {
  return String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

const URL_CHUNK = /(https?:\/\/[^\s<]+)/gi;

function trimUrlTrailingPunct(url) {
  return String(url).replace(/[),.;:!?]+$/, '');
}

function isCalendlyUrl(url) {
  return /calendly\.com/i.test(String(url));
}

function linkifyPlainChunk(text) {
  return String(text).split(URL_CHUNK).map((chunk) => {
    if (!chunk) return '';
    if (/^https?:\/\//i.test(chunk)) {
      const normalized = trimUrlTrailingPunct(chunk);
      const href = hrefAttr(normalized);
      if (isCalendlyUrl(normalized)) {
        return `<a href="${href}" style="display:inline-block;background:#006BFF;color:#ffffff !important;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin:8px 0 4px 0;">Schedule a call</a>`;
      }
      const label = escapeHtml(normalized);
      return `<a href="${href}" style="color:#047857;text-decoration:underline;">${label}</a>`;
    }
    return escapeHtml(chunk);
  }).join('');
}

function formatMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style:    'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(x);
  } catch {
    return `$${Math.round(x).toLocaleString('en-US')}`;
  }
}

function listingHeadline(L) {
  const t = String(L.title || L.property_type || 'Property').trim();
  return escapeHtml(t || 'Property');
}

function listingSubline(L) {
  const loc = [L.address, L.location].map((s) => String(s || '').trim()).filter(Boolean);
  return loc.length ? escapeHtml(loc[0]) : '';
}

function listingMetaLine(L) {
  const parts = [];
  if (L.bedrooms != null && L.bedrooms !== '') parts.push(`${L.bedrooms} bed`);
  if (L.bathrooms != null && L.bathrooms !== '') parts.push(`${L.bathrooms} bath`);
  const price = formatMoney(L.price);
  if (price) parts.push(price);
  const type = String(L.property_type || '').trim();
  if (type) parts.push(escapeHtml(type));
  return parts.join(' · ');
}

/**
 * Table-based cards (Outlook-friendly).
 * @param {Array<Record<string, unknown>>} listings compact nurture listing objects
 */
export function buildNurtureListingCardsHtml(listings) {
  if (!Array.isArray(listings) || !listings.length) return '';

  const rows = listings
    .map((L, idx) => {
      const headline = listingHeadline(L);
      const sub = listingSubline(L);
      const meta = listingMetaLine(L);
      const why = L.match_headline ? escapeHtml(String(L.match_headline)) : '';
      const sum = L.summary ? escapeHtml(String(L.summary).slice(0, 220)) : '';
      const url = String(L.listing_url || '').trim();
      const btn = url
        ? `<a href="${hrefAttr(url)}" style="display:inline-block;background:#047857;color:#ffffff !important;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin-top:10px;">View listing</a>`
        : '';

      return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
  <tr>
    <td style="padding:16px 18px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Match ${idx + 1}</div>
      <div style="font-size:17px;font-weight:700;color:#0f172a;line-height:1.3;">${headline}</div>
      ${sub ? `<div style="font-size:14px;color:#475569;margin-top:4px;">${sub}</div>` : ''}
      ${meta ? `<div style="font-size:14px;color:#0f172a;margin-top:10px;font-weight:500;">${meta}</div>` : ''}
      ${why ? `<div style="font-size:13px;color:#047857;margin-top:8px;line-height:1.4;"><strong>Why it fits:</strong> ${why}</div>` : ''}
      ${sum ? `<div style="font-size:13px;color:#64748b;margin-top:8px;line-height:1.45;">${sum}${String(L.summary || '').length > 220 ? '…' : ''}</div>` : ''}
      ${btn}
    </td>
  </tr>
</table>`;
    })
    .join('\n');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px 0;">
  <tr>
    <td style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
      <h2 style="margin:0 0 14px 0;font-size:18px;font-weight:700;color:#0f172a;">Homes matched to your search</h2>
      <p style="margin:0 0 16px 0;font-size:14px;color:#64748b;line-height:1.5;">Details below are pulled from your saved criteria and our inventory—use the links to view full information.</p>
    </td>
  </tr>
</table>
${rows}`;
}

/**
 * Inner HTML only (paragraphs).
 */
export function plainBodyToHtmlFragment(plainBody) {
  const raw = String(plainBody || '').trim();
  if (!raw) return '';

  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const withBreaks = linkifyPlainChunk(block).replace(/\n/g, '<br/>');
      return `<p style="margin:0 0 14px 0;">${withBreaks}</p>`;
    })
    .join('\n');
}

function wrapEmailShell(innerHtml) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title></title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr>
          <td style="padding:24px 22px 28px 22px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827;">
            ${innerHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * @param {{ bodyPlain: string, listings?: Array<Record<string, unknown>> | null, includePropertyCards?: boolean }} opts
 */
export function composeNurtureEmailHtml(opts) {
  const bodyPlain = opts.bodyPlain ?? '';
  const listings = Array.isArray(opts.listings) ? opts.listings : [];
  const includePropertyCards = opts.includePropertyCards !== false;

  const bodyFrag = plainBodyToHtmlFragment(bodyPlain);
  const cardsFrag =
    includePropertyCards && listings.length ? buildNurtureListingCardsHtml(listings) : '';

  /** Body first (greeting + narrative), then structured listing cards so specs aren’t buried in one paragraph. */
  const inner = [
    bodyFrag,
    cardsFrag
      ? `<div style="margin:28px 0 8px 0;padding-top:20px;border-top:1px solid #e2e8f0;">${cardsFrag}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return wrapEmailShell(inner || '<p style="margin:0;">(No message body)</p>');
}

/**
 * Plain body only → full document (no listing cards).
 */
export function buildNurtureEmailHtmlFromBody(plainBody) {
  const frag = plainBodyToHtmlFragment(plainBody);
  return wrapEmailShell(frag || '<p style="margin:0;"></p>');
}
