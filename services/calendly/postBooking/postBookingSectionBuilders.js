
import LeadMatch from '../../../models/LeadMatch.js';
import {
  partitionBuyerBudgetInputs,
  parseInventoryPrice,
  parseMaxBudget,
} from '../../agent/propertyMatch/parsing.js';
import { humanizeFinancingStatus } from '../../agent/propertyMatch/scoreRows.js';
import { agentDisplayName, fetchPropertyMatchBundle, loadLeadProfileForConversation } from './postBookingContext.js';
import {
  EMAIL_LINK_STYLE,
  MAX_MAP_STOPS,
  SHOWING_MINS,
  budgetNarrativeLines,
  escapeHtml,
  formatMoney,
  formatTimelineLabel,
  googleMapsDirUrl,
  googleMapsSearchUrl,
  matchAddressesForMap,
  matchesToHtml,
  sellerChecklistHtml,
  sellerListingSnapshotHtml,
} from './postBookingEmailHtml.js';

export async function buildPropertyMatchesSection(ctx) {
  const { flowType } = ctx;
  if (flowType !== 'agent') {
    return { status: 'skipped', detail: 'not_agent_embed', sectionHtml: null };
  }

  const bundle = await fetchPropertyMatchBundle(ctx);
  if (bundle.error) return { status: 'skipped', detail: bundle.error, sectionHtml: null };

  const { property_matches, property_matches_context, property_matches_note } = bundle;
  const agentName = agentDisplayName(ctx);
  const contextLabel =
    property_matches_context === 'sell'
      ? 'Comparable activity on file'
      : 'Properties aligned with your search criteria';

  const sectionHtml = `
    <p style="margin:0 0 14px;">The following properties are drawn from <strong>${escapeHtml(agentName)}</strong>&rsquo;s pipeline for your review prior to your appointment.</p>
    ${matchesToHtml(property_matches, contextLabel)}
    ${property_matches_note ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#64748b;">${escapeHtml(property_matches_note)}</p>` : ''}
  `;
  return { status: 'completed', detail: `matches=${property_matches.length}`, sectionHtml };
}

export async function buildShowingItinerarySection(ctx) {
  if (ctx.flowType !== 'agent') {
    return { status: 'skipped', detail: 'not_agent_embed', sectionHtml: null };
  }
  const bundle = await fetchPropertyMatchBundle(ctx);
  if (bundle.error) return { status: 'skipped', detail: bundle.error, sectionHtml: null };
  if (bundle.propertyMatchIntent !== 'buy') {
    return { status: 'skipped', detail: 'not_buyer_intent', sectionHtml: null };
  }

  const { property_matches } = bundle;
  const agentName = agentDisplayName(ctx);
  const leadProfile = await loadLeadProfileForConversation({
    conversationId: ctx.conversation._id,
    userId:         ctx.userId,
    intent:         'buy',
  });

  let sectionHtml;
  if (property_matches?.length) {
    const stops = [...property_matches].sort(
      (a, b) => (Number(b.match_score) || 0) - (Number(a.match_score) || 0)
    );
    const items = stops.map((m, i) => {
      const addr = escapeHtml(m.address || m.location || 'Address TBD');
      const title = escapeHtml(m.title || 'Showing');
      const score = m.match_score != null ? `${m.match_score}/100` : '—';
      return `<li style="margin-bottom:12px;">
        <strong>Stop ${i + 1}</strong> — ${title}<br/>
        <span style="color:#333;">${addr}</span><br/>
        <span style="font-size:13px;color:#666;">Match ${score} · plan ~${SHOWING_MINS} min on site</span>
      </li>`;
    });
    sectionHtml = `
      <p style="margin:0 0 14px;">Below is a <strong>suggested showing sequence</strong> based on match scores from <strong>${escapeHtml(agentName)}</strong>&rsquo;s pipeline. Durations are approximate; your agent will confirm final scheduling.</p>
      <ol style="margin:0 0 16px;padding-left:22px;">${items.join('')}</ol>
      <p style="margin:0 0 8px;"><strong>Before your showings:</strong> note must-have features, parking or access requirements, and any questions regarding HOA, strata, or building rules.</p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">This itinerary is illustrative only and does not replace your agent&rsquo;s confirmed schedule.</p>
    `;
  } else {
    const area =
      leadProfile?.location ||
      leadProfile?.property_address ||
      bundle.signals?.location ||
      bundle.storedForm?.location ||
      '';
    const mapLink = googleMapsSearchUrl(area);
    sectionHtml = `
      <p style="margin:0 0 12px;">There are not yet sufficient listings on file to generate a full itinerary. <strong>${escapeHtml(agentName)}</strong> will propose specific showing stops following your consultation.</p>
      ${area ? `<p style="margin:0 0 12px;">Your noted area of focus: <strong>${escapeHtml(area)}</strong>${mapLink ? ` — <a href="${escapeHtml(mapLink)}" style="${EMAIL_LINK_STYLE}">View on Google Maps</a>` : ''}.</p>` : ''}
      <p style="margin:0;"><strong>Recommended preparation:</strong> current pre-approval or budget range, a concise must-have list, and preferred showing windows.</p>
    `;
  }

  return { status: 'completed', detail: `stops=${property_matches?.length || 0}`, sectionHtml };
}

export async function buildMapRouteSection(ctx) {
  if (ctx.flowType !== 'agent') {
    return { status: 'skipped', detail: 'not_agent_embed', sectionHtml: null };
  }
  const bundle = await fetchPropertyMatchBundle(ctx);
  if (bundle.error) return { status: 'skipped', detail: bundle.error, sectionHtml: null };
  if (bundle.propertyMatchIntent !== 'buy') {
    return { status: 'skipped', detail: 'not_buyer_intent', sectionHtml: null };
  }

  const addresses = matchAddressesForMap(bundle.property_matches);
  const agentName = agentDisplayName(ctx);
  const leadProfile = await loadLeadProfileForConversation({
    conversationId: ctx.conversation._id,
    userId:         ctx.userId,
    intent:         'buy',
  });
  const fallbackArea =
    leadProfile?.location ||
    leadProfile?.property_address ||
    bundle.signals?.location ||
    '';

  const mapUrl = googleMapsDirUrl(addresses);
  let intro;
  let detail;
  if (mapUrl) {
    detail = `stops=${addresses.length}`;
    intro = `<p style="margin:0 0 10px;">Multi-stop directions in Google Maps (addresses derived from your highest-ranked matches on file):</p>
      <p style="margin:0 0 10px;word-break:break-all;"><a href="${escapeHtml(mapUrl)}" style="${EMAIL_LINK_STYLE}">${escapeHtml(mapUrl)}</a></p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;">Up to ${MAX_MAP_STOPS} stops. You may reorder stops in Maps; actual drive times and property access may vary.</p>`;
  } else {
    const searchUrl = googleMapsSearchUrl(fallbackArea);
    detail = searchUrl ? 'fallback_search' : 'no_addresses';
    intro = searchUrl
      ? `<p style="margin:0 0 10px;">Complete street addresses are not yet available for a multi-stop route. Search your target area:</p>
         <p style="margin:0;"><a href="${escapeHtml(searchUrl)}" style="${EMAIL_LINK_STYLE}">${escapeHtml(fallbackArea || 'Open map search')}</a></p>`
      : `<p style="margin:0;">Addresses are not yet on file for route planning. Your agent will confirm showing locations after your consultation.</p>`;
  }

  const sectionHtml = `<p style="margin:0 0 12px;"><strong>${escapeHtml(agentName)}</strong> — suggested tour routing:</p>${intro}`;
  return { status: 'completed', detail, sectionHtml };
}

