/**
 * Nurture email HTML: same outer shell and matched-properties table as post-booking
 * consultation emails (see wrapComprehensiveEmail / matchesToHtml in postBookingEmail.js).
 */
import { matchesToHtml } from '../calendly/postBooking/postBookingEmail.js';

const NURTURE_LISTINGS_SECTION_TITLE = 'Recommended listings';

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

/**
 * Outer layout aligned with consultation / post-booking emails (gradient header + Nesti footer).
 * @param {{ schedulingUrl?: string | null }} [options]
 */
export function wrapNurtureEmailShell(agentName, innerHtml, options = {}) {
  const name = String(agentName || 'Your agent').trim() || 'Your agent';
  const schedulingUrl =
    options.schedulingUrl != null && String(options.schedulingUrl).trim()
      ? String(options.schedulingUrl).trim()
      : '';
  const scheduleBlock = schedulingUrl
    ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:#334155;">To book an appointment with <strong>${escapeHtml(name)}</strong>, please select a time using the scheduling link below.</p>
<p style="margin:12px 0 0;"><a href="${hrefAttr(schedulingUrl)}" style="display:inline-block;background:#006BFF;color:#ffffff !important;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Schedule a meeting</a></p>`
    : `<p style="margin:16px 0 0;font-size:13px;line-height:1.55;color:#64748b;">For next steps, reply to this email or contact <strong>${escapeHtml(name)}</strong> using the contact details shared in the message above.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:28px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:22px 28px;">
        <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Follow-up message</div>
        <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:19px;font-weight:600;color:#f8fafc;margin-top:8px;line-height:1.25;">${escapeHtml(name)}</div>
      </td></tr>
      <tr><td style="padding:28px 28px 32px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
        ${innerHtml}
        <p style="margin:28px 0 0;font-size:12px;line-height:1.55;color:#64748b;border-top:1px solid #e2e8f0;padding-top:22px;">
          This message was prepared by <strong>Nesti</strong> on behalf of your real estate professional.
        </p>
        ${scheduleBlock}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function mapNurtureListingForMatchesTable(L) {
  if (!L || typeof L !== 'object') return null;
  const reasons = Array.isArray(L.match_reasons) ? L.match_reasons.filter(Boolean).map(String) : [];
  const fromHeadline = L.match_headline ? [String(L.match_headline).trim()] : [];
  const match_reasons = reasons.length ? reasons : fromHeadline;
  return {
    title: L.title || L.property_type || 'Property',
    address: L.address || null,
    location: L.location || null,
    price: L.price,
    bedrooms: L.bedrooms,
    bathrooms: L.bathrooms,
    match_score: L.match_score,
    match_reasons,
  };
}

function consultationStyleMatchesSectionHtml(listings, agentName, propertyMatchesContext, propertyMatchesNote) {
  const name = String(agentName || 'Your agent').trim() || 'Your agent';
  const rows = listings.map(mapNurtureListingForMatchesTable).filter(Boolean);
  if (!rows.length) return '';
  const note = propertyMatchesNote != null && String(propertyMatchesNote).trim()
    ? String(propertyMatchesNote).trim()
    : '';
  const intro =
    propertyMatchesContext === 'sell'
      ? `The comparable listings below are provided to support your market discussion with <strong>${escapeHtml(name)}</strong>.`
      : `The listings below are matched to your stated preferences and are provided for your review with <strong>${escapeHtml(name)}</strong>.`;
  const divider =
    '<div style="height:1px;background:#e2e8f0;margin:26px 0;" role="separator"></div>';
  return `${divider}
<h2 style="font-size:15px;margin:0 0 14px;color:#0f172a;font-weight:600;letter-spacing:0.01em;">${escapeHtml(NURTURE_LISTINGS_SECTION_TITLE)}</h2>
<div style="font-size:14px;line-height:1.55;color:#334155;">
  <p style="margin:0 0 14px;">${intro}</p>
  ${matchesToHtml(rows, '', { includeContextHeading: false })}
  ${note ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#64748b;">${escapeHtml(note)}</p>` : ''}
</div>`;
}

/**
 * @param {{
 *   bodyPlain: string,
 *   listings?: Array<Record<string, unknown>> | null,
 *   includePropertyCards?: boolean,
 *   agentName?: string | null,
 *   propertyMatchesContext?: string | null,
 *   propertyMatchesNote?: string | null,
 *   schedulingUrl?: string | null,
 * }} opts
 */
export function composeNurtureEmailHtml(opts) {
  const bodyPlain = opts.bodyPlain ?? '';
  const listings = Array.isArray(opts.listings) ? opts.listings : [];
  const includePropertyCards = opts.includePropertyCards !== false;
  const agentName =
    opts.agentName != null && String(opts.agentName).trim()
      ? String(opts.agentName).trim()
      : 'Your agent';

  const bodyFrag = plainBodyToHtmlFragment(bodyPlain);
  const matchesSection =
    includePropertyCards && listings.length
      ? consultationStyleMatchesSectionHtml(
          listings,
          agentName,
          opts.propertyMatchesContext || null,
          opts.propertyMatchesNote || null,
        )
      : '';

  const inner = `
<div style="font-size:15px;line-height:1.55;color:#334155;">
  ${bodyFrag || '<p style="margin:0;">(No message body)</p>'}
</div>
${matchesSection}`;

  const schedulingUrl =
    opts.schedulingUrl != null && String(opts.schedulingUrl).trim()
      ? String(opts.schedulingUrl).trim()
      : '';
  return wrapNurtureEmailShell(agentName, inner.trim(), { schedulingUrl });
}

/**
 * Plain body only → full document (no listing cards).
 */
export function buildNurtureEmailHtmlFromBody(plainBody, agentName = 'Your agent', schedulingUrl = '') {
  const frag = plainBodyToHtmlFragment(plainBody);
  const inner = `<div style="font-size:15px;line-height:1.55;color:#334155;">${frag || '<p style="margin:0;"></p>'}</div>`;
  const url = schedulingUrl != null && String(schedulingUrl).trim() ? String(schedulingUrl).trim() : '';
  return wrapNurtureEmailShell(agentName, inner, { schedulingUrl: url });
}
