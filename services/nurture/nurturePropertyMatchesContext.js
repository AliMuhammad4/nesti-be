import mongoose from 'mongoose';
import ChatConversation from '../../models/ChatConversation.js';
import LeadProfile from '../../models/LeadProfile.js';
import ProfessionalProfile from '../../models/ProfessionalProfile.js';
import { PROFESSIONAL_TYPE } from '../../constants/roles.js';
import { flowTypeForConversation, recomputeSignalsForPropertyMatches } from '../chat/handleChat/chatFlowResolution.js';
import { getFlowForRole } from '../chat/flows/getFlowForRole.js';
import { supportsPropertyMatches } from '../chat/flows/flowRoleMeta.js';
import { accumulateContactInfo } from '../chat/utils/contactUtils.js';
import { mergeFormContactData } from '../chat/utils/mergeFormContactData.js';
import {
  getBuyerMatchesForSellerProperty,
  getBuyerPropertyMatchesForNurture,
  getSellerComparableMatches,
  resolveAgentPropertyMatchesForChat,
} from '../agent/propertyMatch/matchService.js';
import logger from '../../utils/logger.js';

const MAX_LISTINGS = 5;
const SUMMARY_MAX = 480;

function inferNurturePropertyMatchIntent(leadProfile, leadMatch) {
  const direct = String(leadProfile?.intent || '').trim().toLowerCase();
  if (direct === 'sell') return 'sell';
  if (direct === 'buy') return 'buy';
  const primary = String(leadProfile?.intent_summary?.primary_intent || '').trim().toLowerCase();
  if (primary === 'sell') return 'sell';
  if (primary === 'buy') return 'buy';
  const lt = String(leadMatch?.lead_type || '').toLowerCase();
  if (/_seller$/.test(lt)) return 'sell';
  if (/_buyer$/.test(lt) || /_client$/.test(lt)) return 'buy';
  return 'buy';
}

/** Skip placeholder / demo rows with no location and no usable price for nurture email + AI. */
function listingHasCompleteDisplayData(L) {
  if (!L || typeof L !== 'object') return false;
  const price = Number(L.price);
  if (!Number.isFinite(price) || price <= 0) return false;
  const loc = String(L.location || L.address || '').trim();
  return Boolean(loc);
}

function filterQualityListings(listings) {
  if (!Array.isArray(listings)) return [];
  return listings.filter(listingHasCompleteDisplayData);
}

function toInventoryListing(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const prop = profile.property || {};
  const identity = profile.identity || {};
  const title =
    String(prop.property_type || '').trim() ||
    String(identity.full_name || '').trim() ||
    'Property';
  const hasAnyLocation = Boolean(String(prop.location || '').trim() || String(prop.address || '').trim());
  const hasAnyPrice = Boolean(String(prop.expected_price || '').trim() || String(prop.budget || '').trim());
  if (!hasAnyLocation && !hasAnyPrice) return null;
  const parsedPrice = Number(String(prop.expected_price || prop.budget || '').replace(/[^0-9.]/g, ''));
  return compactListing({
    title,
    address: String(prop.address || '').trim() || null,
    location: String(prop.location || '').trim() || null,
    price: Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null,
    bedrooms: prop.bedrooms ?? null,
    bathrooms: prop.bathrooms ?? null,
    property_type: String(prop.property_type || '').trim() || null,
    listing_url: null,
    summary: null,
    source: 'inventory_fallback',
    match_score: null,
    match_headline: null,
    match_reasons: [],
  });
}

