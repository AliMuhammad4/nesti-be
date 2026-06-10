/**
 * Nurture email HTML: same outer shell and matched-properties table as post-booking
 * consultation emails (see wrapComprehensiveEmail / matchesToHtml in postBookingEmail.js).
 */
import { matchesToHtml } from '../calendly/postBooking/postBookingEmail.js';
import {
  EMAIL_BLUE_CTA_STYLE,
  EMAIL_GREEN_CTA_STYLE,
  EMAIL_LINK_STYLE,
  renderBrandedEmailShell,
} from '../email/emailTheme.js';

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
        return `<a href="${href}" style="${EMAIL_BLUE_CTA_STYLE}margin:8px 0 4px 0;">Schedule a call</a>`;
      }
      const label = escapeHtml(normalized);
      return `<a href="${href}" style="${EMAIL_LINK_STYLE}">${label}</a>`;
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
        ? `<a href="${hrefAttr(url)}" style="${EMAIL_GREEN_CTA_STYLE}padding:10px 18px;border-radius:6px;font-size:14px;margin-top:10px;">View listing</a>`
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

function isListingBulletLine(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  const normalized = s.replace(/^_+/, '').trim();
  if (!/^[-*]\s+/.test(normalized)) return false;
  const lower = normalized.toLowerCase();
  return (
    /\$[\d,]/.test(normalized) ||
    /bed|bath|budget|stretch|area match|property type|lahore|karachi|islamabad/.test(lower)
  );
}

function isMarkdownTableSeparatorLine(value) {
  const s = String(value || '').trim();
  return s.includes('|') && /-{2,}/.test(s) && /^[\s|:-]+$/.test(s);
}

function isMarkdownTableRow(value) {
  const s = String(value || '').trim();
  if (!s.includes('|')) return false;
  const cells = s.split('|').map((part) => part.trim()).filter(Boolean);
  return cells.length >= 2;
}

function isListingTableIntroLine(value) {
  const s = String(value || '').trim().toLowerCase();
  return (
    /^matched options include\s*:/.test(s) ||
    /matched listings|listings for your consideration|property listings below|review the matched listings|here are the matched listings/i.test(
      s,
    )
  );
}

