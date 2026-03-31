import { locationOverlaps, norm } from './locationUtils.js';
import {
  partitionBuyerBudgetInputs,
  parseInventoryPrice,
  parseMaxBudget,
} from './parsing.js';

export const parseBedrooms = (profile, signals) => {
  const b = profile?.bedrooms ?? signals?.beds;
  if (b == null || b === '') return null;
  const n = parseInt(String(b), 10);
  return Number.isFinite(n) ? n : null;
};

export const mapMatchResults = (picked, maxDisplayScore, source = 'seller_lead') =>
  picked.map(({ row, score, reasons }) => ({
    id: String(row._id),
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
    match_reasons: reasons,
    source,
  }));

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
  const loc = (profile.location || profile.property_address || '').trim();
  const beds = parseInt(String(profile.bedrooms || ''), 10);
  const baths = parseFloat(String(profile.bathrooms || ''));
  const type = (profile.property_type || '').trim();
  const { budgetStr, financingStr } = partitionBuyerBudgetInputs(
    profile.budget,
    profile.expected_price
  );
  const financingRaw =
    String(profile.mortgage_status || '').trim() || financingStr || undefined;
  const financingLabel = financingRaw ? humanizeFinancingStatus(financingRaw) : undefined;

  let price =
    (budgetStr && (parseInventoryPrice(budgetStr) || parseMaxBudget(budgetStr))) || null;
  if (price == null || !Number.isFinite(price) || price <= 0) {
    const exp = String(profile.expected_price || '').trim();
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

  const out = {
    id: String(profile._id),
    title: 'Buyer inquiry',
    location: loc || undefined,
    price: price != null && Number.isFinite(price) && price > 0 ? price : null,
    financing_status: financingLabel,
    financing_status_code: financingRaw,
    budget_display: displayParts.join(' · '),
    bedrooms: Number.isFinite(beds) ? beds : null,
    property_type: type || undefined,
    match_score: Math.min(maxDisplayScore, Math.round(score)),
    match_reasons: buyerMatchReasonsForSellerView(reasons, listingBedrooms),
    source: 'buyer_lead',
  };

  if (Number.isFinite(baths)) out.bathrooms = baths;

  return out;
}

export function scoreRowsForBuyer(rows, { leadProfile, maxBudget, minBeds, leadLocation }, b) {
  return rows.map((row) => {
    let score = b.baseScore;
    const reasons = [];

    if (maxBudget != null && row.price > 0) {
      if (row.price <= maxBudget * b.budgetWithinCapMult) {
        score += b.budgetWithinPoints;
        reasons.push('Within budget');
      } else if (row.price <= maxBudget * b.budgetSlightCapMult) {
        score += b.budgetSlightPoints;
        reasons.push('Slightly above budget');
      } else {
        score += b.budgetOverPenalty;
      }
    }

    if (minBeds != null && row.bedrooms >= minBeds) {
      score += b.bedsMatchPoints;
      reasons.push(`${row.bedrooms}+ beds`);
    } else if (minBeds != null && row.bedrooms === minBeds - 1) {
      score += b.bedsClosePoints;
    } else if (minBeds != null && row.bedrooms < minBeds - 1) {
      score += b.bedsUnderPenalty;
    }

    if (leadLocation && locationOverlaps(leadLocation, row.location, row.address)) {
      score += b.areaPoints;
      reasons.push('Area match');
    }

    const pt = norm(leadProfile?.property_type);
    if (pt && norm(row.property_type).includes(pt)) {
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

    if (askPrice != null && row.price > 0) {
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

    const pt = norm(leadProfile?.property_type);
    if (pt && norm(row.property_type).includes(pt)) {
      score += s.typePoints;
      reasons.push('Same property type');
    }

    return { row, score, reasons };
  });
}