async function loadAvailableInventoryListings(userId, limit = MAX_LISTINGS, leadProfile = null) {
  const rows = await LeadProfile.find({
    intent: 'sell',
    $or: [{ 'ownership.user_id': userId }, { owner_user_id: userId }],
  })
    .sort({ updatedAt: -1 })
    .limit(Math.max(limit * 3, 40))
    .select('identity.full_name property intent ownership owner_user_id updatedAt')
    .lean();

  const listings = [];
  const seen = new Set();
  const wantedType = String(leadProfile?.property?.property_type || '')
    .trim()
    .toLowerCase();
  const wantedLocation = String(leadProfile?.property?.location || leadProfile?.property?.address || '')
    .trim()
    .toLowerCase();
  const wantedBudgetRaw = String(
    leadProfile?.property?.expected_price ||
      leadProfile?.property?.budget ||
      leadProfile?.budget_profile?.latest_budget_text ||
      '',
  ).trim();
  const wantedBudget = Number(wantedBudgetRaw.replace(/[^0-9.]/g, ''));
  const shouldInclude = (profile) => {
    const prop = profile?.property || {};
    const pType = String(prop.property_type || '').trim().toLowerCase();
    const pLoc = String(prop.location || prop.address || '').trim().toLowerCase();
    const pPrice = Number(String(prop.expected_price || prop.budget || '').replace(/[^0-9.]/g, ''));
    const typeOk = !wantedType || !pType || pType === wantedType;
    const locOk =
      !wantedLocation ||
      !pLoc ||
      pLoc.includes(wantedLocation) ||
      wantedLocation.includes(pLoc);
    const priceOk =
      !Number.isFinite(wantedBudget) ||
      !Number.isFinite(pPrice) ||
      pPrice <= wantedBudget * 1.5;
    return typeOk && locOk && priceOk;
  };

  // Prioritize close matches to the referred lead criteria.
  const prioritized = rows.filter(shouldInclude);
  const ordered = prioritized.length ? [...prioritized, ...rows] : rows;
  for (const p of ordered) {
    const k = String(p?._id || '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const listing = toInventoryListing(p);
    if (!listing) continue;
    listings.push(listing);
    if (listings.length >= limit) break;
  }
  return listings;
}

function compactListing(m) {
  if (!m || typeof m !== 'object') return null;
  const reasons = Array.isArray(m.match_reasons)
    ? m.match_reasons.slice(0, 4).map((r) => String(r).trim().slice(0, 160))
    : [];
  const sum = String(m.summary || '').trim();
  return {
    title: m.title || null,
    address: m.address || null,
    location: m.location || null,
    price: m.price != null && Number.isFinite(Number(m.price)) ? Number(m.price) : null,
    budget_display: m.budget_display || null,
    financing_status: m.financing_status || null,
    bedrooms: m.bedrooms ?? null,
    bathrooms: m.bathrooms ?? null,
    property_type: m.property_type || null,
    listing_url: m.listing_url || null,
    summary: sum ? sum.slice(0, SUMMARY_MAX) : null,
    match_score: m.match_score != null ? m.match_score : null,
    match_headline: m.match_headline || null,
    source: m.source || null,
    matched_contact: m.matched_contact || null,
    ...(reasons.length ? { match_reasons: reasons } : {}),
  };
}

/**
 * Same resolution as chat property-matches, compacted for nurture email context (agent + buy/sell flows only).
 */
function logNurturePropertyMatches(payload) {
  logger.info('nurture.property_matches', { op: 'nurture.property_matches', ...payload });
  if (process.env.NODE_ENV !== 'production') {
    console.log('[nurture:property-matches]', payload);
  }
}

export async function loadPropertyMatchesForNurtureEmail({
  userId,
  conversationId,
  leadProfessionalType,
  professionalProfile: profileIn,
  leadProfile = null,
  leadMatch = null,
  enableProfileFallback = false,
}) {
  const empty = { listings: [], context: null, note: null };
  try {
    if (!userId) {
      logNurturePropertyMatches({
        stage:   'skip',
        reason:  'missing_user_id',
        user_id: String(userId),
      });
      return empty;
    }
    if (leadProfessionalType && leadProfessionalType !== PROFESSIONAL_TYPE.AGENT) {
      logNurturePropertyMatches({
        stage: 'skip',
        reason: 'not_agent_lead_professional_type',
        lead_professional_type: leadProfessionalType,
        conversation_id: String(conversationId),
      });
      return empty;
    }

    const hasConversationId = Boolean(
      conversationId && mongoose.Types.ObjectId.isValid(String(conversationId)),
    );
    const conversation = hasConversationId ? await ChatConversation.findById(conversationId).lean() : null;

    const professionalProfile =
      profileIn ||
      (await ProfessionalProfile.findOne({ user_id: userId }).select('professional_type').lean());
    if (!conversation && enableProfileFallback && leadProfile) {
      const matchIntent = inferNurturePropertyMatchIntent(leadProfile, leadMatch);
      let rawMatches;
      let usedSellerComparableProfile = false;
      if (matchIntent === 'sell') {
        rawMatches = await getBuyerMatchesForSellerProperty({ userId, leadProfile, signals: {} });
        if (!Array.isArray(rawMatches) || !rawMatches.length) {
          rawMatches = await getSellerComparableMatches({
            userId,
            leadProfile,
            signals: {},
            excludeLeadProfileId: leadProfile._id ? String(leadProfile._id) : null,
          });
          if (Array.isArray(rawMatches) && rawMatches.length) {
            usedSellerComparableProfile = true;
          }
        }
      } else {
        rawMatches = await getBuyerPropertyMatchesForNurture({ userId, leadProfile, signals: {} });
      }
      const raw = Array.isArray(rawMatches) ? rawMatches : [];
      let listings = filterQualityListings(
        raw.slice(0, Math.max(MAX_LISTINGS * 4, 24)).map(compactListing).filter(Boolean),
      ).slice(0, MAX_LISTINGS);
      if (!listings.length) usedSellerComparableProfile = false;
      let usedInventoryFallback = false;
      if (!listings.length && matchIntent === 'buy') {
        const fallbackRaw = await loadAvailableInventoryListings(
          userId,
          Math.max(MAX_LISTINGS * 3, 24),
          leadProfile,
        );
        const filtered = filterQualityListings(fallbackRaw);
        if (filtered.length) {
          listings = filtered.slice(0, MAX_LISTINGS);
          usedInventoryFallback = true;
        }
      }
      const preview = listings.map((L, i) => ({
        i: i + 1,
        title: L.title,
        location: L.location,
        price: L.price,
        match_score: L.match_score,
        match_headline: L.match_headline,
        source: L.source,
      }));
      logNurturePropertyMatches({
        stage: 'resolved_profile_fallback',
        reason: hasConversationId ? 'conversation_not_found' : 'missing_or_invalid_conversation_id',
        conversation_id: hasConversationId ? String(conversationId) : null,
        user_id: String(userId),
        property_match_intent: matchIntent,
        raw_match_count: raw.length,
        compact_listings_sent_to_ai: listings.length,
        inventory_fallback_used: usedInventoryFallback,
        seller_comparable_fallback_used: usedSellerComparableProfile,
        listings_preview: preview,
      });
      return {
        listings,
        context: matchIntent,
        note: usedInventoryFallback
          ? 'Showing available inventory listings because strict profile matching returned no rows.'
          : usedSellerComparableProfile
            ? 'Showing comparable listings from your inventory because no buyer leads matched this seller yet.'
            : null,
      };
    }

    if (!conversation) {
      logNurturePropertyMatches({
        stage: 'skip',
        reason: hasConversationId ? 'conversation_not_found' : 'missing_or_invalid_conversation_id',
        conversation_id: hasConversationId ? String(conversationId) : null,
      });
      return empty;
    }

    const flowType = await flowTypeForConversation(conversation, professionalProfile);
    const flow = getFlowForRole(flowType);
    if (!supportsPropertyMatches(flow)) {
      logNurturePropertyMatches({
        stage: 'skip',
        reason: 'flow_does_not_support_property_matches',
        flow_type: flowType,
        conversation_id: String(conversation._id),
      });
      return empty;
    }

    const contactInfo = await accumulateContactInfo(conversation._id);
    const hasContact = Boolean(contactInfo.email || contactInfo.phone || contactInfo.name);
    if (!hasContact) {
      logNurturePropertyMatches({
        stage: 'skip',
        reason: 'no_contact_on_conversation',
        conversation_id: String(conversation._id),
      });
      return empty;
    }

    const storedForm = mergeFormContactData(
      conversation.form_data && typeof conversation.form_data === 'object' ? conversation.form_data : {},
      {},
    );
    const storedIntent = storedForm?.intent;
    const aiIntent =
      conversation.intent === 'sell' || conversation.intent === 'buy' ? conversation.intent : 'buy';
    const propertyMatchIntent =
      storedIntent === 'buy' || storedIntent === 'sell' ? storedIntent : aiIntent;

    const leadReasons = conversation.lead_reasons;
    let signals = leadReasons && typeof leadReasons === 'object' ? leadReasons.signals : null;
    if (!signals || typeof signals !== 'object') {
      signals = await recomputeSignalsForPropertyMatches(conversation, storedForm, flow);
    }

    const { property_matches, property_matches_context, property_matches_note } =
      await resolveAgentPropertyMatchesForChat({
        isAgent:         true,
        hasContact,
        matchIntent:     propertyMatchIntent,
        userId,
        conversationId:  conversation._id,
        leadMetaSignals: signals,
      });

    const raw = Array.isArray(property_matches) ? property_matches : [];
    let listings = filterQualityListings(
      raw
        .slice(0, Math.max(MAX_LISTINGS * 4, 24))
        .map(compactListing)
        .filter(Boolean),
    ).slice(0, MAX_LISTINGS);
    let usedInventoryFallback = false;
    let usedSellerComparableFallback = false;
    if (!listings.length && propertyMatchIntent === 'buy') {
      const fallbackRaw = await loadAvailableInventoryListings(
        userId,
        Math.max(MAX_LISTINGS * 3, 24),
        leadProfile,
      );
      const filtered = filterQualityListings(fallbackRaw);
      if (filtered.length) {
        listings = filtered.slice(0, MAX_LISTINGS);
        usedInventoryFallback = true;
      }
    }
    if (!listings.length && propertyMatchIntent === 'sell' && leadProfile) {
      const comps = await getSellerComparableMatches({
        userId,
        leadProfile,
        signals: signals && typeof signals === 'object' ? signals : {},
        excludeLeadProfileId: leadProfile._id ? String(leadProfile._id) : null,
      });
      const picked = filterQualityListings(
        (Array.isArray(comps) ? comps : []).map(compactListing).filter(Boolean),
      ).slice(0, MAX_LISTINGS);
      if (picked.length) {
        listings = picked;
        usedSellerComparableFallback = true;
      }
    }

    const preview = listings.map((L, i) => ({
      i: i + 1,
      title: L.title,
      location: L.location,
      price: L.price,
      match_score: L.match_score,
      match_headline: L.match_headline,
      source: L.source,
    }));

    logNurturePropertyMatches({
      stage: 'resolved',
      conversation_id: String(conversation._id),
      user_id: String(userId),
      property_match_intent: propertyMatchIntent,
      raw_match_count: raw.length,
      compact_listings_sent_to_ai: listings.length,
      property_matches_context: property_matches_context || null,
      property_matches_note: property_matches_note || null,
      inventory_fallback_used: usedInventoryFallback,
      seller_comparable_fallback_used: usedSellerComparableFallback,
      listings_preview: preview,
    });

    return {
      listings,
      context: property_matches_context || null,
      note:
        property_matches_note ||
        (usedInventoryFallback
          ? 'Showing available inventory listings because strict matching returned no rows.'
          : null) ||
        (usedSellerComparableFallback
          ? 'Showing comparable listings from your inventory because structured buyer matches returned no rows.'
          : null),
    };
  } catch (err) {
    logger.warn('nurture: property matches context failed', { error: err.message });
    logNurturePropertyMatches({ stage: 'error', error: err.message });
    return empty;
  }
}