export async function buildBudgetAnalysisSection(ctx) {
  if (ctx.flowType !== 'agent') {
    return { status: 'skipped', detail: 'not_agent_embed', sectionHtml: null };
  }
  const bundle = await fetchPropertyMatchBundle(ctx);
  if (bundle.error) return { status: 'skipped', detail: bundle.error, sectionHtml: null };
  if (bundle.propertyMatchIntent !== 'buy') {
    return { status: 'skipped', detail: 'not_buyer_intent', sectionHtml: null };
  }

  const leadProfile = await loadLeadProfileForConversation({
    conversationId: ctx.conversation._id,
    userId:         ctx.userId,
    intent:         'buy',
  });
  const form = bundle.storedForm || {};
  const { budgetStr, financingStr } = partitionBuyerBudgetInputs(
    leadProfile?.budget,
    leadProfile?.expected_price,
    form.budget,
    form.price,
    bundle.signals?.budget
  );

  const numeric =
    (budgetStr && (parseInventoryPrice(budgetStr) || parseMaxBudget(budgetStr))) || null;
  const financingLabel =
    humanizeFinancingStatus(leadProfile?.mortgage_status) ||
    humanizeFinancingStatus(financingStr) ||
    '—';

  const rows = [
    [
      'Purchase budget (from conversation)',
      budgetStr ? (numeric != null ? `${budgetStr} (${formatMoney(numeric)})` : budgetStr) : '—',
    ],
    ['Financing signal', financingLabel],
    ['Timeline', formatTimelineLabel(leadProfile?.timeline || form.timeline)],
    ['Living situation', formatTimelineLabel(leadProfile?.living_situation || '')],
    ['Viewing readiness', formatTimelineLabel(leadProfile?.viewing_readiness || '')],
    ['Target area', leadProfile?.location || leadProfile?.property_address || form.location || bundle.signals?.location || '—'],
    ['Beds (target)', leadProfile?.bedrooms || form.beds || bundle.signals?.beds || '—'],
  ];

  const btd =
    'padding:10px 12px;border:1px solid #e2e8f0;font-size:14px;line-height:1.45;color:#334155;';
  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="${btd}"><strong style="color:#0f172a;">${escapeHtml(k)}</strong></td>
        <td style="${btd}">${escapeHtml(String(v))}</td></tr>`
    )
    .join('');

  const bullets = budgetNarrativeLines(leadProfile || {}).map((x) => `<li>${escapeHtml(x)}</li>`).join('');

  const agentName = agentDisplayName(ctx);
  const sectionHtml = `
    <p style="margin:0 0 14px;"><strong>Budget and financing overview</strong> summarised from your conversation for discussion with <strong>${escapeHtml(agentName)}</strong>. This information is <strong>not</strong> financial advice.</p>
    <table role="presentation" style="border-collapse:collapse;width:100%;max-width:560px;margin:0 0 16px;">${tableRows}</table>
    <p style="margin:0 0 8px;font-weight:600;color:#0f172a;">Suggested discussion topics:</p>
    <ul style="margin:0 0 12px;padding-left:20px;line-height:1.55;">${bullets}</ul>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">Figures are self-reported. Your lender and agent will confirm affordability and programme eligibility.</p>
  `;

  return { status: 'completed', detail: 'budget_snapshot', sectionHtml };
}

export async function buildPropertyAlertsSection(ctx) {
  if (ctx.leadMatchId) {
    await LeadMatch.findByIdAndUpdate(ctx.leadMatchId, {
      $set: {
        'compatibility_factors.post_booking.property_alerts_requested': true,
        'compatibility_factors.post_booking.property_alerts_at':       new Date(),
      },
    });
  }

  if (ctx.flowType !== 'agent') {
    return { status: 'skipped', detail: 'not_agent_embed', sectionHtml: null };
  }

  const bundle = await fetchPropertyMatchBundle(ctx);
  if (bundle.error) return { status: 'skipped', detail: bundle.error, sectionHtml: null };

  const leadProfile = await loadLeadProfileForConversation({
    conversationId: ctx.conversation._id,
    userId:         ctx.userId,
    intent:         'buy',
  });
  const form = bundle.storedForm || {};
  const criteria = [
    ['Intent', 'Buy'],
    ['Area', leadProfile?.location || leadProfile?.property_address || form.location || bundle.signals?.location || '—'],
    [
      'Budget',
      leadProfile?.budget ||
        form.budget ||
        (bundle.signals?.budget ? String(bundle.signals.budget) : '') ||
        '—',
    ],
    ['Beds', leadProfile?.bedrooms || form.beds || bundle.signals?.beds || '—'],
    ['Property type', leadProfile?.property_type || form.property_type || '—'],
    ['Must-haves', leadProfile?.must_have_features || form.must_have_features || '—'],
    ['Parking', leadProfile?.parking_required || form.parking_required || '—'],
    ['Backyard', leadProfile?.backyard_needed || form.backyard_needed || '—'],
    ['School district priority', leadProfile?.school_district_important || form.school_district_important || '—'],
  ];

  const list = criteria
    .map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</li>`)
    .join('');

  const agentName = agentDisplayName(ctx);
  const sectionHtml = `
    <p style="margin:0 0 12px;"><strong>${escapeHtml(agentName)}</strong> may configure listing alerts consistent with the preferences below. Please review and confirm or update these criteria during your consultation.</p>
    <ul style="margin:0 0 14px;padding-left:20px;line-height:1.55;">${list}</ul>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;">Alert delivery depends on your agent&rsquo;s MLS and board tools. This message does not create an automatic subscription.</p>
  `;

  return { status: 'completed', detail: 'criteria_email', sectionHtml };
}

