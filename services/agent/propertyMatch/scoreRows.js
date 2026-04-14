import { locationOverlaps, norm } from './locationUtils.js';
import {
  partitionBuyerBudgetInputs,
  parseInventoryPrice,
  parseMaxBudget,
} from './parsing.js';

/** Slim CRM fields for the matched LeadProfile (other party), surfaced on property-matches API. */
export function buildMatchedLeadSnapshot(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const q = profile.qualification?.agent || {};
  return {
    intent: profile.intent || null,
    preferred_contact_method: profile.contact_preferences?.preferred_contact_method || null,
    best_time_to_contact: profile.contact_preferences?.best_time_to_contact || null,
    property_location: profile.property?.location || null,
    property_budget: profile.property?.budget || profile.property?.expected_price || null,
    property_timeline: profile.property?.timeline || null,
    property_type: profile.property?.property_type || null,
    bedrooms: profile.property?.bedrooms || null,
    bathrooms: profile.property?.bathrooms || null,
    mortgage_status: q.mortgage_status || null,
    realtor_status: q.realtor_status || null,
    motivation_reason: q.motivation_reason || null,
    viewing_readiness: q.viewing_readiness || null,
    living_situation: q.living_situation || null,
    urgency_readiness: q.urgency_readiness || null,
  };
}

export const parseBedrooms = (profile, signals) => {
  const b = profile?.property?.bedrooms ?? signals?.beds;
  if (b == null || b === '') return null;
  const n = parseInt(String(b), 10);
  return Number.isFinite(n) ? n : null;
};

/** Shared context for buyer scoring + preference filter (single source of truth). */
export function buildBuyerScoringContext(leadProfile, signals = {}) {
  const budgetStr = leadProfile?.budget || signals?.budget;
  const profileBudget = leadProfile?.property?.budget || leadProfile?.property?.expected_price;
  const maxBudget =
    ((profileBudget || budgetStr) && parseInventoryPrice(profileBudget || budgetStr)) ||
    parseMaxBudget(profileBudget || budgetStr) ||
    null;
  const minBeds = parseBedrooms(leadProfile, signals);
  const leadLocation =
    leadProfile?.property?.location ||
    leadProfile?.property?.address ||
    signals?.location ||
    '';
  return { leadProfile, maxBudget, minBeds, leadLocation };
}

export function buyerSpecifiedAnyPreference(ctx) {
  const { leadLocation, maxBudget, minBeds, leadProfile } = ctx;
  const loc = String(leadLocation || '').trim();
  const typeN = norm(leadProfile?.property?.property_type || '');
  return (
    Boolean(loc) ||
    (maxBudget != null && Number.isFinite(maxBudget) && maxBudget > 0) ||
    (minBeds != null && minBeds > 0) ||
    Boolean(typeN)
  );
}

function computeBuyerRowAlignmentState(row, ctx, b) {
  const { leadProfile, maxBudget, minBeds, leadLocation } = ctx;
  const loc = String(leadLocation || '').trim();
  const hasLoc = Boolean(loc);
  const hasBudget = maxBudget != null && Number.isFinite(maxBudget) && maxBudget > 0;
  const hasBeds = minBeds != null && minBeds > 0;
  const pt = norm(leadProfile?.property?.property_type || '');

  const areaMatch = hasLoc && locationOverlaps(loc, row.location, row.address);

  let budgetTier = null;
  if (hasBudget && row.price != null && row.price > 0) {
    if (row.price <= maxBudget * b.budgetWithinCapMult) budgetTier = 'within';
    else if (row.price <= maxBudget * b.budgetSlightCapMult) budgetTier = 'slight';
    else budgetTier = 'over';
  }

  let bedsTier = null;
  if (hasBeds) {
    if (row.bedrooms >= minBeds) bedsTier = 'match';
    else if (row.bedrooms === minBeds - 1) bedsTier = 'close';
    else bedsTier = 'under';
  }

  const typeMatch = Boolean(pt && norm(row.property_type || '').includes(pt));

  return {
    areaMatch,
    budgetTier,
    bedsTier,
    typeMatch,
  };
}

/**
 * Location is the only hard filter — showing a Lahore buyer Toronto listings is useless.
 * Budget, beds, and type are scoring factors: mismatches lower the score but do not disqualify
 * a row, so partial matches still surface as ranked suggestions.
 */
