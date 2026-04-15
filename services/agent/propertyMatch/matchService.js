import mongoose from 'mongoose';
import LeadMatch from '../../../models/LeadMatch.js';
import LeadProfile from '../../../models/LeadProfile.js';
import ProfessionalProfile from '../../../models/ProfessionalProfile.js';
import {
  getDefaultResolvedPropertyMatchScoring,
  getResolvedPropertyMatchScoring,
} from './scoringConfig.js';
import {
  parseMaxBudget,
  parseInventoryPrice,
} from './parsing.js';
import { locationOverlaps, rowMatchesSellerAddress } from './locationUtils.js';
import {
  applyBuyerPreferenceFilter,
  buildBuyerScoringContext,
  buildMatchedLeadSnapshot,
  mapBuyerMatchResult,
  mapMatchResults,
  parseBedrooms,
  scoreRowsForBuyer,
  scoreRowsForSellerComparable,
} from './scoreRows.js';

function envAgentAreaFallbackEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.PROPERTY_MATCH_AGENT_AREA_FALLBACK ?? '').trim().toLowerCase());
}

function sellerLeadProfileToRow(profile) {
  const rawPrice = profile.property?.expected_price || profile.property?.budget || '';
  const fromParse = parseInventoryPrice(rawPrice);
  const fromMax = parseMaxBudget(rawPrice);
  let price =
    fromParse && fromParse > 0
      ? fromParse
      : fromMax != null && Number.isFinite(fromMax) && fromMax > 0
        ? fromMax
        : null;

  const loc = (profile.property?.location || '').trim();
  const addr = (profile.property?.address || '').trim();
  if (!loc && !addr) return null;

  const beds = parseInt(String(profile.property?.bedrooms || ''), 10);
  const baths = parseFloat(String(profile.property?.bathrooms || ''));
  const typeLabel = (profile.property?.property_type || 'Property').trim();
  const sellerName = String(profile.identity?.full_name || '').trim();
  return {
    _id: `lead:${String(profile._id)}`,
    title: sellerName ? `${sellerName} · ${typeLabel}` : typeLabel,
    address: addr,
    location: loc || addr,
    price,
    bedrooms: Number.isFinite(beds) ? beds : 0,
    bathrooms: Number.isFinite(baths) ? baths : 0,
    property_type: profile.property?.property_type || '',
    image_url: '',
    listing_url: '',
    summary: '',
    matched_contact: {
      full_name: profile.identity?.full_name || null,
      email: profile.identity?.email || null,
      phone: profile.identity?.phone || null,
    },
    matched_lead: buildMatchedLeadSnapshot(profile),
    lead_profile_id: String(profile._id),
  };
}