export async function buildSellerFollowupSection(ctx) {
  if (ctx.flowType !== 'agent') {
    return { status: 'skipped', detail: 'not_agent_embed', sectionHtml: null };
  }
  const bundle = await fetchPropertyMatchBundle(ctx);
  if (bundle.error) return { status: 'skipped', detail: bundle.error, sectionHtml: null };
  if (bundle.propertyMatchIntent !== 'sell') {
    return { status: 'skipped', detail: 'not_seller_intent', sectionHtml: null };
  }

  const leadProfile = await loadLeadProfileForConversation({
    conversationId: ctx.conversation._id,
    userId:         ctx.userId,
    intent:         'sell',
  });

  const agentName = agentDisplayName(ctx);
  const compsHtml = matchesToHtml(
    bundle.property_matches,
    'Informal comparables from agent pipeline (non-authoritative)'
  );

  const sectionHtml = `
    <p style="margin:0 0 16px;">The following <strong>listing preparation summary</strong> is compiled from your conversation and on-file pipeline data. It is not an appraisal, valuation, or guarantee of sale price.</p>
    <h3 style="margin:0 0 10px;font-size:14px;font-weight:600;color:#0f172a;">Property snapshot</h3>
    ${sellerListingSnapshotHtml(leadProfile)}
    <h3 style="margin:18px 0 10px;font-size:14px;font-weight:600;color:#0f172a;">Pipeline context</h3>
    ${compsHtml}
    ${bundle.property_matches_note ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#64748b;">${escapeHtml(bundle.property_matches_note)}</p>` : ''}
    ${sellerChecklistHtml()}
  `;

  return {
    status:      'completed',
    detail:      `comps=${bundle.property_matches?.length || 0}`,
    sectionHtml,
  };
}

export async function buildMarketReportSection(ctx) {
  if (ctx.flowType !== 'agent') {
    return { status: 'skipped', detail: 'not_agent_embed', sectionHtml: null };
  }
  const bundle = await fetchPropertyMatchBundle(ctx);
  if (bundle.error) return { status: 'skipped', detail: bundle.error, sectionHtml: null };
  if (bundle.propertyMatchIntent !== 'sell') {
    return { status: 'skipped', detail: 'not_seller_intent', sectionHtml: null };
  }

  const leadProfile = await loadLeadProfileForConversation({
    conversationId: ctx.conversation._id,
    userId:         ctx.userId,
    intent:         'sell',
  });

  const area =
    leadProfile?.location ||
    leadProfile?.property_address ||
    bundle.storedForm?.location ||
    '';
  const ask = leadProfile?.expected_price || leadProfile?.budget || '';
  const askNum = ask ? parseInventoryPrice(ask) || parseMaxBudget(ask) : null;

  const pipelineSellerCount = await LeadMatch.countDocuments({
    user_id:   ctx.userId,
    lead_type: { $regex: '_seller$' },
  });

  const agentName = agentDisplayName(ctx);
  const mapLink = googleMapsSearchUrl(area);

  const sectionHtml = `
    <p style="margin:0 0 14px;"><strong>Market and pipeline overview</strong> for your strategy session with <strong>${escapeHtml(agentName)}</strong>, based on your saved details and the agent&rsquo;s internal records. This is not a substitute for MLS or board-level market statistics.</p>
    <ul style="margin:0 0 16px;padding-left:20px;line-height:1.55;">
      <li style="margin-bottom:8px;"><strong>Focus area:</strong> ${escapeHtml(area || '—')} ${mapLink ? `(<a href="${escapeHtml(mapLink)}" style="${EMAIL_LINK_STYLE}">Google Maps</a>)` : ''}</li>
      <li style="margin-bottom:8px;"><strong>Indicative list price (from conversation):</strong> ${askNum != null ? escapeHtml(formatMoney(askNum)) : escapeHtml(ask || '—')}</li>
      <li style="margin-bottom:0;"><strong>Other active seller leads on file:</strong> ${pipelineSellerCount}</li>
    </ul>
    <h3 style="margin:0 0 10px;font-size:14px;font-weight:600;color:#0f172a;">Recent pipeline comparables (informal)</h3>
    ${matchesToHtml(bundle.property_matches, 'Comparable-style rows from agent inventory')}
    ${bundle.property_matches_note ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#64748b;">${escapeHtml(bundle.property_matches_note)}</p>` : ''}
    <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#64748b;">Authoritative comparable sales and market data will be provided by your agent from MLS and board sources.</p>
  `;

  return {
    status:      'completed',
    detail:      `comps=${bundle.property_matches?.length || 0}`,
    sectionHtml,
  };
}

export const SECTION_BUILDERS = {
  property_matches:     buildPropertyMatchesSection,
  showing_itinerary:    buildShowingItinerarySection,
  map_route:            buildMapRouteSection,
  budget_analysis:      buildBudgetAnalysisSection,
  property_alerts:      buildPropertyAlertsSection,
  seller_followup_pack: buildSellerFollowupSection,
  market_report:        buildMarketReportSection,
};