export function applyBuyerPreferenceFilter(scored, ctx) {
  const loc = String(ctx.leadLocation || '').trim();
  if (!loc) return scored;
  return scored.filter((x) => locationOverlaps(loc, x.row.location, x.row.address));
}

function resolveMatchHeadline(reasons, source) {
  const count = reasons.length;
  if (count === 0) return null;
  if (source === 'buyer_lead') {
    if (count >= 3) return 'Strong buyer match';
    if (count >= 2) return 'Interested buyer';
    return 'Possible buyer';
  }
  if (count >= 3) return 'Strong listing match';
  if (count >= 2) return 'Good listing match';
  return 'Partial match';
}

export const mapMatchResults = (picked, maxDisplayScore, source = 'seller_lead') =>
  picked.map(({ row, score, reasons }) => {
    const id = String(row._id);
    const resolvedSource = id.startsWith('nesti:') ? 'agent_profile' : source;
    const mc = row.matched_contact && typeof row.matched_contact === 'object' ? row.matched_contact : null;
    return {
      id,
      title: row.title,
      address: row.address,
      location: row.location,
      price: row.price,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      property_type: row.property_type,
      image_url: row.image_url || '',
      listing_url: row.listing_url || '',
      summary: row.summary || '',
      match_score: Math.min(maxDisplayScore, Math.round(score)),
      match_headline: resolveMatchHeadline(reasons, resolvedSource),
      match_reasons: reasons,
      source: resolvedSource,
      matched_contact: mc
        ? {
            full_name: mc.full_name || null,
            email: mc.email || null,
            phone: mc.phone || null,
          }
        : null,
      lead_profile_id: row.lead_profile_id || null,
      matched_lead: row.matched_lead && typeof row.matched_lead === 'object' ? row.matched_lead : null,
    };
  });

const FINANCING_STATUS_LABELS = {
  fully_pre_approved:   'Fully pre-approved',
  partially_pre_approved: 'Partially pre-approved',
  not_pre_approved:     'Not pre-approved',
  pre_approved:         'Pre-approved',
  cash:                 'Cash buyer',
  cash_buyer:           'Cash buyer',
};