async function loadSellerInventoryRows(userId, excludeLeadProfileIds, inventoryLimit) {
  const exclude = new Set(excludeLeadProfileIds.filter(Boolean).map(String));
  const seen = new Set();
  const out = [];
  const pushFromProfile = (p) => {
    const id = String(p._id);
    if (exclude.has(id) || seen.has(id)) return;
    const row = sellerLeadProfileToRow(p);
    if (!row) return;
    seen.add(id);
    out.push(row);
  };

  const matchDocs = await LeadMatch.find({
    user_id: userId,
    lead_type: { $regex: '_seller$' },
    lead_profile_id: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(Math.max(inventoryLimit * 2, 40))
    .select('lead_profile_id')
    .lean();

  const orderedFromMatches = [
    ...new Set(matchDocs.map((m) => String(m.lead_profile_id)).filter((id) => id && mongoose.Types.ObjectId.isValid(id))),
  ].filter((id) => !exclude.has(id));

  if (orderedFromMatches.length) {
    const oids = orderedFromMatches.map((id) => new mongoose.Types.ObjectId(id));
    const byMatch = await LeadProfile.find({
      _id: { $in: oids },
      intent: 'sell',
    }).lean();
    const byId = new Map(byMatch.map((p) => [String(p._id), p]));
    for (const id of orderedFromMatches) {
      if (out.length >= inventoryLimit) break;
      const p = byId.get(id);
      if (p) pushFromProfile(p);
    }
  }

  if (out.length < inventoryLimit) {
    const ownerQuery = {
      intent: 'sell',
      $or: [{ 'ownership.user_id': userId }, { owner_user_id: userId }],
    };
    if (seen.size) {
      ownerQuery._id = {
        $nin: [...seen].map((id) => new mongoose.Types.ObjectId(id)),
      };
    }
    const moreProfiles = await LeadProfile.find(ownerQuery)
      .sort({ updatedAt: -1 })
      .limit(Math.max(inventoryLimit * 2, 40))
      .lean();
    for (const p of moreProfiles) {
      if (out.length >= inventoryLimit) break;
      pushFromProfile(p);
    }
  }

  return out;
}

/**
 * One candidate per buyer-side LeadMatch row (same as leads list), not deduped by lead_profile_id.
 * Duplicate conversations often share one profile — seller matching should still surface each lead row.
 */
async function loadBuyerLeadMatchCandidates(userId, excludeLeadProfileIds, limit = 40) {
  const exclude = new Set(excludeLeadProfileIds.filter(Boolean).map(String));
  const out = [];
  const profileIdsTouched = new Set();

  const matchDocs = await LeadMatch.find({
    user_id: userId,
    lead_type: { $regex: '_(buyer|client)$' },
    lead_profile_id: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(Math.max(limit * 2, 40))
    .select('lead_profile_id')
    .lean();

  const pairs = [];
  for (const m of matchDocs) {
    const pid = String(m.lead_profile_id);
    if (!mongoose.Types.ObjectId.isValid(pid) || exclude.has(pid)) continue;
    pairs.push({ leadMatchId: m._id, profileId: pid });
  }

  if (pairs.length) {
    const uniqueProfileIds = [...new Set(pairs.map((x) => x.profileId))];
    const profiles = await LeadProfile.find({
      _id: { $in: uniqueProfileIds.map((id) => new mongoose.Types.ObjectId(id)) },
      intent: 'buy',
    }).lean();
    const byId = new Map(profiles.map((p) => [String(p._id), p]));

    for (const { leadMatchId, profileId } of pairs) {
      if (out.length >= limit) break;
      const p = byId.get(profileId);
      if (!p) continue;
      out.push({ profile: p, leadMatchId: String(leadMatchId) });
      profileIdsTouched.add(profileId);
    }
  }

  if (out.length < limit) {
    const ownerQuery = {
      intent: 'buy',
      $or: [{ 'ownership.user_id': userId }, { owner_user_id: userId }],
    };
    if (profileIdsTouched.size) {
      ownerQuery._id = {
        $nin: [...profileIdsTouched].map((id) => new mongoose.Types.ObjectId(id)),
      };
    }
    const moreProfiles = await LeadProfile.find(ownerQuery)
      .sort({ updatedAt: -1 })
      .limit(Math.max(limit * 2, 40))
      .lean();
    for (const p of moreProfiles) {
      if (out.length >= limit) break;
      const id = String(p._id);
      if (exclude.has(id) || profileIdsTouched.has(id)) continue;
      profileIdsTouched.add(id);
      out.push({ profile: p, leadMatchId: null });
    }
  }

  return out;
}
async function agentServiceAreaFallbackRows(userId) {
  const profile = await ProfessionalProfile.findOne({ user_id: userId })
    .select('location target_neighborhoods')
    .lean();
  if (!profile) return [];
  const area = [profile.target_neighborhoods, profile.location]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  if (!area) return [];
  return [
    {
      _id: 'nesti:agent-service-area',
      title: 'Agent service area',
      address: '',
      location: area.slice(0, 240),
      price: null,
      bedrooms: 0,
      bathrooms: 0,
      property_type: '',
      image_url: '',
      listing_url: '',
      summary:
        "Not a listing—no seller properties are saved in this agent's CRM yet. Areas above are from the agent profile; ask them for homes for sale.",
    },
  ];
}

export function propertyMatchesFooterNote(context, matchCount) {
  const n = Number(matchCount) || 0;
  if (context === 'buy' || context === 'sell') {
    if (n > 0) return null;
    return null;
  }
  return null;
}

const emptyPropertyMatchesMeta = () => ({
  property_matches: [],
  property_matches_context: null,
  property_matches_note: null,
});

async function leadProfileForAgentIntent({ conversationId, userId, intent }) {
  const pattern = intent === 'sell' ? '_seller$' : '_(buyer|client)$';
  const lm = await LeadMatch.findOne({
    conversation_id: conversationId,
    user_id:         userId,
    lead_type:       new RegExp(pattern),
  })
    .select('lead_profile_id')
    .lean();
  if (lm?.lead_profile_id) {
    return LeadProfile.findById(lm.lead_profile_id).lean();
  }
  if (intent === 'buy') {
    const fallbackLm = await LeadMatch.findOne({
      conversation_id: conversationId,
      user_id:         userId,
      lead_profile_id: { $ne: null },
    })
      .sort({ updatedAt: -1 })
      .select('lead_profile_id')
      .lean();
    if (fallbackLm?.lead_profile_id) {
      const p = await LeadProfile.findById(fallbackLm.lead_profile_id).lean();
      if (p?.intent === 'buy') return p;
    }
  }
  return null;
}

export async function resolveAgentPropertyMatchesForChat({
  isAgent,
  hasContact,
  matchIntent,
  userId,
  conversationId,
  leadMetaSignals,
}) {
  if (!isAgent || !hasContact) {
    return emptyPropertyMatchesMeta();
  }
  if (matchIntent !== 'buy' && matchIntent !== 'sell') {
    return emptyPropertyMatchesMeta();
  }

  const leadProfileDoc = await leadProfileForAgentIntent({
    conversationId,
    userId,
    intent: matchIntent,
  });

  if (!leadProfileDoc) {
    return emptyPropertyMatchesMeta();
  }

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

  const property_matches = await getBuyerMatchesForSellerProperty({
    userId,
    leadProfile: leadProfileDoc,
    signals:     leadMetaSignals,
  });
  return {
    property_matches,
    property_matches_context: 'sell',
    property_matches_note:    propertyMatchesFooterNote('sell', property_matches.length),
  };
}

export async function getBuyerPropertyMatches({ userId, leadProfile, signals = {} }) {
  let cfg = await getResolvedPropertyMatchScoring(userId);
  if (!cfg) cfg = getDefaultResolvedPropertyMatchScoring();
  if (!cfg) return [];

  let rows = await loadSellerInventoryRows(userId, [], cfg.inventoryLimit);
  if (!rows.length && envAgentAreaFallbackEnabled()) {
    rows = await agentServiceAreaFallbackRows(userId);
  }

  if (!rows.length) {
    return [];
  }
  const ctx = buildBuyerScoringContext(leadProfile, signals);
  const b = cfg.buyer;
  const scored = scoreRowsForBuyer(rows, ctx, b);
  const pool = applyBuyerPreferenceFilter(scored, ctx);
  const sorted = pool.sort((a, c) => c.score - a.score);
  return mapMatchResults(sorted, cfg.maxDisplayScore);
}

export async function getBuyerMatchesForSellerProperty({ userId, leadProfile, signals = {} }) {
  let cfg = await getResolvedPropertyMatchScoring(userId);
  if (!cfg) cfg = getDefaultResolvedPropertyMatchScoring();
  if (!cfg) return [];
  const sellerRow = sellerLeadProfileToRow(leadProfile);
  if (!sellerRow) {
    return [];
  }
  const candidates = await loadBuyerLeadMatchCandidates(userId, [leadProfile._id], cfg.inventoryLimit);
  if (!candidates.length) {
    return [];
  }
  const b = cfg.buyer;
  const scored = [];
  for (const { profile: bp, leadMatchId } of candidates) {
    const ctx = buildBuyerScoringContext(bp, {});
    const loc = String(ctx.leadLocation || '').trim();
    if (loc && !locationOverlaps(loc, sellerRow.location, sellerRow.address)) {
      continue;
    }
    const [s] = scoreRowsForBuyer([sellerRow], ctx, b);
    scored.push({ profile: bp, leadMatchId, score: s.score, reasons: s.reasons });
  }

  const sorted = scored.sort((a, c) => c.score - a.score);

  return sorted.map(({ profile, leadMatchId, score, reasons }) =>
    mapBuyerMatchResult(profile, score, reasons, cfg.maxDisplayScore, {
      listingBedrooms: sellerRow.bedrooms || null,
      leadMatchId,
    })
  );
}

export async function getSellerComparableMatches({
  userId,
  leadProfile,
  signals = {},
  excludeLeadProfileId = null,
}) {
  let cfg = await getResolvedPropertyMatchScoring(userId);
  if (!cfg) cfg = getDefaultResolvedPropertyMatchScoring();
  if (!cfg) return [];
  const excludeIds = excludeLeadProfileId ? [excludeLeadProfileId] : [];
  let sellerRows = await loadSellerInventoryRows(userId, excludeIds, cfg.inventoryLimit);
  const sellerLine =
    leadProfile?.property?.address ||
    leadProfile?.property?.location ||
    signals?.location ||
    '';
  if (sellerLine && String(sellerLine).trim()) {
    sellerRows = sellerRows.filter((r) => !rowMatchesSellerAddress(sellerLine, r));
  }
  const sellerGeo = String(
    leadProfile?.property?.location ||
      leadProfile?.property?.address ||
      signals?.location ||
      ''
  ).trim();
  if (sellerGeo) {
    sellerRows = sellerRows.filter((r) => locationOverlaps(sellerGeo, r.location, r.address));
  }
  const askStr =
    leadProfile?.property?.expected_price || leadProfile?.property?.budget || signals?.budget || '';
  const askPrice = parseInventoryPrice(askStr) || parseMaxBudget(askStr) || null;
  const sellerLoc =
    leadProfile?.property?.address ||
    leadProfile?.property?.location ||
    signals?.location ||
    '';
  const sellerBeds = parseBedrooms(leadProfile, signals);
  if (!sellerRows.length) return [];
  const s = cfg.seller;
  const sellerScored = scoreRowsForSellerComparable(
    sellerRows,
    { leadProfile, askPrice, sellerLoc, sellerBeds },
    s
  );
  const sellerPicks = sellerScored
    .filter((p) => p.score > s.pickMinScore)
    .sort((a, c) => c.score - a.score);
  return mapMatchResults(sellerPicks, cfg.maxDisplayScore, 'seller_lead');
}