function skipMarkdownTableBlock(lines, startIndex) {
  let i = startIndex;
  while (i < lines.length) {
    const trimmed = String(lines[i] || '').trim();
    if (!trimmed) {
      i += 1;
      break;
    }
    if (isMarkdownTableRow(lines[i]) || isMarkdownTableSeparatorLine(lines[i])) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function stripMatchedOptionsBlock(plainBody) {
  const raw = String(plainBody || '');
  if (!raw.trim()) return '';
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = String(lines[i] || '').trim();
    if (/^matched options include\s*:/i.test(line)) {
      i += 1;
      while (i < lines.length) {
        const bullet = String(lines[i] || '').trim();
        if (isListingBulletLine(bullet)) {
          i += 1;
          continue;
        }
        if (!bullet) {
          i += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (isListingBulletLine(line)) {
      while (i < lines.length && isListingBulletLine(lines[i])) i += 1;
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripMarkdownListingTables(plainBody) {
  const raw = String(plainBody || '');
  if (!raw.trim()) return '';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = String(lines[i] || '').trim();

    if (isListingTableIntroLine(trimmed)) {
      i += 1;
      while (i < lines.length && !String(lines[i] || '').trim()) i += 1;
      if (i < lines.length && (isMarkdownTableRow(lines[i]) || isMarkdownTableSeparatorLine(lines[i]))) {
        i = skipMarkdownTableBlock(lines, i);
      }
      continue;
    }

    if (isMarkdownTableRow(lines[i]) || isMarkdownTableSeparatorLine(lines[i])) {
      i = skipMarkdownTableBlock(lines, i);
      continue;
    }

    out.push(lines[i]);
    i += 1;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Remove inline listing bullets/tables when formatted property cards are appended separately. */
export function sanitizeNurturePlainBodyForPropertyCards(plainBody) {
  let cleaned = stripMatchedOptionsBlock(plainBody);
  cleaned = stripMarkdownListingTables(cleaned);
  return cleaned;
}

function stripInlineBookingCta(plainBody) {
  const raw = String(plainBody || '');
  if (!raw.trim()) return '';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const kept = lines.filter((line) => {
    const s = String(line || '').trim().toLowerCase();
    if (!s) return true;
    if (s.includes('calendly.com')) return false;
    if (/^book a time that works for you\s*:/.test(s)) return false;
    if (/^schedule a (call|meeting)\b/.test(s)) return false;
    return true;
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Outer layout aligned with consultation / post-booking emails (gradient header + Nesti footer).
 * @param {{ schedulingUrl?: string | null, signature?: { display_name?: string | null, email?: string | null, phone?: string | null } | null }} [options]
 */
export function wrapNurtureEmailShell(agentName, innerHtml, options = {}) {
  const name = String(agentName || 'Your agent').trim() || 'Your agent';
  const schedulingUrl =
    options.schedulingUrl != null && String(options.schedulingUrl).trim()
      ? String(options.schedulingUrl).trim()
      : '';
  const scheduleBlock = schedulingUrl
    ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.55;color:#334155;">To book an appointment with <strong>${escapeHtml(name)}</strong>, please select a time using the scheduling link below.</p>
<p style="margin:12px 0 0;"><a href="${hrefAttr(schedulingUrl)}" style="${EMAIL_BLUE_CTA_STYLE}">Schedule a meeting</a></p>`
    : `<p style="margin:16px 0 0;font-size:13px;line-height:1.55;color:#64748b;">For next steps, reply to this email or contact <strong>${escapeHtml(name)}</strong> using the contact details shared in the message above.</p>`;
  const sig = options.signature && typeof options.signature === 'object' ? options.signature : null;
  const sigName =
    sig?.display_name != null && String(sig.display_name).trim()
      ? String(sig.display_name).trim()
      : name;
  const sigEmail =
    sig?.email != null && String(sig.email).trim() ? String(sig.email).trim() : '';
  const sigPhone =
    sig?.phone != null && String(sig.phone).trim() ? String(sig.phone).trim() : '';
  const signatureBlock = `
    <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#334155;">
      Best regards,<br/>
      <strong>${escapeHtml(sigName)}</strong>${sigEmail ? `<br/>${escapeHtml(sigEmail)}` : ''}${sigPhone ? `<br/>${escapeHtml(sigPhone)}` : ''}
    </p>`;
  return renderBrandedEmailShell({
    kicker: 'Follow-up message',
    title: escapeHtml(name),
    innerHtml: `${innerHtml}
      <p style="margin:28px 0 0;font-size:12px;line-height:1.55;color:#64748b;border-top:1px solid #e2e8f0;padding-top:22px;">
        This message was prepared by <strong>Nesti</strong> on behalf of your real estate professional.
      </p>
      ${scheduleBlock}
      ${signatureBlock}`,
    maxWidth: 600,
  });
}

function mapNurtureListingForMatchesTable(L) {
  if (!L || typeof L !== 'object') return null;
  const reasons = Array.isArray(L.match_reasons) ? L.match_reasons.filter(Boolean).map(String) : [];
  const rawHeadline = L.match_headline ? String(L.match_headline).trim() : '';
  const fromHeadline =
    rawHeadline && !/strong buyer match|interested buyer/i.test(rawHeadline) ? [rawHeadline] : [];
  const match_reasons = reasons.length ? reasons : fromHeadline;
  const propertyType = String(L.property_type || '').trim();
  return {
    title: propertyType || 'Property',
    address: L.address || null,
    location: L.location || null,
    price: L.price,
    bedrooms: L.bedrooms,
    bathrooms: L.bathrooms,
    match_score: L.match_score,
    match_reasons,
  };
}

function consultationStyleMatchesSectionHtml(
  listings,
  agentName,
  propertyMatchesContext,
  propertyMatchesNote,
  listingTableColumns,
) {
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
  const columnsMode = listingTableColumns === 'location_budget' ? 'location_budget' : 'default';
  return `${divider}
<h2 style="font-size:15px;margin:0 0 14px;color:#0f172a;font-weight:600;letter-spacing:0.01em;">${escapeHtml(NURTURE_LISTINGS_SECTION_TITLE)}</h2>
<div style="font-size:14px;line-height:1.55;color:#334155;">
  <p style="margin:0 0 14px;">${intro}</p>
  ${matchesToHtml(rows, '', { includeContextHeading: false, columnsMode })}
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
 *   signature?: { display_name?: string | null, email?: string | null, phone?: string | null } | null,
 *   listingTableColumns?: 'score_notes' | 'location_budget',
 * }} opts
 */
export function composeNurtureEmailHtml(opts) {
  const bodyPlainRaw = opts.bodyPlain ?? '';
  const listings = Array.isArray(opts.listings) ? opts.listings : [];
  const includePropertyCards = opts.includePropertyCards !== false;
  const agentName =
    opts.agentName != null && String(opts.agentName).trim()
      ? String(opts.agentName).trim()
      : 'Your agent';

  let bodyPlain = bodyPlainRaw;
  if (includePropertyCards && listings.length) {
    bodyPlain = sanitizeNurturePlainBodyForPropertyCards(bodyPlain);
  }
  // Keep only one booking CTA in final HTML (footer schedule button).
  bodyPlain = stripInlineBookingCta(bodyPlain);
  const bodyFrag = plainBodyToHtmlFragment(bodyPlain);
  const listingTableColumns =
    opts.listingTableColumns === 'location_budget' ? 'location_budget' : 'score_notes';

  const matchesSection =
    includePropertyCards && listings.length
      ? consultationStyleMatchesSectionHtml(
          listings,
          agentName,
          opts.propertyMatchesContext || null,
          opts.propertyMatchesNote || null,
          listingTableColumns,
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
  return wrapNurtureEmailShell(agentName, inner.trim(), {
    schedulingUrl,
    signature: opts.signature || null,
  });
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
