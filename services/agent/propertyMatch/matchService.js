/**
 * Agent property matches (chat meta)
 *
 * Buy intent: score other seller leads vs this buyer (budget, area, beds).
 * Sell intent: score (a) other seller leads as comparables, and (b) buyer leads vs this listing — merged by score.
 * Data: LeadMatch + LeadProfile for the same agent (embed owner). Results are computed each request, not stored.
 */

import LeadMatch from '../../../models/LeadMatch.js';
import LeadProfile from '../../../models/LeadProfile.js';
import { getResolvedPropertyMatchScoring } from './scoringConfig.js';
import {
  parseMaxBudget,
  parseInventoryPrice,
  partitionBuyerBudgetInputs,
} from './parsing.js';
import { rowMatchesSellerAddress } from './locationUtils.js';
import {
  mapMatchResults,
  mapBuyerMatchResult,
  parseBedrooms,
  scoreRowsForBuyer,
  scoreRowsForSellerComparable,
} from './scoreRows.js';

// ─── Other sellers on file (this agent’s pipeline) ───────────────────────────

function sellerLeadProfileToRow(profile) {
  const price = parseInventoryPrice(profile.expected_price || profile.budget);
  if (!price || price <= 0) return null;
  const loc = (profile.location || '').trim();
  const addr = (profile.property_address || '').trim();
  if (!loc && !addr) return null;

  const beds = parseInt(String(profile.bedrooms || ''), 10);
  const baths = parseFloat(String(profile.bathrooms || ''));
  const typeLabel = (profile.property_type || 'Property').trim();

  return {
    _id: `lead:${String(profile._id)}`,
    title: typeLabel,
    address: addr,
    location: loc || addr,
    price,
    bedrooms: Number.isFinite(beds) ? beds : 0,
    bathrooms: Number.isFinite(baths) ? baths : 0,
    property_type: profile.property_type || '',
    image_url: '',
    listing_url: '',
    summary: '',
  };
}