export function humanizeFinancingStatus(raw) {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  const key = s.toLowerCase().replace(/\s+/g, '_');
  if (FINANCING_STATUS_LABELS[key]) return FINANCING_STATUS_LABELS[key];
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buyerMatchReasonsForSellerView(reasons, listingBedrooms) {
  return reasons.map((r) => {
    const m = /^(\d+)\+ beds$/.exec(r);
    if (m && listingBedrooms != null) {
      return `Your listing (${m[1]} bed${m[1] === '1' ? '' : 's'}) fits what they're looking for`;
    }
    if (m) return 'Bedroom count aligns with their search';
    return r;
  });
}

export function mapBuyerMatchResult(profile, score, reasons, maxDisplayScore, { listingBedrooms } = {}) {
  const loc = (profile.property?.location || profile.property?.address || '').trim();
  const beds = parseInt(String(profile.property?.bedrooms || ''), 10);
  const baths = parseFloat(String(profile.property?.bathrooms || ''));
  const type = (profile.property?.property_type || '').trim();
  const { budgetStr, financingStr } = partitionBuyerBudgetInputs(
    profile.property?.budget,
    profile.property?.expected_price
  );
  const financingRaw =
    String(profile.qualification?.agent?.mortgage_status || '').trim() || financingStr || undefined;
  const financingLabel = financingRaw ? humanizeFinancingStatus(financingRaw) : undefined;

  let price =
    (budgetStr && (parseInventoryPrice(budgetStr) || parseMaxBudget(budgetStr))) || null;
  if (price == null || !Number.isFinite(price) || price <= 0) {
    const exp = String(profile.property?.expected_price || '').trim();
    if (exp) {
      price = parseInventoryPrice(exp) || parseMaxBudget(exp) || null;
      if (price != null && (!Number.isFinite(price) || price <= 0)) price = null;
    }
  }

  let budgetText;
  if (budgetStr) {
    const p = parseInventoryPrice(budgetStr) || parseMaxBudget(budgetStr);
    if (p == null || !Number.isFinite(p) || p <= 0) budgetText = budgetStr;
  }

  const displayParts = [];
  if (price != null && Number.isFinite(price) && price > 0) {
    displayParts.push(`Budget ~$${Math.round(price).toLocaleString('en-US')}`);
  } else if (budgetText) {
    displayParts.push(`Budget ${budgetText}`);
  } else {
    displayParts.push('Purchase budget not on file');
  }
  if (financingLabel) displayParts.push(financingLabel);

  const mappedReasons = buyerMatchReasonsForSellerView(reasons, listingBedrooms);
  const buyerName = String(profile.identity?.full_name || '').trim();
  const title =
    buyerName ||
    [type, loc].filter(Boolean).join(' · ') ||
    'Buyer match';
  const out = {
    id: String(profile._id),
    title,
    location: loc || undefined,
    price: price != null && Number.isFinite(price) && price > 0 ? price : null,
    financing_status: financingLabel,
    financing_status_code: financingRaw,
    budget_display: displayParts.join(' · '),
    bedrooms: Number.isFinite(beds) ? beds : null,
    property_type: type || undefined,
    match_score: Math.min(maxDisplayScore, Math.round(score)),
    match_headline: resolveMatchHeadline(reasons, 'buyer_lead'),
    match_reasons: mappedReasons,
    source: 'buyer_lead',
    matched_contact: {
      full_name: profile.identity?.full_name || null,
      email: profile.identity?.email || null,
      phone: profile.identity?.phone || null,
    },
    lead_profile_id: String(profile._id),
    matched_lead: buildMatchedLeadSnapshot(profile),
  };

  if (Number.isFinite(baths)) out.bathrooms = baths;

  return out;
}

export function scoreRowsForBuyer(rows, ctx, b) {
  return rows.map((row) => {
    const st = computeBuyerRowAlignmentState(row, ctx, b);
    let score = b.baseScore;
    const reasons = [];

    if (st.budgetTier === 'within') {
      score += b.budgetWithinPoints;
      reasons.push('Within budget');
    } else if (st.budgetTier === 'slight') {
      score += b.budgetSlightPoints;
      reasons.push('Slightly above budget');
    } else if (st.budgetTier === 'over') {
      score += b.budgetOverPenalty;
    }

    if (st.bedsTier === 'match') {
      score += b.bedsMatchPoints;
      reasons.push(`${row.bedrooms}+ beds`);
    } else if (st.bedsTier === 'close') {
      score += b.bedsClosePoints;
    } else if (st.bedsTier === 'under') {
      score += b.bedsUnderPenalty;
    }

    if (st.areaMatch) {
      score += b.areaPoints;
      reasons.push('Area match');
    }

    if (st.typeMatch) {
      score += b.typePoints;
      reasons.push('Property type match');
    }

    return { row, score, reasons };
  });
}

export function scoreRowsForSellerComparable(
  rows,
  { leadProfile, askPrice, sellerLoc, sellerBeds },
  s
) {
  return rows.map((row) => {
    let score = s.baseScore;
    const reasons = [];

    if (sellerLoc && locationOverlaps(sellerLoc, row.location, row.address)) {
      score += s.areaPoints;
      reasons.push('Same area / comparable location');
    }

    if (askPrice != null && row.price != null && row.price > 0) {
      const lowT = askPrice * s.priceTightLowMult;
      const highT = askPrice * s.priceTightHighMult;
      const lowW = askPrice * s.priceWideLowMult;
      const highW = askPrice * s.priceWideHighMult;
      if (row.price >= lowT && row.price <= highT) {
        score += s.priceTightPoints;
        reasons.push('Similar price range');
      } else if (row.price >= lowW && row.price <= highW) {
        score += s.priceWidePoints;
        reasons.push('Related price band');
      } else {
        score += s.priceMissPenalty;
      }
    }

    if (sellerBeds != null && row.bedrooms > 0) {
      const diff = Math.abs(row.bedrooms - sellerBeds);
      if (diff === 0) {
        score += s.bedSamePoints;
        reasons.push('Same bedrooms');
      } else if (diff === 1) {
        score += s.bedClosePoints;
        reasons.push('Similar size');
      }
    }

    const pt = norm(leadProfile?.property?.property_type);
    if (pt && norm(row.property_type).includes(pt)) {
      score += s.typePoints;
      reasons.push('Same property type');
    }

    return { row, score, reasons };
  });
}
