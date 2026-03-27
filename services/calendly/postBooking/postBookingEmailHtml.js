export const MAX_MAP_STOPS = 8;
export const SHOWING_MINS = '30–45';
export const SELLER_PREP_CHECKLIST = [
  'Declutter main living areas and closets for photos and showings.',
  'Gather utility bills, tax records, and any renovation permits.',
  'Plan minor repairs: paint touch-ups, leaks, burned-out bulbs.',
  'Boost curb appeal: lawn, entryway, mailbox, house numbers.',
  'Identify ideal closing timeline and any must-have sale conditions.',
];
export const SECTION_TITLES = {
  property_matches:     'Matched properties',
  showing_itinerary:    'Suggested showing itinerary',
  map_route:            'Tour route and directions',
  budget_analysis:      'Budget and financing overview',
  property_alerts:      'Listing alert preferences',
  seller_followup_pack: 'Listing preparation summary',
  market_report:        'Market and neighbourhood overview',
};

export function formatMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style:                 'currency',
      currency:              'USD',
      maximumFractionDigits: 0,
    }).format(Number(n));
  } catch {
    return String(n);
  }
}

export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const EMAIL_LINK_STYLE =
  'color:#1d4ed8;text-decoration:underline;font-weight:500;';

export function matchesToHtml(matches, contextLabel) {
  if (!matches?.length) {
    return `<p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.5;">No matching properties are on file at this time. Your agent will follow up with tailored options.</p>`;
  }
  const th =
    'padding:10px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-size:12px;font-weight:600;color:#475569;text-align:left;';
  const td =
    'padding:10px 12px;border:1px solid #e2e8f0;vertical-align:top;font-size:14px;line-height:1.45;color:#334155;';
  const rows = matches
    .map((m) => {
      const reasons = Array.isArray(m.match_reasons) ? m.match_reasons.join('; ') : '';
      return `<tr>
        <td style="${td}">
          <strong style="color:#0f172a;">${escapeHtml(m.title || 'Property')}</strong><br/>
          <span style="color:#64748b;">${escapeHtml(m.address || m.location || '—')}</span><br/>
          <span style="color:#64748b;font-size:13px;">${m.price != null ? formatMoney(m.price) : '—'}${m.bedrooms != null ? ` · ${m.bedrooms} bd` : ''}${m.bathrooms != null ? ` · ${m.bathrooms} ba` : ''}</span>
        </td>
        <td style="${td}">${m.match_score != null ? `<strong>${m.match_score}</strong>/100` : '—'}</td>
        <td style="${td};font-size:13px;color:#475569;">${escapeHtml(reasons)}</td>
      </tr>`;
    })
    .join('');
  return `
    <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#0f172a;letter-spacing:0.02em;">${escapeHtml(contextLabel)}</p>
    <table role="presentation" style="border-collapse:collapse;width:100%;max-width:640px;margin:0 0 4px;">
      <thead><tr>
        <th style="${th}">Property</th>
        <th style="${th}">Score</th>
        <th style="${th}">Match notes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function matchAddressesForMap(matches) {
  if (!matches?.length) return [];
  const out = [];
  for (const m of matches) {
    const line = [m.address, m.location].map((x) => String(x || '').trim()).find(Boolean);
    if (line) out.push(line);
  }
  return [...new Set(out)].slice(0, MAX_MAP_STOPS);
}

export function googleMapsDirUrl(addresses) {
  if (!addresses.length) return null;
  const path = addresses.map((a) => encodeURIComponent(a)).join('/');
  return `https://www.google.com/maps/dir/${path}`;
}