async function loadSellerInventoryRows(userId, excludeLeadProfileIds, inventoryLimit) {
  const exclude = new Set(excludeLeadProfileIds.filter(Boolean).map(String));

  const matches = await LeadMatch.find({
    user_id: userId,
    lead_type: { $regex: '_seller$' },
    lead_profile_id: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(inventoryLimit)
    .select('lead_profile_id')
    .lean();

  const ids = [...new Set(matches.map((m) => m.lead_profile_id).filter(Boolean).map(String))].filter(
    (id) => !exclude.has(id)
  );
  if (!ids.length) return [];

  const profiles = await LeadProfile.find({
    _id: { $in: ids },
    intent: 'sell',
  }).lean();

  const out = [];
  for (const p of profiles) {
    if (exclude.has(String(p._id))) continue;
    const row = sellerLeadProfileToRow(p);
    if (row) out.push(row);
  }
  return out;
}

async function loadBuyerLeadProfiles(userId, excludeLeadProfileIds, inventoryLimit) {
  const exclude = new Set(excludeLeadProfileIds.filter(Boolean).map(String));

  const matches = await LeadMatch.find({
    user_id: userId,
    lead_type: { $regex: '_buyer$' },
    lead_profile_id: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(inventoryLimit)
    .select('lead_profile_id')
    .lean();

  const ids = [...new Set(matches.map((m) => m.lead_profile_id).filter(Boolean).map(String))].filter(
    (id) => !exclude.has(id)
  );
  if (!ids.length) return [];

  return LeadProfile.find({
    _id: { $in: ids },
    intent: 'buy',
  }).lean();
}

function pickScoredBatch(scored, minPick, maxN) {
  const sorted = [...scored].sort((a, c) => c.score - a.score);
  const above = sorted.filter((x) => x.score > minPick);
  const base = above.length ? above : sorted.slice(0, maxN);
  return base.slice(0, maxN);
}

// ─── Chat response helpers ───────────────────────────────────────────────────

export function propertyMatchesFooterNote(context, matchCount) {
  const n = Number(matchCount) || 0;
  if (context === 'buy') {
    if (n > 0) return null;
    return "No other seller properties on file with this agent match those details yet—they'll follow up with tailored options.";
  }
  if (context === 'sell') {
    if (n > 0) {
      return 'Seller rows are informal comparables; buyer rows are possible interest from inquiries on file—not offers or guarantees.';
    }
    return 'No comparable seller listings or matching buyer inquiries on file right now—they can discuss next steps with you directly.';
  }
  return null;
}

const emptyPropertyMatchesMeta = () => ({
  property_matches: [],
  property_matches_context: null,
  property_matches_note: null,
});

async function leadProfileForAgentIntent({ conversationId, userId, intent }) {
  const suffix = intent === 'sell' ? '_seller$' : '_buyer$';
  const lm = await LeadMatch.findOne({
    conversation_id: conversationId,
    user_id:         userId,
    lead_type:       new RegExp(suffix),
  })
    .select('lead_profile_id')
    .lean();
  if (!lm?.lead_profile_id) return null;
  return LeadProfile.findById(lm.lead_profile_id).lean();
}

/** After lead creation: same chat turn, show scored matches for this visitor’s intent (agent embeds only).
 *  `matchIntent` should reflect the visitor’s buy/sell choice (e.g. form intent), not necessarily the
 *  model’s `###META###` intent — otherwise a misclassified “sell” turn would show seller comparables +
 *  buyer inquiries instead of listings-only for a buyer. */
export async function resolveAgentPropertyMatchesForChat({
  isAgent,
  hasContact,
  matchIntent,
  userId,
  conversationId,
  leadMetaSignals,
}) {
  if (!isAgent || !hasContact) return emptyPropertyMatchesMeta();
  if (matchIntent !== 'buy' && matchIntent !== 'sell') return emptyPropertyMatchesMeta();

  const leadProfileDoc = await leadProfileForAgentIntent({
    conversationId,
    userId,
    intent: matchIntent,
  });
  if (!leadProfileDoc) return emptyPropertyMatchesMeta();

  if (matchIntent === 'buy') {
    const property_matches = await getBuyerPropertyMatches({
      userId,
      leadProfile: leadProfileDoc,
      signals:     leadMetaSignals,
    });
    return {
      property_matches,
      property_matches_context: 'buy',
      property_matches_note:    propertyMatchesFooterNote('buy', property_matches.length),
    };
  }

  const property_matches = await getSellerComparableMatches({
    userId,
    leadProfile:          leadProfileDoc,
    signals:              leadMetaSignals,
    excludeLeadProfileId: leadProfileDoc._id,
  });
  return {
    property_matches,
    property_matches_context: 'sell',
    property_matches_note:    propertyMatchesFooterNote('sell', property_matches.length),
  };
}

export async function getBuyerPropertyMatches({ userId, leadProfile, signals = {} }) {
  const cfg = await getResolvedPropertyMatchScoring(userId);
  if (!cfg) return [];

  const rows = await loadSellerInventoryRows(userId, [], cfg.inventoryLimit);
  if (!rows.length) return [];

  const budgetStr = leadProfile?.budget || signals?.budget;
  const maxBudget =
    (budgetStr && parseInventoryPrice(budgetStr)) || parseMaxBudget(budgetStr) || null;
  const minBeds = parseBedrooms(leadProfile, signals);
  const leadLocation =
    leadProfile?.location ||
    leadProfile?.property_address ||
    signals?.location ||
    '';

  const b = cfg.buyer;
  const scored = scoreRowsForBuyer(rows, { leadProfile, maxBudget, minBeds, leadLocation }, b);
  const sorted = scored.sort((a, c) => c.score - a.score);
  const minPick = b.pickMinScore;
  const picked = sorted.filter((x) => x.score > minPick).length
    ? sorted.filter((x) => x.score > minPick)
    : sorted.slice(0, cfg.maxMatches);

  return mapMatchResults(picked.slice(0, cfg.maxMatches), cfg.maxDisplayScore);
}

export async function getSellerComparableMatches({
  userId,
  leadProfile,
  signals = {},
  excludeLeadProfileId = null,
}) {
  const cfg = await getResolvedPropertyMatchScoring(userId);
  if (!cfg) return [];

  const excludeIds = excludeLeadProfileId ? [excludeLeadProfileId] : [];
  let sellerRows = await loadSellerInventoryRows(userId, excludeIds, cfg.inventoryLimit);

  const sellerLine =
    leadProfile?.property_address ||
    leadProfile?.location ||
    signals?.location ||
    '';
  if (sellerLine && String(sellerLine).trim()) {
    sellerRows = sellerRows.filter((r) => !rowMatchesSellerAddress(sellerLine, r));
  }

  const askStr =
    leadProfile?.expected_price || leadProfile?.budget || signals?.budget || '';
  const askPrice = parseInventoryPrice(askStr) || parseMaxBudget(askStr) || null;
  const sellerLoc =
    leadProfile?.property_address ||
    leadProfile?.location ||
    signals?.location ||
    '';
  const sellerBeds = parseBedrooms(leadProfile, signals);

  const sellerListingRow = {
    _id: `self:${String(excludeLeadProfileId || 'listing')}`,
    title: (leadProfile?.property_type || 'Your property').trim() || 'Your property',
    address: (leadProfile?.property_address || '').trim(),
    location: (sellerLoc || '').trim(),
    price: askPrice != null && askPrice > 0 ? askPrice : 0,
    bedrooms:
      sellerBeds != null && Number.isFinite(sellerBeds)
        ? sellerBeds
        : 0,
    bathrooms: Number.isFinite(parseFloat(String(leadProfile?.bathrooms || '')))
      ? parseFloat(String(leadProfile.bathrooms))
      : 0,
    property_type: leadProfile?.property_type || '',
    image_url: '',
    listing_url: '',
    summary: '',
  };

  const merged = [];

  if (sellerRows.length) {
    const s = cfg.seller;
    const sellerScored = scoreRowsForSellerComparable(
      sellerRows,
      { leadProfile, askPrice, sellerLoc, sellerBeds },
      s
    );
    for (const p of pickScoredBatch(sellerScored, s.pickMinScore, cfg.maxMatches)) {
      merged.push({ score: p.score, kind: 'seller', payload: p });
    }
  }

  const buyerProfiles = await loadBuyerLeadProfiles(userId, excludeIds, cfg.inventoryLimit);
  const b = cfg.buyer;
  for (const bp of buyerProfiles) {
    const { budgetStr: bbStr, financingStr: bbFin } = partitionBuyerBudgetInputs(
      bp.budget,
      bp.expected_price
    );
    const maxBudget =
      (bbStr && (parseInventoryPrice(bbStr) || parseMaxBudget(bbStr))) ||
      (String(bp.expected_price || '').trim() &&
        (parseInventoryPrice(bp.expected_price) || parseMaxBudget(bp.expected_price))) ||
      null;
    const minBeds = parseBedrooms(bp, {});
    const leadLocation = bp.location || bp.property_address || '';
    if (maxBudget == null && !String(leadLocation || '').trim() && !bbFin) continue;

    const [one] = scoreRowsForBuyer(
      [sellerListingRow],
      { leadProfile: bp, maxBudget, minBeds, leadLocation },
      b
    );
    merged.push({ score: one.score, kind: 'buyer', profile: bp, reasons: one.reasons });
  }

  merged.sort((a, c) => c.score - a.score);

  const minPick = Math.min(cfg.seller.pickMinScore, cfg.buyer.pickMinScore);
  const above = merged.filter((x) => x.score > minPick);
  const pool = above.length ? above : merged.slice(0, cfg.maxMatches);
  const top = pool.slice(0, cfg.maxMatches);

  return top.map((entry) => {
    if (entry.kind === 'seller') {
      return mapMatchResults([entry.payload], cfg.maxDisplayScore, 'seller_lead')[0];
    }
    return mapBuyerMatchResult(entry.profile, entry.score, entry.reasons, cfg.maxDisplayScore, {
      listingBedrooms: sellerListingRow.bedrooms,
    });
  });
}
