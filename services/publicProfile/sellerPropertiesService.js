import { LeadMatch, LeadProfile, PublicProfile } from '../../models/index.js';
import {
  publicProfileUnavailableResponse,
  userCanServePublicProfile,
} from './publicProfileAccess.js';

const SELLER_PROPERTIES_CACHE_TTL_MS = 10_000;
const sellerPropertiesRequestCache = new Map();

function sellerLeadAggregation(professionalUserId) {
  return [
    {
      $match: {
        'ownership.user_id': professionalUserId,
        'lifecycle.status': { $nin: ['closed', 'sold', 'withdrawn'] },
        $or: [
          { 'intent_summary.primary_intent': 'sell' },
          { intent: 'sell' },
          { 'property.images.0': { $exists: true } },
        ],
      },
    },
    { $sort: { 'lifecycle.last_seen_at': -1 } },
    {
      $lookup: {
        from: LeadMatch.collection.name,
        let: { leadId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$user_id', professionalUserId] },
                  { $eq: ['$lead_profile_id', '$$leadId'] },
                  { $in: ['$match_status', ['converted', 'closed_lost']] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'closed_matches',
      },
    },
    { $match: { 'closed_matches.0': { $exists: false } } },
    {
      $project: {
        identity: 1,
        property: 1,
        budget_profile: 1,
        intent_summary: 1,
        lifecycle: 1,
      },
    },
  ];
}

function serializeSellerProperty(lead) {
  return {
    id: lead._id.toString(),
    images: (lead.property?.images || []).map((img) => img.secure_url || img.url).filter(Boolean),
    address: lead.property?.address || '',
    location: lead.property?.location || '',
    expected_price: lead.property?.expected_price || lead.budget_profile?.latest_budget_text || '',
    property_type: lead.property?.property_type || '',
    bedrooms: lead.property?.bedrooms || '',
    bathrooms: lead.property?.bathrooms || '',
    square_footage: lead.property?.square_footage || '',
    timeline: lead.property?.timeline || '',
    seller_name: lead.identity?.full_name || 'Owner',
  };
}

function repairSellerLeadMatches(professionalUserId, sellerLeads) {
  const sellerLeadIds = sellerLeads.map((lead) => lead._id);
  if (!sellerLeadIds.length) return;
  LeadMatch.updateMany(
    {
      user_id: professionalUserId,
      lead_profile_id: { $in: sellerLeadIds },
      match_status: 'consult_booked',
      lead_type: /seller/i,
    },
    { $set: { match_status: 'new' } },
  ).catch(() => {});
}

async function loadSellerPropertiesBySlug(slug, { requesterUserId } = {}) {
  if (!requesterUserId && (!slug || typeof slug !== 'string')) {
    return { status: 400, body: { success: false, message: 'Invalid slug' } };
  }

  const profileQuery = requesterUserId
    ? { user_id: requesterUserId }
    : { slug: slug.toLowerCase().trim() };
  const profile = await PublicProfile.findOne(profileQuery)
    .select('user_id professional_type enabled')
    .lean();
  const isOwnerRequest = requesterUserId
    && String(profile?.user_id) === String(requesterUserId);
  if (!profile || (!isOwnerRequest && !profile.enabled)) {
    return publicProfileUnavailableResponse();
  }

  const professionalUserId = profile.user_id;
  try {
    const [canServe, sellerLeads] = await Promise.all([
      isOwnerRequest ? Promise.resolve(true) : userCanServePublicProfile(professionalUserId),
      profile.professional_type === 'agent'
        ? LeadProfile.aggregate(sellerLeadAggregation(professionalUserId))
        : Promise.resolve([]),
    ]);
    if (!canServe) return publicProfileUnavailableResponse();
    if (profile.professional_type !== 'agent') {
      return { status: 200, body: { success: true, properties: [] } };
    }

    repairSellerLeadMatches(professionalUserId, sellerLeads);
    return {
      status: 200,
      body: {
        success: true,
        properties: sellerLeads.map(serializeSellerProperty),
      },
    };
  } catch {
    return { status: 200, body: { success: true, properties: [] } };
  }
}

export async function getSellerPropertiesBySlugService(slug, options = {}) {
  if (options.requesterUserId) {
    return loadSellerPropertiesBySlug(slug, options);
  }

  const cacheKey = String(slug || '').trim().toLowerCase();
  const now = Date.now();
  const cached = sellerPropertiesRequestCache.get(cacheKey);
  if (cached && now - cached.createdAt < SELLER_PROPERTIES_CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = loadSellerPropertiesBySlug(cacheKey, options).then((result) => {
    if (result.status !== 200) sellerPropertiesRequestCache.delete(cacheKey);
    return result;
  }).catch((error) => {
    sellerPropertiesRequestCache.delete(cacheKey);
    throw error;
  });
  sellerPropertiesRequestCache.set(cacheKey, { createdAt: now, promise });
  return promise;
}