export function googleMapsSearchUrl(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function wrapComprehensiveEmail(agentName, sections) {
  const divider =
    '<div style="height:1px;background:#e2e8f0;margin:26px 0;" role="separator"></div>';
  const blocks = sections
    .map(
      (s) =>
        `<h2 style="font-size:15px;margin:0 0 14px;color:#0f172a;font-weight:600;letter-spacing:0.01em;">${escapeHtml(s.title)}</h2>\n<div style="font-size:14px;line-height:1.55;color:#334155;">${s.html}</div>`
    )
    .join(divider);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:28px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:22px 28px;">
        <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Appointment materials</div>
        <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:19px;font-weight:600;color:#f8fafc;margin-top:8px;line-height:1.25;">${escapeHtml(agentName)}</div>
      </td></tr>
      <tr><td style="padding:28px 28px 32px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155;">Hello,</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">Thank you for scheduling time with <strong style="color:#0f172a;">${escapeHtml(agentName)}</strong>. The following sections summarize information from your conversation and your agent&rsquo;s records to help you prepare. This content is provided for reference only and does not constitute financial, legal, or investment advice.</p>
        ${blocks}
        <p style="margin:28px 0 0;font-size:12px;line-height:1.55;color:#64748b;border-top:1px solid #e2e8f0;padding-top:22px;">
          This message was prepared by <strong>Nesti</strong> on behalf of your real estate professional. For transaction-specific guidance, please contact <strong>${escapeHtml(agentName)}</strong> directly.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export function comprehensivePlainText(agentName, sectionTitles) {
  const list = sectionTitles.length
    ? sectionTitles.map((t) => `- ${t}`).join('\n')
    : '- Summary materials';
  return `Hello,\n\nThank you for scheduling with ${agentName}. This message includes the following sections:\n\n${list}\n\nPlease open the HTML version of this email for tables, links, and full formatting.\n\nThis content is for reference only and does not constitute financial, legal, or investment advice.\n\n— Nesti (on behalf of ${agentName})`;
}

export function budgetNarrativeLines(leadProfile) {
  const ms = String(leadProfile?.mortgage_status || '').toLowerCase();
  const lines = [];
  if (/cash|paying_cash/.test(ms)) {
    lines.push(
      'Cash or equivalent purchasing power may streamline contingencies; confirm reserves for closing costs and relocation.'
    );
  } else if (/pre|approv/.test(ms)) {
    lines.push(
      'With financing documentation in progress, focus on aligning list prices with your comfort level and non‑negotiable criteria.'
    );
  } else {
    lines.push(
      'Securing pre-approval or verified cash capacity allows your agent to prioritize suitable properties efficiently.'
    );
  }

  const vr = String(leadProfile?.viewing_readiness || '');
  if (/asap|few_weeks/.test(vr)) {
    lines.push('Given your timeline, consider refining a short list of priority properties following your strategy discussion.');
  }

  const ur = String(leadProfile?.urgency_readiness || '');
  if (/yes_immediately|maybe/.test(ur)) {
    lines.push(
      'For offer readiness, prepare a current pre-approval letter (if applicable) and your preferred closing window.'
    );
  }

  return lines.length
    ? lines
    : ['Your agent will help translate these inputs into a practical search strategy during your consultation.'];
}

export function formatTimelineLabel(raw) {
  const t = String(raw || '').trim();
  if (!t) return '—';
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sellerListingSnapshotHtml(leadProfile) {
  if (!leadProfile) {
    return '<p style="margin:0;color:#64748b;">Listing details will be confirmed during your appointment.</p>';
  }
  const rows = [
    ['Address', leadProfile.property_address || leadProfile.location || '—'],
    ['Expected price', leadProfile.expected_price || leadProfile.budget || '—'],
    ['Type', leadProfile.property_type || '—'],
    ['Beds / baths', `${leadProfile.bedrooms || '—'} / ${leadProfile.bathrooms || '—'}`],
    ['Timeline', formatTimelineLabel(leadProfile.timeline)],
  ];
  const td =
    'padding:10px 12px;border:1px solid #e2e8f0;font-size:14px;line-height:1.45;color:#334155;';
  return `<table role="presentation" style="border-collapse:collapse;width:100%;max-width:560px;">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="${td}"><strong style="color:#0f172a;">${escapeHtml(k)}</strong></td>
        <td style="${td}">${escapeHtml(String(v))}</td></tr>`
    )
    .join('')}</table>`;
}

export function sellerChecklistHtml() {
  const items = SELLER_PREP_CHECKLIST.map((x) => `<li style="margin-bottom:6px;">${escapeHtml(x)}</li>`).join('');
  return `<p style="margin:16px 0 8px;font-size:14px;font-weight:600;color:#0f172a;">Preparation checklist</p><ul style="margin:0;padding-left:20px;line-height:1.55;">${items}</ul>`;
}
